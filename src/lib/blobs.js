const { getStore } = require("@netlify/blobs");

const STORES = {
  users: "welkom-sms-users",
  sessions: "welkom-sms-sessions",
  history: "welkom-sms-history",
  templates: "welkom-sms-templates",
  audit: "welkom-sms-audit",
  settings: "welkom-sms-settings",
  rateLimits: "welkom-sms-rate-limits",
  substitutionRequests: "welkom-sms-substitution-requests"
};

function getStoreByName(name) {
  const storeName = STORES[name] || name;
  if (!Object.values(STORES).includes(storeName)) {
    throw new Error("Unknown Blob store.");
  }
  return getStore(storeName);
}

async function blobGet(store, key) {
  const text = await store.get(key, { consistency: "strong" });
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

async function blobSet(store, key, value) {
  await store.set(key, JSON.stringify(value), { consistency: "strong" });
  return value;
}

async function blobDelete(store, key) {
  await store.delete(key);
  return true;
}

module.exports = {
  STORES,
  blobDelete,
  blobGet,
  blobSet,
  getStoreByName
};
