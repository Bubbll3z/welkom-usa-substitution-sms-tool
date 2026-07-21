const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");

const SCHEMA_VERSION = 1;
const DEFAULT_TEMPLATE_BODY = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";

const STORE_NAMES = {
  history: "welkom-sms-history",
  templates: "welkom-sms-templates",
  audit: "welkom-sms-audit",
  settings: "welkom-sms-settings"
};

const memoryStores = {
  history: new Map(),
  templates: new Map(),
  audit: new Map(),
  settings: new Map()
};

let storeFactory = null;

function setStoreFactory(factory) {
  storeFactory = factory;
}

function resetStoreFactory() {
  storeFactory = null;
}

function provider(env = process.env) {
  return String(env.MESSAGE_STORAGE_PROVIDER || (env.NETLIFY === "true" ? "netlify-blobs" : "memory")).toLowerCase();
}

function useBlobs(env = process.env) {
  return provider(env) === "netlify-blobs";
}

function store(kind, env = process.env) {
  if (storeFactory) return storeFactory(STORE_NAMES[kind], kind);
  if (useBlobs(env)) return getStore(STORE_NAMES[kind]);
  return memoryStore(kind);
}

function memoryStore(kind) {
  const backing = memoryStores[kind];
  return {
    async get(key) {
      return backing.has(key) ? backing.get(key) : null;
    },
    async set(key, value, options = {}) {
      if (options.onlyIfNew && backing.has(key)) {
        const error = new Error("Blob already exists.");
        error.code = "BLOB_ALREADY_EXISTS";
        throw error;
      }
      backing.set(key, value);
    },
    async setJSON(key, value, options = {}) {
      await this.set(key, JSON.stringify(value), options);
    },
    async list(options = {}) {
      const prefix = options.prefix || "";
      return {
        blobs: Array.from(backing.keys()).filter((key) => key.startsWith(prefix)).sort().map((key) => ({ key }))
      };
    }
  };
}

function clearMemoryHistory() {
  for (const item of Object.values(memoryStores)) item.clear();
}

function nowIso() {
  return new Date().toISOString();
}

function newId(prefix) {
  return `${prefix}_${crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")}`;
}

function hashIdempotency(parts) {
  return crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex");
}

function duplicateKey({ orderId, lineItemId, unavailableLineItemId, substituteVariantId, customSubstituteTitle }) {
  return hashIdempotency([orderId, lineItemId || unavailableLineItemId, substituteVariantId || customSubstituteTitle]);
}

function idempotencyKey({ orderId, lineItemId, unavailableLineItemId, substituteVariantId, customSubstituteTitle, message }) {
  return hashIdempotency([orderId, lineItemId || unavailableLineItemId, substituteVariantId || customSubstituteTitle, message]);
}

function safeJson(value) {
  if (!value) return null;
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch (error) {
    return null;
  }
}

function scrubText(value) {
  return String(value ?? "")
    .replace(/shpat_[A-Za-z0-9_]+/g, "[redacted-shopify-token]")
    .replace(/\bAC[a-fA-F0-9]{32}\b/g, "[redacted-twilio-sid]")
    .replace(/\bSK[a-fA-F0-9]{32}\b/g, "[redacted-twilio-api-key]")
    .replace(/TWILIO_AUTH_TOKEN/gi, "[redacted-secret-name]")
    .replace(/SESSION_SECRET/gi, "[redacted-secret-name]");
}

function scrubObject(value) {
  if (Array.isArray(value)) return value.map(scrubObject);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [scrubText(key), scrubObject(item)]));
  }
  if (typeof value === "string") return scrubText(value);
  return value;
}

async function getJsonSafe(targetStore, key) {
  const raw = await targetStore.get(key, { type: "json", consistency: "strong" }).catch(() => null);
  return safeJson(raw);
}

async function setJson(targetStore, key, value, options = {}) {
  if (typeof targetStore.setJSON === "function") return targetStore.setJSON(key, value, options);
  return targetStore.set(key, JSON.stringify(value), options);
}

function publicRecord(record) {
  if (!record) return null;
  return {
    schemaVersion: record.schemaVersion || SCHEMA_VERSION,
    id: record.id,
    orderId: record.orderId,
    orderName: scrubText(record.orderName),
    customerPhoneRedacted: record.customerPhoneRedacted,
    customerFirstName: scrubText(record.customerFirstName),
    unavailableLineItemId: record.unavailableLineItemId,
    unavailableTitle: scrubText(record.unavailableTitle),
    substituteVariantId: record.substituteVariantId,
    substituteTitle: scrubText(record.substituteTitle),
    customSubstitute: Boolean(record.customSubstitute),
    message: scrubText(record.message),
    staffIdentity: scrubText(record.staffIdentity),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    twilioMessageSid: record.twilioMessageSid,
    initialTwilioStatus: record.initialTwilioStatus,
    latestTwilioStatus: record.latestTwilioStatus,
    dryRun: record.dryRun,
    failureReason: scrubText(record.failureReason),
    idempotencyKey: record.idempotencyKey
  };
}

