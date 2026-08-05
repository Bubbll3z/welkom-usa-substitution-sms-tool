const STOREFRONT_BASE_URL = "https://www.welkomusa.com";

function parseNumericShopifyId(value) {
  const id = String(value || "").trim().split("/").pop() || "";
  return /^\d+$/.test(id) ? id : "";
}

function normalizeProductHandle(value) {
  const handle = String(value || "").trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]*$/.test(handle) ? handle : "";
}

function buildStorefrontProductUrl({ productHandle, variantId, baseUrl = STOREFRONT_BASE_URL } = {}) {
  const handle = normalizeProductHandle(productHandle);
  if (!handle) return "";
  const root = String(baseUrl || STOREFRONT_BASE_URL).trim().replace(/\/+$/, "");
  const numericVariantId = parseNumericShopifyId(variantId);
  return numericVariantId
    ? `${root}/products/${encodeURIComponent(handle)}?variant=${encodeURIComponent(numericVariantId)}`
    : `${root}/products/${encodeURIComponent(handle)}`;
}

function getReplacementProductLinkState(replacement = {}) {
  if (replacement.noSubstitutionAvailable) {
    return { enabled: false, reason: "Product links cannot be used when no replacement is available." };
  }
  if (String(replacement.customSubstituteTitle || "").trim()) {
    return { enabled: false, reason: "Product links cannot be used for manually entered replacements." };
  }
  if (!replacement.substituteVariantId) {
    return { enabled: false, reason: "Select a Shopify replacement above to include a product link." };
  }
  if (!replacement.productHandle) {
    return { enabled: false, reason: "This Shopify replacement does not have a public storefront handle, so a product link cannot be added." };
  }
  if (!replacement.productUrl) {
    return { enabled: false, reason: "This Shopify replacement is not available on the public Welkom USA website, so a product link cannot be added." };
  }
  return { enabled: true, reason: "This product is available on the Welkom USA website, so a customer link can be included." };
}

module.exports = {
  STOREFRONT_BASE_URL,
  buildStorefrontProductUrl,
  getReplacementProductLinkState,
  normalizeProductHandle,
  parseNumericShopifyId
};
