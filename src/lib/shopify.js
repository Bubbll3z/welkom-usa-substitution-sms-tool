const {
  getOrderById,
  getVariantById,
  searchOrders: searchShopifyOrders,
  searchProductsForSubstitutions
} = require("../shopify");

async function searchOrders(query) {
  const result = await searchShopifyOrders(query);
  if (!result.body?.success) return [];
  return result.body.orders;
}

async function getOrder(orderId) {
  const result = await getOrderById(orderId);
  return result.body?.success ? result.body.order : null;
}

async function searchProducts(query, limit = 10) {
  return searchProductsForSubstitutions(query, { limit });
}

async function getProduct(productId) {
  const result = await getVariantById(productId);
  return result.body?.success ? result.body.product : null;
}

module.exports = {
  getOrder,
  getProduct,
  searchOrders,
  searchProducts
};