function validateMessageInput(data) {
  if (!data || typeof data !== "object") return { ok: false, code: "INVALID_RECORD", error: "Message record is invalid." };
  if (!data.orderId || !data.orderName || !data.unavailableLineItemId || !data.unavailableTitle || !data.substituteTitle) {
    return { ok: false, code: "INVALID_RECORD", error: "Message record is missing required fields." };
  }
  if (!data.customerPhoneRedacted || /\+\d{7,}/.test(String(data.customerPhoneRedacted))) {
    return { ok: false, code: "INVALID_RECORD", error: "Message history requires a redacted customer phone." };
  }
  return { ok: true };
}

async function pointerRecord(targetStore, prefix, key, env) {
  const pointer = await getJsonSafe(targetStore, `${prefix}/${key}`);
  return pointer?.recordId ? getMessageRecord(pointer.recordId, env) : null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pointerRecordWithRetry(targetStore, prefix, key, env) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const record = await pointerRecord(targetStore, prefix, key, env);
    if (record) return record;
    await sleep(10 * (attempt + 1));
  }
  return null;
}

async function findByIdempotency(key, env = process.env) {
  if (!key) return null;
  return pointerRecord(store("history", env), "idempotency", key, env);
}

async function checkDuplicateMessage(data, env = process.env) {
  return pointerRecord(store("history", env), "duplicates", duplicateKey(data), env);
}

async function findDuplicate(data, env = process.env) {
  return checkDuplicateMessage(data, env);
}

async function createAuditRecord(data, env = process.env) {
  const id = data.id || newId("audit");
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id,
    type: String(data.type || "event").slice(0, 80),
    actor: scrubText(String(data.actor || data.staffIdentity || "system").slice(0, 120)),
    messageRecordId: data.messageRecordId || "",
    details: data.details && typeof data.details === "object" ? scrubObject(data.details) : {},
    createdAt: data.createdAt || nowIso()
  };
  await setJson(store("audit", env), `events/${record.createdAt}_${record.id}`, record);
  return record;
}

async function createMessageRecord(data, env = process.env) {
  const validation = validateMessageInput(data);
  if (!validation.ok) return validation;

  const targetStore = store("history", env);
  const idKey = data.idempotencyKey || idempotencyKey(data);
  const duplicate = duplicateKey(data);
  const existing = await findByIdempotency(idKey, env);
  if (existing) return { ok: true, record: existing, idempotent: true };

  const id = data.id || newId("msg");
  const createdAt = data.createdAt || nowIso();
  const record = {
    schemaVersion: SCHEMA_VERSION,
    id,
    orderId: data.orderId,
    orderName: data.orderName,
    customerPhoneRedacted: data.customerPhoneRedacted,
    customerFirstName: data.customerFirstName || "",
    unavailableLineItemId: data.unavailableLineItemId,
    unavailableTitle: data.unavailableTitle,
    substituteVariantId: data.substituteVariantId || "",
    substituteTitle: data.substituteTitle,
    customSubstitute: Boolean(data.customSubstitute),
    customSubstituteTitle: data.customSubstituteTitle || "",
    message: String(data.message || ""),
    staffIdentity: String(data.staffIdentity || "unknown").slice(0, 120),
    initialTwilioStatus: data.initialTwilioStatus || "created",
    latestTwilioStatus: data.latestTwilioStatus || data.initialTwilioStatus || "created",
    twilioMessageSid: data.twilioMessageSid || "",
    dryRun: data.dryRun,
    failureReason: data.failureReason || "",
    idempotencyKey: idKey,
    duplicateKey: duplicate,
    createdAt,
    updatedAt: data.updatedAt || createdAt
  };

  try {
    await setJson(targetStore, `duplicates/${duplicate}`, { schemaVersion: SCHEMA_VERSION, recordId: id, createdAt }, { onlyIfNew: true });
    await setJson(targetStore, `idempotency/${idKey}`, { schemaVersion: SCHEMA_VERSION, recordId: id, createdAt }, { onlyIfNew: true });
    await setJson(targetStore, `records/${id}`, record);
    await createAuditRecord({ type: "message_record_created", actor: record.staffIdentity, messageRecordId: id }, env);
    return { ok: true, record, idempotent: false };
  } catch (writeError) {
    const raced = await pointerRecordWithRetry(targetStore, "idempotency", idKey, env) || await pointerRecordWithRetry(targetStore, "duplicates", duplicate, env);
    if (raced) return { ok: true, record: raced, idempotent: true };
    return { ok: false, code: "STORAGE_ERROR", error: "Message history could not be saved." };
  }
}

