const { redactPhone } = require("./sms");

const SHOP_DOMAIN = "welkom-usa.myshopify.com";
const DEFAULT_API_VERSION = "2026-07";

function getConfig(env = process.env) {
  return {
    shopDomain: env.SHOPIFY_SHOP_DOMAIN || SHOP_DOMAIN,
    accessToken: env.SHOPIFY_ADMIN_ACCESS_TOKEN || "",
    apiVersion: env.SHOPIFY_API_VERSION || DEFAULT_API_VERSION
  };
}

function hasConfig(env = process.env) {
  const config = getConfig(env);
  return Boolean(
    config.shopDomain === SHOP_DOMAIN &&
      config.accessToken &&
      !config.accessToken.startsWith("paste_") &&
      !config.accessToken.startsWith("your_")
  );
}

function normalizeOrderQuery(query) {
  const clean = String(query || "").trim();
  return clean.startsWith("#") ? clean.slice(1) : clean;
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
  const amount = Number(value.amount);
  if (Number.isNaN(amount)) return "";
  return `$${amount.toFixed(2)}`;
}

function simplifyProduct(product) {
  const variant = product.variants?.nodes?.[0] || {};
  return {
    id: variant.id || product.id,
    title: product.title,
    variantTitle: variant.title && variant.title !== "Default Title" ? variant.title : "",
    price: money(variant.price),
    imageUrl: product.featuredImage?.url || "",
    status: product.status
  };
}

function simplifyOrder(order, substitutionProducts = []) {
  const phone = pickPhone(order);
  return {
    id: order.id,
    name: order.name,
    processedAt: order.processedAt || "",
    displayFulfillmentStatus: order.displayFulfillmentStatus || "",
    cancelled: Boolean(order.cancelledAt),
    customer: {
      firstName: order.customer?.firstName || "",
      lastName: order.customer?.lastName || "",
      email: order.customer?.email || "",
      phone,
      redactedPhone: redactPhone(phone)
    },
    shippingAddress: {
      name: order.shippingAddress?.name || "",
      city: order.shippingAddress?.city || "",
      province: order.shippingAddress?.province || "",
      country: order.shippingAddress?.country || "",
      zip: order.shippingAddress?.zip || ""
    },
    lineItems: (order.lineItems?.nodes || []).map((item) => ({
      id: item.id,
      title: item.title,
      variantTitle: item.variantTitle || "",
      quantity: item.quantity,
      imageUrl: item.image?.url || item.variant?.image?.url || "",
      sku: item.sku || item.variant?.sku || "",
      price: money(item.originalUnitPriceSet?.shopMoney)
    })),
    substitutionProducts
  };
}

async function shopifyGraphql(query, variables, { env = process.env, fetchImpl = fetch } = {}) {
  const config = getConfig(env);
  const response = await fetchImpl(`https://${config.shopDomain}/admin/api/${config.apiVersion}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": config.accessToken
    },
    body: JSON.stringify({ query, variables })
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || json.errors) {
    return { ok: false, json };
  }
  return { ok: true, json };
}

async function searchProductsForSubstitutions(searchText, options = {}) {
  const clean = String(searchText || "").trim();
  if (!clean) return [];

  const query = `
    query SubstitutionProducts($query: String!) {
      products(first: 8, query: $query) {
        nodes {
          id
          title
          status
          featuredImage {
            url
          }
          variants(first: 1) {
            nodes {
              id
              title
              price
            }
          }
        }
      }
    }
  `;

  const firstWords = clean.split(/\s+/).slice(0, 4).join(" ");
  const result = await shopifyGraphql(query, { query: `status:active title:${firstWords}` }, options);
  if (!result.ok) return [];
  return (result.json.data?.products?.nodes || []).map(simplifyProduct);
}

async function findOrder(queryText, { env = process.env, fetchImpl = fetch } = {}) {
  if (!hasConfig(env)) {
    return { status: 500, body: { success: false, error: "Shopify Admin API is not configured." } };
  }

  const normalized = normalizeOrderQuery(queryText);
  if (!normalized) {
    return { status: 400, body: { success: false, error: "Order number is required." } };
  }

  if (normalized.length > 80) {
    return { status: 400, body: { success: false, error: "Order search is too long." } };
  }

  const query = `
    query SearchOrder($query: String!) {
      orders(first: 1, query: $query, sortKey: PROCESSED_AT, reverse: true) {
        nodes {
          id
          name
          phone
          processedAt
          displayFulfillmentStatus
          cancelledAt
          customer {
            firstName
            lastName
            email
            phone
          }
          shippingAddress {
            name
            city
            province
            country
            zip
            phone
          }
          billingAddress {
            phone
          }
          lineItems(first: 20) {
            nodes {
              id
              title
              variantTitle
              quantity
              sku
              image {
                url
              }
              variant {
                sku
                image {
                  url
                }
              }
              originalUnitPriceSet {
                shopMoney {
                  amount
                  currencyCode
                }
              }
            }
          }
        }
      }
    }
  `;

  const result = await shopifyGraphql(
    query,
    { query: `name:${normalized}` },
    { env, fetchImpl }
  );
  if (!result.ok) {
    return { status: 502, body: { success: false, error: "Shopify order lookup failed." } };
  }

  const order = result.json.data?.orders?.nodes?.[0];
  if (!order) {
    return { status: 404, body: { success: false, error: "No matching order found." } };
  }

  const firstLineItem = order.lineItems?.nodes?.[0];
  const substitutions = await searchProductsForSubstitutions(firstLineItem?.title, { env, fetchImpl });
  return {
    status: 200,
    body: {
      success: true,
      order: simplifyOrder(order, substitutions)
    }
  };
}

module.exports = {
  SHOP_DOMAIN,
  findOrder,
  getConfig,
  hasConfig,
  normalizeOrderQuery,
  searchProductsForSubstitutions
};
