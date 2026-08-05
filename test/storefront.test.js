const assert = require("node:assert/strict");
const test = require("node:test");

const {
  buildStorefrontProductUrl,
  getReplacementProductLinkState,
  parseNumericShopifyId
} = require("../src/storefront");
const browserStorefront = require("../public/storefront.js");

test("storefront product URLs use the public product handle and selected numeric variant", () => {
  const url = buildStorefrontProductUrl({
    productHandle: "cadbury-flake-chocolate-bar-32g",
    variantId: "gid://shopify/ProductVariant/987654321"
  });
  assert.equal(url, "https://www.welkomusa.com/products/cadbury-flake-chocolate-bar-32g?variant=987654321");
  assert.equal(parseNumericShopifyId("gid://shopify/ProductVariant/987654321"), "987654321");
});

test("storefront product URLs omit the variant query when no numeric variant id is available", () => {
  const url = buildStorefrontProductUrl({
    productHandle: "simply-lekka-burger",
    variantId: ""
  });
  assert.equal(url, "https://www.welkomusa.com/products/simply-lekka-burger");
});

test("manual replacements cannot include product links", () => {
  const state = getReplacementProductLinkState({
    substituteVariantId: "",
    customSubstituteTitle: "Warehouse approved replacement",
    noSubstitutionAvailable: false,
    productHandle: "",
    productUrl: ""
  });
  assert.equal(state.enabled, false);
  assert.match(state.reason, /manually entered replacements/i);
});

test("no replacement available cannot include product links", () => {
  const state = getReplacementProductLinkState({
    substituteVariantId: "",
    customSubstituteTitle: "",
    noSubstitutionAvailable: true,
    productHandle: "",
    productUrl: ""
  });
  assert.equal(state.enabled, false);
  assert.match(state.reason, /no replacement is available/i);
});

test("missing product handles disable product links with a clear explanation", () => {
  const state = browserStorefront.getReplacementProductLinkState({
    substituteVariantId: "gid://shopify/ProductVariant/987654321",
    customSubstituteTitle: "",
    noSubstitutionAvailable: false,
    productHandle: "",
    productUrl: ""
  });
  assert.equal(state.enabled, false);
  assert.match(state.reason, /public storefront handle/i);
});