async function saveRecord(record, env = process.env) {
  if (!record?.id) return null;
  const next = { ...record, schemaVersion: record.schemaVersion || SCHEMA_VERSION, updatedAt: nowIso() };
  await setJson(store("history", env), `records/${next.id}`, next);
  return next;
}

async function getMessageRecord(id, env = process.env) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const record = await getJsonSafe(store("history", env), `records/${id}`);
  return record?.id ? record : null;
}

async function updateMessageStatus(id, status, env = process.env) {
  const record = await getMessageRecord(id, env);
  if (!record) return null;
  record.latestTwilioStatus = String(status || record.latestTwilioStatus || "").slice(0, 80);
  record.updatedAt = nowIso();
  const saved = await saveRecord(record, env);
  await createAuditRecord({ type: "message_status_updated", messageRecordId: id, details: { status: record.latestTwilioStatus } }, env);
  return saved;
}

async function listRawByPrefix(targetStore, prefix, limit = 500) {
  const listed = await targetStore.list({ prefix }).catch(() => ({ blobs: [] }));
  const keys = (listed.blobs || []).map((blob) => blob.key).filter(Boolean).sort().slice(-limit);
  const records = await Promise.all(keys.map((key) => getJsonSafe(targetStore, key)));
  return records.filter((item) => item && typeof item === "object");
}

async function listMessageRecords(env = process.env, limit = 50) {
  const records = await listRawByPrefix(store("history", env), "records/", Math.max(limit, 1));
  return records
    .filter((record) => record.id)
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
    .slice(0, limit)
    .map(publicRecord);
}

function filterRecords(records, filters = {}) {
  let result = records;
  const query = String(filters.query || filters.search || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  const dryRun = String(filters.dryRun || "").trim();
  if (query) {
    result = result.filter((record) => [
      record.orderName,
      record.customerPhoneRedacted,
      record.staffIdentity,
      record.message,
      record.unavailableTitle,
      record.substituteTitle
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }
  if (status) result = result.filter((record) => String(record.latestTwilioStatus || record.initialTwilioStatus || "").toLowerCase() === status);
  if (dryRun === "true" || dryRun === "false") result = result.filter((record) => String(Boolean(record.dryRun)) === dryRun);
  return result;
}

async function queryMessageRecords(env = process.env, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);
  const page = Math.max(Number(filters.page || 1), 1);
  const records = filterRecords(await listMessageRecords(env, 1000), filters);
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
  const records = await listMessageRecords(env, 1000);
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

function defaultTemplate() {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: "default-substitution",
    name: "Default substitution",
    body: DEFAULT_TEMPLATE_BODY,
    archived: false,
    isDefault: true,
    createdAt: "2026-07-21T00:00:00.000Z",
    updatedAt: "2026-07-21T00:00:00.000Z"
  };
}

function validateTemplate(data) {
  const body = String(data?.body || "").trim();
  const name = String(data?.name || "").trim();
  if (!name) return { ok: false, code: "TEMPLATE_INVALID", error: "Template name is required." };
  if (!body) return { ok: false, code: "TEMPLATE_INVALID", error: "Template body is required." };
  if (body.length > 320) return { ok: false, code: "TEMPLATE_INVALID", error: "Template body is too long." };
  for (const token of ["[FIRST NAME]", "[ORDER NUMBER]", "[UNAVAILABLE ITEM]", "[SUBSTITUTE ITEM]"]) {
    if (!body.includes(token)) return { ok: false, code: "TEMPLATE_INVALID", error: `Template must include ${token}.` };
  }
  if (!body.startsWith("Welkom USA:")) return { ok: false, code: "TEMPLATE_INVALID", error: "Template must start with Welkom USA:." };
  if (/<\/?[a-z][\s\S]*>/i.test(body)) return { ok: false, code: "TEMPLATE_INVALID", error: "Template cannot contain HTML." };
  return { ok: true, template: { name, body } };
}

async function listTemplates(env = process.env) {
  const templates = await listRawByPrefix(store("templates", env), "templates/", 500);
  const active = templates.filter((template) => template.id && !template.archived);
  return active.length ? active.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))) : [defaultTemplate()];
}

async function createTemplate(data, env = process.env) {
  return updateTemplate({ ...data, id: data?.id || newId("tpl") }, env);
}

