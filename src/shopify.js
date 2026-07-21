const { redactPhone } = require("./sms");

const SHOP_DOMAIN = "welkom-usa.myshopify.com";
const DEFAULT_API_VERSION = "2025-10";
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000;

let cachedToken = null;

function getConfig(env = process.env) {
  return {
    shopDomain: env.SHOPIFY_SHOP_DOMAIN || SHOP_DOMAIN,
    accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    clientId: env.SHOPIFY_CLIENT_ID || "",
    clientSecret: env.SHOPIFY_CLIENT_SECRET || "",
    apiVersion: env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION
  };
}

function hasConfig(env = process.env) {
  const config = getConfig(env);
  const hasStaticToken = config.accessToken &&
    !config.accessToken.startsWith("paste_") &&
    !config.accessToken.startsWith("your_");
  const hasClientCredentials = config.clientId &&
    config.clientSecret &&
    !config.clientId.startsWith("your_") &&
    !config.clientSecret.startsWith("your_");
  return Boolean(config.shopDomain === SHOP_DOMAIN && (hasStaticToken || hasClientCredentials));
}

async function getAccessToken({ env = process.env, fetchImpl = fetch } = {}) {
  const config = getConfig(env);
  if (config.accessToken && !config.accessToken.startsWith("paste_") && !config.accessToken.startsWith("your_")) {
    return config.accessToken;
  }
  if (!config.clientId || !config.clientSecret) {
    throw new Error("Shopify Admin API is not configured.");
  }
  const cacheKey = `${config.shopDomain}:${config.clientId}`;
  if (cachedToken && cachedToken.cacheKey === cacheKey && cachedToken.expiresAt > Date.now() + TOKEN_REFRESH_BUFFER_MS) {
    return cachedToken.accessToken;
  }
  const response = await fetchImpl(`https://${config.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: config.clientId,
      client_secret: config.clientSecret
    }).toString()
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    throw new Error("Shopify access token request failed.");
  }
  cachedToken = {
    cacheKey,
    accessToken: json.access_token,
    expiresAt: Date.now() + Math.max(Number(json.expires_in || 0) * 1000, 0)
  };
  return cachedToken.accessToken;
}

function normalizeOrderQuery(query) {
  const clean = String(query || "").trim();
  return clean.startsWith("#") ? clean.slice(1) : clean;
}

function expectedOrderName(query) {
  const normalized = normalizeOrderQuery(query);
  return normalized ? `#${normalized}` : "";
}

function escapeSearchTerm(value) {
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"').trim();
}

function pickPhone(order) {
  return (
    order.phone ||
    order.customer?.phone ||
    order.shippingAddress?.phone ||
    order.billingAddress?.phone ||
    ""
  );
}

function money(value) {
  if (!value) return "";
  const amount = value.amount ?? value;
  const numeric = Number(amount);
  if (Number.isNaN(numeric)) return "";
  const currency = value.currencyCode || "";
  return currency ? `${currency} ${numeric.toFixed(2)}` : `$${numeric.toFixed(2)}`;
}

function consentFromAttributes(customAttributes = []) {
  const found = customAttributes.find((attr) => String(attr.key || "").toLowerCase() === "sms consent");
  const value = found?.value || "";
  return {
    granted: String(value).toLowerCase() === "yes",
    value
  };
}

function simplifyVariant(variant) {
  if (!variant) return null;
  const product = variant.product || {};
  return {
    id: variant.id,
    productId: product.id || "",
    title: product.title || variant.displayName || variant.title || "",
    variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : "",
    sku: variant.sku || "",
    barcode: variant.barcode || "",
    price: money(variant.price),
    imageUrl: variant.image?.url || product.featuredImage?.url || "",
    inventoryQuantity: Number.isFinite(variant.inventoryQuantity) ? variant.inventoryQuantity : null,
    availableForSale: Boolean(variant.availableForSale),
    productStatus: product.status || "",
    status: product.status || ""
  };
}

function usableSubstitute(variant, excludedVariantId) {
  const simplified = simplifyVariant(variant);
  if (!simplified) return false;
  if (simplified.id === excludedVariantId) return false;
  if (simplified.productStatus !== "ACTIVE") return false;
  if (!simplified.availableForSale) return false;
  return true;
}

function simplifyOrder(order, substitutionProducts = []) {
  const phone = pickPhone(order);
  const smsConsent = consentFromAttributes(order.customAttributes || []);
  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt || "",
    totalPrice: money(order.totalPriceSet?.shopMoney),
    displayFinancialStatus: order.displayFinancialStatus || "",
    displayFulfillmentStatus: order.displayFulfillmentStatus || "",
    cancelled: Boolean(order.cancelledAt),
    cancelledAt: order.cancelledAt || "",
    smsConsent,
    customer: {
      firstName: order.customer?.firstName || "",
      lastName: order.customer?.lastName || "",
      email: order.customer?.email || "",
      phone,
      redactedPhone: redactPhone(phone)
    },
    shippingAddress: {
      name: order.shippingAddress?.name || "",
      address1: order.shippingAddress?.address1 || "",
      address2: order.shippingAddress?.address2 || "",
      city: order.shippingAddress?.city || "",
      province: order.shippingAddress?.province || "",
      country: order.shippingAddress?.country || "",
      zip: order.shippingAddress?.zip || ""
    },
    lineItems: (order.lineItems?.nodes || []).map((item) => {
      const variant = item.variant || {};
      const product = variant.product || {};
      return {
        id: item.id,
        title: item.title,
        variantTitle: item.variantTitle || variant.title || "",
        quantity: item.quantity,
        imageUrl: item.image?.url || variant.image?.url || product.featuredImage?.url || "",
        sku: item.sku || variant.sku || "",
        barcode: variant.barcode || "",
        price: money(item.originalUnitPriceSet?.shopMoney),
        variantId: variant.id || "",
        productId: product.id || "",
        productStatus: product.status || "",
        inventoryQuantity: Number.isFinite(variant.inventoryQuantity) ? variant.inventoryQuantity : null,
        availableForSale: Boolean(variant.availableForSale)
      };
    }),
    substitutionProducts
  };
}

