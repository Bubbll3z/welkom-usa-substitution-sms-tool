(function initStorefrontHelpers(root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
    return;
  }
  root.WelkomStorefront = factory();
}(typeof globalThis !== "undefined" ? globalThis : this, function storefrontFactory() {
  "use strict";

  const STOREFRONT_BASE_URL = "https://www.welkomusa.com";

  function parseNumericShopifyId(value) {
    const id = String(value || "").trim().split("/").pop() || "";
    return /^\d+$/.test(id) ? id : "";
  }

  function normalizeProductHandle(value) {
    const handle = String(value || "").trim().toLowerCase();
    return /^[a-z0-9][a-z0-9-]*$/.test(handle) ? handle : "";
  }

  function buildStorefrontProductUrl(config) {
    const handle = normalizeProductHandle(config && config.productHandle);
    if (!handle) return "";
    const rootUrl = String((config && config.baseUrl) || STOREFRONT_BASE_URL).trim().replace(/\/+$/, "");
    const variantId = parseNumericShopifyId(config && config.variantId);
    return variantId
      ? `${rootUrl}/products/${encodeURIComponent(handle)}?variant=${encodeURIComponent(variantId)}`
      : `${rootUrl}/products/${encodeURIComponent(handle)}`;
  }

  function getReplacementProductLinkState(replacement) {
    const current = replacement || {};
    if (current.noSubstitutionAvailable) {
      return { enabled: false, reason: "Product links cannot be used when no replacement is available." };
    }
    if (String(current.customSubstituteTitle || "").trim()) {
      return { enabled: false, reason: "Product links cannot be used for manually entered replacements." };
    }
    if (!current.substituteVariantId) {
      return { enabled: false, reason: "Select a Shopify replacement above to include a product link." };
    }
    if (!current.productHandle) {
      return { enabled: false, reason: "This Shopify replacement does not have a public storefront handle, so a product link cannot be added." };
    }
    if (!current.productUrl) {
      return { enabled: false, reason: "This Shopify replacement is not available on the public Welkom USA website, so a product link cannot be added." };
    }
    return { enabled: true, reason: "This product is available on the Welkom USA website, so a customer link can be included." };
  }

  return {
    STOREFRONT_BASE_URL,
    buildStorefrontProductUrl,
    getReplacementProductLinkState,
    normalizeProductHandle,
    parseNumericShopifyId
  };
}));