async function updateTemplate(data, env = process.env) {
  const validation = validateTemplate(data);
  if (!validation.ok) return validation;
  const now = nowIso();
  const id = data.id || newId("tpl");
  const existing = await getJsonSafe(store("templates", env), `templates/${id}`);
  const template = {
    schemaVersion: SCHEMA_VERSION,
    id,
    name: validation.template.name,
    body: validation.template.body,
    archived: Boolean(data.archived),
    isDefault: Boolean(data.isDefault),
    createdAt: existing?.createdAt || data.createdAt || now,
    updatedAt: now
  };
  await setJson(store("templates", env), `templates/${id}`, template);
  await createAuditRecord({ type: existing ? "template_updated" : "template_created", details: { templateId: id } }, env);
  return { ok: true, template };
}

async function saveTemplate(data, env = process.env) {
  return data?.id ? updateTemplate(data, env) : createTemplate(data, env);
}

async function archiveTemplate(id, env = process.env) {
  if (!id || id === defaultTemplate().id) return { ok: false, code: "TEMPLATE_INVALID", error: "Template cannot be archived." };
  const existing = await getJsonSafe(store("templates", env), `templates/${id}`);
  if (!existing?.id) return { ok: false, code: "TEMPLATE_NOT_FOUND", error: "Template was not found." };
  const archived = { ...existing, archived: true, isDefault: false, updatedAt: nowIso() };
  await setJson(store("templates", env), `templates/${id}`, archived);
  await createAuditRecord({ type: "template_archived", details: { templateId: id } }, env);
  return { ok: true, template: archived };
}

async function initializeDataStores(env = process.env) {
  const existingTemplates = await listRawByPrefix(store("templates", env), "templates/", 20);
  const wroteDefaultTemplate = existingTemplates.length === 0;
  if (wroteDefaultTemplate) {
    await setJson(store("templates", env), "templates/default-substitution", defaultTemplate(), { onlyIfNew: true }).catch(() => null);
  }
  const initializedAt = nowIso();
  const settingsRecord = {
    schemaVersion: SCHEMA_VERSION,
    key: "blob_initialization",
    app: "welkom-substitution-sms-tool",
    storeNames: STORE_NAMES,
    initializedAt
  };
  await setJson(store("settings", env), "settings/blob_initialization", settingsRecord, { onlyIfNew: true }).catch(() => null);
  await createAuditRecord({ type: "blob_stores_initialized", details: { wroteDefaultTemplate } }, env);
  return {
    ok: true,
    initializedAt,
    wroteDefaultTemplate,
    stores: STORE_NAMES
  };
}

async function exportSafeBackup(env = process.env) {
  return {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    app: "welkom-substitution-sms-tool",
    stores: STORE_NAMES,
    includes: ["messageHistoryRedacted", "templates", "audit", "nonSecretSettings"],
    excludes: ["secrets", "sessionCookies", "fullPhoneNumbers", "completeAddresses", "authorizationHeaders", "shopifyAccessTokens", "twilioAuthTokens"],
    messageHistory: await listMessageRecords(env, 1000),
    templates: await listTemplates(env),
    audit: await listRawByPrefix(store("audit", env), "events/", 1000),
    settings: await listRawByPrefix(store("settings", env), "settings/", 100)
  };
}

async function backupPayload(env = process.env) {
  return exportSafeBackup(env);
}

function recordsToCsv(records) {
  const headers = ["createdAt", "staffIdentity", "orderName", "customerPhoneRedacted", "unavailableTitle", "substituteTitle", "initialTwilioStatus", "latestTwilioStatus", "dryRun", "failureReason"];
  const escape = (value) => `"${String(value ?? "").replace(/"/g, '""')}"`;
  return [headers.join(","), ...records.map((record) => headers.map((header) => escape(record[header])).join(","))].join("\n");
}

module.exports = {
  STORE_NAMES,
  SCHEMA_VERSION,
  DEFAULT_TEMPLATE_BODY,
  archiveTemplate,
  backupPayload,
  checkDuplicateMessage,
  clearMemoryHistory,
  createAuditRecord,
  createMessageRecord,
  createTemplate,
  defaultTemplate,
  duplicateKey,
  exportSafeBackup,
  findByIdempotency,
  findDuplicate,
  getMessageRecord,
  idempotencyKey,
  initializeDataStores,
  listMessageRecords,
  listTemplates,
  messageStats,
  publicRecord,
  queryMessageRecords,
  recordsToCsv,
  resetStoreFactory,
  saveRecord,
  saveTemplate,
  setStoreFactory,
  updateMessageStatus,
  updateTemplate,
  validateTemplate
};
