const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const memoryRecords = new Map();
const memoryIdempotency = new Map();

function provider(env = process.env) {
  return env.MESSAGE_STORAGE_PROVIDER || (env.NETLIFY === "true" ? "netlify-blobs" : "memory");
}

function blobStore(env = process.env) {
  return getStore("welkom-sms-history", {
    siteID: env.NETLIFY_BLOBS_SITE_ID,
    token: env.NETLIFY_BLOBS_TOKEN,
    consistency: "strong"
  });
}

function newId() {
  return `msg_${Date.now()}_${crypto.randomBytes(8).toString("hex")}`;
}

function hashIdempotency(parts) {
  return crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex");
}

function duplicateKey({ orderId, lineItemId, unavailableLineItemId, substituteVariantId }) {
  return hashIdempotency([orderId, lineItemId || unavailableLineItemId, substituteVariantId]);
}

function idempotencyKey({ orderId, lineItemId, unavailableLineItemId, substituteVariantId, message }) {
  return hashIdempotency([orderId, lineItemId || unavailableLineItemId, substituteVariantId, message]);
}

function publicRecord(record) {
  if (!record) return null;
  return {
    id: record.id,
    orderId: record.orderId,
    orderName: record.orderName,
    customerPhoneRedacted: record.customerPhoneRedacted,
    customerFirstName: record.customerFirstName,
    unavailableLineItemId: record.unavailableLineItemId,
    unavailableTitle: record.unavailableTitle,
    substituteVariantId: record.substituteVariantId,
    substituteTitle: record.substituteTitle,
    message: record.message,
    staffIdentity: record.staffIdentity,
    createdAt: record.createdAt,
    twilioMessageSid: record.twilioMessageSid,
    initialTwilioStatus: record.initialTwilioStatus,
    latestTwilioStatus: record.latestTwilioStatus,
    dryRun: record.dryRun,
    failureReason: record.failureReason,
    idempotencyKey: record.idempotencyKey
  };
}

async function saveRecord(record, env = process.env) {
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    await store.setJSON(`records/${record.id}`, record);
    await store.setJSON(`idempotency/${record.idempotencyKey}`, { recordId: record.id }, { onlyIfNew: true }).catch(() => null);
    await store.setJSON(`duplicate/${record.duplicateKey}`, { recordId: record.id, createdAt: record.createdAt }).catch(() => null);
    return record;
  }
  memoryRecords.set(record.id, record);
  if (!memoryIdempotency.has(record.idempotencyKey)) memoryIdempotency.set(record.idempotencyKey, record.id);
  if (!memoryIdempotency.has(`duplicate:${record.duplicateKey}`)) memoryIdempotency.set(`duplicate:${record.duplicateKey}`, record.id);
  return record;
}

async function createMessageRecord(data, env = process.env) {
  const idKey = data.idempotencyKey || idempotencyKey(data);
  const duplicate = duplicateKey(data);
  const existing = await findByIdempotency(idKey, env);
  if (existing) return { record: existing, idempotent: true };
  const record = {
    id: newId(),
    ...data,
    idempotencyKey: idKey,
    duplicateKey: duplicate,
    createdAt: data.createdAt || new Date().toISOString(),
    latestTwilioStatus: data.latestTwilioStatus || data.initialTwilioStatus || "created"
  };
  await saveRecord(record, env);
  return { record, idempotent: false };
}

async function findByIdempotency(key, env = process.env) {
  if (!key) return null;
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    const pointer = await store.get(`idempotency/${key}`, { type: "json", consistency: "strong" }).catch(() => null);
    return pointer?.recordId ? getMessageRecord(pointer.recordId, env) : null;
  }
  const id = memoryIdempotency.get(key);
  return id ? memoryRecords.get(id) : null;
}

async function findDuplicate(data, env = process.env) {
  const key = duplicateKey(data);
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    const pointer = await store.get(`duplicate/${key}`, { type: "json", consistency: "strong" }).catch(() => null);
    return pointer?.recordId ? getMessageRecord(pointer.recordId, env) : null;
  }
  const id = memoryIdempotency.get(`duplicate:${key}`);
  return id ? memoryRecords.get(id) : null;
}

async function getMessageRecord(id, env = process.env) {
  if (provider(env) === "netlify-blobs") {
    return blobStore(env).get(`records/${id}`, { type: "json", consistency: "strong" }).catch(() => null);
  }
  return memoryRecords.get(id) || null;
}

async function updateMessageStatus(id, status, env = process.env) {
  const record = await getMessageRecord(id, env);
  if (!record) return null;
  record.latestTwilioStatus = status || record.latestTwilioStatus;
  record.updatedAt = new Date().toISOString();
  await saveRecord(record, env);
  return record;
}

async function listMessageRecords(env = process.env, limit = 50) {
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    const listed = await store.list({ prefix: "records/" }).catch(() => ({ blobs: [] }));
    const records = await Promise.all(
      (listed.blobs || []).slice(-limit).map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }).catch(() => null))
    );
    return records.filter(Boolean).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))).map(publicRecord);
  }
  return Array.from(memoryRecords.values())
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map(publicRecord);
}

function clearMemoryHistory() {
  memoryRecords.clear();
  memoryIdempotency.clear();
}

module.exports = {
  clearMemoryHistory,
  createMessageRecord,
  duplicateKey,
  findDuplicate,
  findByIdempotency,
  getMessageRecord,
  idempotencyKey,
  listMessageRecords,
  publicRecord,
  saveRecord,
  updateMessageStatus
};
