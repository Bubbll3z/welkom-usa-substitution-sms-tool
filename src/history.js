const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const memoryRecords = new Map();
const memoryIdempotency = new Map();
const memoryTemplates = new Map();

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

function defaultTemplate() {
  return {
    id: "default-substitution",
    name: "Default substitution",
    body: "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    archived: false,
    isDefault: true,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z"
  };
}

function validateTemplate(data) {
  const body = String(data.body || "").trim();
  const name = String(data.name || "").trim();
  if (!name) return { ok: false, code: "TEMPLATE_INVALID", error: "Template name is required." };
  if (!body) return { ok: false, code: "TEMPLATE_INVALID", error: "Template body is required." };
  for (const token of ["[FIRST NAME]", "[ORDER NUMBER]", "[UNAVAILABLE ITEM]", "[SUBSTITUTE ITEM]"]) {
    if (!body.includes(token)) return { ok: false, code: "TEMPLATE_INVALID", error: `Template must include ${token}.` };
  }
  if (!body.startsWith("Welkom USA:")) return { ok: false, code: "TEMPLATE_INVALID", error: "Template must start with Welkom USA:." };
  if (/<\/?[a-z][\s\S]*>/i.test(body)) return { ok: false, code: "TEMPLATE_INVALID", error: "Template cannot contain HTML." };
  return { ok: true, template: { name, body } };
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

function filterRecords(records, filters = {}) {
  let result = records;
  const query = String(filters.query || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const dryRun = String(filters.dryRun || "").trim();
  if (query) result = result.filter((record) => String(record.orderName || "").toLowerCase().includes(query));
  if (status) result = result.filter((record) => String(record.latestTwilioStatus || record.initialTwilioStatus || "").toLowerCase() === status);
  if (dryRun === "true" || dryRun === "false") result = result.filter((record) => String(Boolean(record.dryRun)) === dryRun);
  return result;
}

async function queryMessageRecords(env = process.env, filters = {}) {
  const limit = Math.min(Number(filters.limit || 25), 100);
  const page = Math.max(Number(filters.page || 1), 1);
  const records = filterRecords(await listMessageRecords(env, 500), filters);
  const start = (page - 1) * limit;
  return {
    records: records.slice(start, start + limit),
    page,
    limit,
    total: records.length,
    totalPages: Math.max(Math.ceil(records.length / limit), 1)
  };
}

async function messageStats(env = process.env) {
  const records = await listMessageRecords(env, 500);
  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  return {
    total: records.length,
    sentToday: records.filter((record) => now - new Date(record.createdAt).getTime() <= day).length,
    sentLast7Days: records.filter((record) => now - new Date(record.createdAt).getTime() <= 7 * day).length,
    failed: records.filter((record) => ["failed", "undelivered"].includes(String(record.latestTwilioStatus || "").toLowerCase())).length,
    dryRun: records.filter((record) => record.dryRun).length,
    production: records.filter((record) => record.dryRun === false).length,
    recent: records.slice(0, 10)
  };
}

async function listTemplates(env = process.env) {
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    const listed = await store.list({ prefix: "templates/" }).catch(() => ({ blobs: [] }));
    const templates = await Promise.all((listed.blobs || []).map((blob) => store.get(blob.key, { type: "json", consistency: "strong" }).catch(() => null)));
    const active = templates.filter((template) => template && !template.archived);
    return active.length ? active : [defaultTemplate()];
  }
  const active = Array.from(memoryTemplates.values()).filter((template) => !template.archived);
  return active.length ? active : [defaultTemplate()];
}

async function saveTemplate(data, env = process.env) {
  const validation = validateTemplate(data);
  if (!validation.ok) return validation;
  const now = new Date().toISOString();
  const template = {
    id: data.id || `tpl_${Date.now()}_${crypto.randomBytes(5).toString("hex")}`,
    name: validation.template.name,
    body: validation.template.body,
    archived: Boolean(data.archived),
    isDefault: Boolean(data.isDefault),
    createdAt: data.createdAt || now,
    updatedAt: now
  };
  if (provider(env) === "netlify-blobs") {
    const store = blobStore(env);
    if (template.isDefault) {
      const existing = await listTemplates(env);
      await Promise.all(existing.map((item) => item.id !== template.id ? store.setJSON(`templates/${item.id}`, { ...item, isDefault: false }) : null));
    }
    await store.setJSON(`templates/${template.id}`, template);
  } else {
    if (template.isDefault) {
      for (const [key, item] of memoryTemplates) memoryTemplates.set(key, { ...item, isDefault: false });
    }
    memoryTemplates.set(template.id, template);
  }
  return { ok: true, template };
}

async function archiveTemplate(id, env = process.env) {
  const templates = await listTemplates(env);
  const template = templates.find((item) => item.id === id);
  if (!template || template.id === defaultTemplate().id) return { ok: false, code: "TEMPLATE_INVALID", error: "Template cannot be archived." };
  return saveTemplate({ ...template, archived: true, isDefault: false }, env);
}

async function backupPayload(env = process.env) {
  return {
    schemaVersion: 1,
    exportedAt: new Date().toISOString(),
    app: "welkom-substitution-sms-tool",
    includes: ["messageHistoryRedacted", "templates"],
    excludes: ["secrets", "sessionCookies", "fullPhoneNumbers", "addresses", "authorizationHeaders"],
    messageHistory: await listMessageRecords(env, 500),
    templates: await listTemplates(env)
  };
}

function recordsToCsv(records) {
  const headers = ["createdAt", "staffIdentity", "orderName", "customerPhoneRedacted", "unavailableTitle", "substituteTitle", "initialTwilioStatus", "latestTwilioStatus", "dryRun", "failureReason"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...records.map((record) => headers.map((header) => escape(record[header])).join(","))].join("\n");
}

function clearMemoryHistory() {
  memoryRecords.clear();
  memoryIdempotency.clear();
  memoryTemplates.clear();
}

module.exports = {
  clearMemoryHistory,
  createMessageRecord,
  duplicateKey,
  findDuplicate,
  findByIdempotency,
  getMessageRecord,
  idempotencyKey,
  archiveTemplate,
  backupPayload,
  listTemplates,
  listMessageRecords,
  messageStats,
  publicRecord,
  queryMessageRecords,
  recordsToCsv,
  saveRecord,
  saveTemplate,
  validateTemplate,
  updateMessageStatus
};