async function shopifyGraphql(query, variables, { env = process.env, fetchImpl = fetch } = {}) {
  const config = getConfig(env);
  const accessToken = await getAccessToken({ env, fetchImpl });
  const response = await fetchImpl(`https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors) {
    return { ok: false, json };
  }
  return { ok: true, json };
}

const ORDER_FIELDS = `
  id
  name
  phone
  processedAt
  displayFinancialStatus
  displayFulfillmentStatus
  cancelledAt
  customAttributes { key value }
  totalPriceSet { shopMoney { amount currencyCode } }
  customer {
    firstName
    lastName
    email
    phone
  }
  shippingAddress {
    name
    address1
    address2
    city
    province
    country
    zip
    phone
  }
  billingAddress { phone }
  lineItems(first: 30) {
    nodes {
      id
      title
      variantTitle
      quantity
      sku
      image { url }
      variant {
        id
        title
        sku
        barcode
        availableForSale
        inventoryQuantity
        image { url }
        product {
          id
          title
          status
          featuredImage { url }
        }
      }
      originalUnitPriceSet { shopMoney { amount currencyCode } }
    }
  }
`;

async function searchProductsForSubstitutions(searchText, options = {}) {
  const clean = String(searchText || "").trim();
  if (!clean) return [];

  const query = `
    query SubstitutionVariants($query: String!) {
      productVariants(first: 20, query: $query) {
        nodes {
          id
          title
          displayName
          sku
          barcode
          price
          availableForSale
          inventoryQuantity
          image { url }
          product {
            id
            title
            status
            featuredImage { url }
          }
        }
      }
    }
  `;

  const safe = escapeSearchTerm(clean).split(/\s+/).slice(0, 8).join(" ");
  const compact = clean.replace(/[^\w-]/g, "");
  const searchQuery = compact && compact.length === clean.length
    ? `(sku:${compact} OR barcode:${compact} OR title:"${safe}")`
    : `title:"${safe}"`;
  const result = await shopifyGraphql(query, { query: searchQuery }, options);
  if (!result.ok) return [];
  return (result.json.data?.productVariants?.nodes || [])
    .filter((variant) => usableSubstitute(variant, options.excludeVariantId))
    .map(simplifyVariant)
    .slice(0, options.limit || 12);
}

async function searchSubstitutionsForLineItem(lineItem, options = {}) {
  if (!lineItem) return [];
  const terms = [lineItem.title, lineItem.sku, lineItem.barcode].filter(Boolean).join(" ");
  return searchProductsForSubstitutions(terms, {
    ...options,
    excludeVariantId: lineItem.variantId
  });
}

async function findOrder(queryText, { env = process.env, fetchImpl = fetch } = {}) {
  if (!hasConfig(env)) {
    return { status: 500, body: { success: false, code: "SHOPIFY_ERROR", error: "Shopify Admin API is not configured." } };
  }

  const normalized = normalizeOrderQuery(queryText);
  if (!normalized) {
    return { status: 400, body: { success: false, code: "INVALID_ORDER", error: "Order number is required." } };
  }

  if (!/^[A-Za-z0-9-]+$/.test(normalized) || normalized.length > 80) {
    return { status: 400, body: { success: false, code: "INVALID_ORDER", error: "Order search is invalid." } };
  }

  const query = `
    query SearchOrder($query: String!) {
      orders(first: 1, query: $query, sortKey: PROCESSED_AT, reverse: true) {
        nodes { ${ORDER_FIELDS} }
      }
    }
  `;

  const expected = expectedOrderName(normalized);
  const result = await shopifyGraphql(query, { query: `name:${escapeSearchTerm(expected)}` }, { env, fetchImpl });
  if (!result.ok) {
    return { status: 502, body: { success: false, code: "SHOPIFY_ERROR", error: "Shopify order lookup failed." } };
  }

  const order = result.json.data?.orders?.nodes?.[0];
  if (!order || order.name !== expected) {
    return { status: 404, body: { success: false, code: "ORDER_NOT_FOUND", error: "No exact matching order found." } };
  }

  return {
    status: 200,
    body: {
      success: true,
      order: simplifyOrder(order)
    }
  };
}

async function getOrderById(orderId, { env = process.env, fetchImpl = fetch } = {}) {
  if (!hasConfig(env)) {
    return { status: 500, body: { success: false, code: "SHOPIFY_ERROR", error: "Shopify Admin API is not configured." } };
  }

  const query = `
    query GetOrder($id: ID!) {
      order(id: $id) { ${ORDER_FIELDS} }
    }
  `;

  const result = await shopifyGraphql(query, { id: orderId }, { env, fetchImpl });
  if (!result.ok) {
    return { status: 502, body: { success: false, code: "SHOPIFY_ERROR", error: "Shopify order lookup failed." } };
  }

  const order = result.json.data?.order;
  if (!order) {
    return { status: 404, body: { success: false, code: "ORDER_NOT_FOUND", error: "Order was not found." } };
  }

  return { status: 200, body: { success: true, order: simplifyOrder(order) } };
}

async function getVariantById(variantId, { env = process.env, fetchImpl = fetch } = {}) {
  const query = `
    query GetVariant($id: ID!) {
      productVariant(id: $id) {
        id
        title
        displayName
        sku
        barcode
        price
        availableForSale
        inventoryQuantity
        image { url }
        product {
          id
          title
          status
          featuredImage { url }
        }
      }
    }
  `;

  const result = await shopifyGraphql(query, { id: variantId }, { env, fetchImpl });
  if (!result.ok) {
    return { status: 502, body: { success: false, code: "SHOPIFY_ERROR", error: "Shopify product lookup failed." } };
  }

  const variant = result.json.data?.productVariant;
  if (!variant) {
    return { status: 404, body: { success: false, code: "SUBSTITUTE_INVALID", error: "The substitute product was not found." } };
  }

  return { status: 200, body: { success: true, product: simplifyVariant(variant) } };
}

module.exports = {
  SHOP_DOMAIN,
  consentFromAttributes,
  expectedOrderName,
  findOrder,
  getConfig,
  getAccessToken,
  getOrderById,
  getVariantById,
  hasConfig,
  normalizeOrderQuery,
  searchProductsForSubstitutions,
  searchSubstitutionsForLineItem
};
