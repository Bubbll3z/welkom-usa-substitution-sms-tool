const crypto = require("node:crypto");
const { getStore } = require("@netlify/blobs");
const { redactObject, redactString } = require("./safe-logger");

const SCHEMA_VERSION = 1;
const DEFAULT_TEMPLATE_BODY = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";

const STORE_NAMES = {
  history: "welkom-sms-history",
  templates: "welkom-sms-templates",
  audit: "welkom-sms-audit",
  settings: "welkom-sms-settings",
  requests: "welkom-sms-substitution-requests"
};

const INIT_STATUS = {
  initialized: "initialized",
  existing: "already-initialized"
};

class StoreInitializationError extends Error {
  constructor({ stage, storeName, recordType, fieldName, rule, code, cause }) {
    super(`Blob initialization failed at ${stage}.`);
    this.name = "StoreInitializationError";
    this.stage = stage;
    this.storeName = storeName;
    this.recordType = recordType;
    this.fieldName = fieldName || "";
    this.rule = rule || "";
    this.code = code || cause?.code || "STORAGE_ERROR";
    this.cause = cause;
  }
}

const memoryStores = {
  history: new Map(),
  templates: new Map(),
  audit: new Map(),
  settings: new Map(),
  requests: new Map()
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
    async delete(key) {
      backing.delete(key);
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

function createResponseToken() {
  return crypto.randomBytes(32).toString("base64url");
}

function hashResponseToken(token, env = process.env) {
  const pepper = String(env.SUBSTITUTION_TOKEN_PEPPER || "");
  return crypto.createHash("sha256").update(`${pepper}:${String(token || "")}`).digest("hex");
}

function hashIdempotency(parts) {
  return crypto.createHash("sha256").update(parts.filter(Boolean).join("|")).digest("hex");
}

function hashPhoneNumber(phone, env = process.env) {
  const pepper = String(env.RATE_LIMIT_KEY_PEPPER || env.SUBSTITUTION_TOKEN_PEPPER || "");
  return crypto.createHash("sha256").update(`${pepper}:phone:${String(phone || "").trim()}`).digest("hex");
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
  return redactString(String(value ?? ""))
    .replace(/shpat_[A-Za-z0-9_]+/g, "[redacted-shopify-token]")
    .replace(/\bAC[a-fA-F0-9]{32}\b/g, "[redacted-twilio-sid]")
    .replace(/\bSK[a-fA-F0-9]{32}\b/g, "[redacted-twilio-api-key]")
    .replace(/TWILIO_AUTH_TOKEN/gi, "[redacted-secret-name]")
    .replace(/SESSION_SECRET/gi, "[redacted-secret-name]");
}

function scrubObject(value) {
  return redactObject(value);
}

function scrubCustomerText(value, max = 240) {
  return scrubText(String(value || "").trim().replace(/\s+/g, " ").replace(/<\/?[a-z][\s\S]*>/gi, "")).slice(0, max);
}

async function getJsonSafe(targetStore, key) {
  const raw = await targetStore.get(key, { type: "json", consistency: "strong" }).catch(() => null);
  return safeJson(raw);
}

function parseMoneyValue(value) {
  const match = String(value || "").match(/(-?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function currencyFromMoney(value, fallback = "USD") {
  const match = String(value || "").match(/^([A-Z]{3})\s/);
  return match ? match[1] : fallback;
}

function priceDifference(originalPrice, substitutePrice) {
  const diff = parseMoneyValue(substitutePrice) - parseMoneyValue(originalPrice);
  return Number.isFinite(diff) ? Number(diff.toFixed(2)) : 0;
}

async function setJson(targetStore, key, value, options = {}) {
  if (typeof targetStore.setJSON === "function") return targetStore.setJSON(key, value, options);
  return targetStore.set(key, JSON.stringify(value), options);
}

async function deleteKey(targetStore, key) {
  if (typeof targetStore.delete === "function") {
    await targetStore.delete(key).catch(() => {});
    return true;
  }
  return false;
}

function initializationFailure(stage, storeKind, recordType, cause, fieldName = "", rule = "") {
  return new StoreInitializationError({
    stage,
    storeName: STORE_NAMES[storeKind] || storeKind,
    recordType,
    fieldName,
    rule,
    code: cause?.code || "STORAGE_ERROR",
    cause
  });
}

async function setJsonOnlyIfNew(storeKind, key, value, stage, recordType) {
  try {
    await setJson(store(storeKind), key, value, { onlyIfNew: true });
    return INIT_STATUS.initialized;
  } catch (error) {
    if (error?.code === "BLOB_ALREADY_EXISTS" || error?.status === 412) return INIT_STATUS.existing;
    throw initializationFailure(stage, storeKind, recordType, error);
  }
}

function safeInitializationSettings(initializedAt) {
  return {
    schemaVersion: SCHEMA_VERSION,
    dryRun: true,
    smsConsentRequired: true,
    duplicateWindowMinutes: 0,
    defaultTemplateId: "default-substitution",
    initializedAt
  };
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

function requestStatus(record, at = Date.now()) {
  if (!record) return "invalid";
  if (record.revokedAt) return "revoked";
  if (record.completedAt || record.status === "completed") return "completed";
  if (record.submittedAt || record.status === "customer_responded") return "customer_responded";
  if (record.expiresAt && new Date(record.expiresAt).getTime() <= at) return "expired";
  if (record.openedAt || record.status === "opened") return "opened";
  return record.status || "awaiting_customer";
}

function safeRequestForStaff(record, includeToken = false) {
  if (!record) return null;
  const status = requestStatus(record);
  return {
    schemaVersion: record.schemaVersion || SCHEMA_VERSION,
    requestId: record.requestId,
    orderNumber: scrubText(record.orderNumber),
    store: record.store,
    status,
    items: scrubObject(record.items || []),
    staffNote: scrubText(record.staffNote),
    createdBy: scrubText(record.createdBy),
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    openedAt: record.openedAt,
    submittedAt: record.submittedAt,
    completedAt: record.completedAt,
    revokedAt: record.revokedAt,
    sms: scrubObject(record.sms || {}),
    audit: scrubObject(record.audit || []),
    publicUrl: includeToken ? scrubText(record.transientPublicUrl || "") : "",
    submissionVersion: Number(record.submissionVersion || 0),
    submittedChoices: scrubObject(record.submittedChoices || [])
  };
}

function safeRequestForCustomer(record) {
  if (!record) return null;
  const status = requestStatus(record);
  const safeItems = (record.items || []).map((item) => ({
    requestItemId: item.requestItemId,
    originalTitle: scrubText(item.originalTitle),
    originalImageUrl: item.originalImageUrl || "",
    originalPrice: item.originalPrice || "",
    currency: item.currency || currencyFromMoney(item.originalPrice),
    quantity: item.quantity,
    substituteOptions: (item.substituteOptions || []).map((option) => ({
      optionId: option.optionId,
      productTitle: scrubText(option.productTitle),
      variantTitle: scrubText(option.variantTitle),
      sku: scrubText(option.sku),
      imageUrl: option.imageUrl || "",
      price: option.price || "",
      priceDifference: option.priceDifference,
      availableQuantityAtCreation: option.availableQuantityAtCreation
    })),
    customerChoice: item.customerChoice || null
  }));
  return {
    requestId: record.requestId,
    orderNumber: scrubText(record.orderNumber),
    maskedOrderReference: record.orderNumber ? `order #${String(record.orderNumber).replace(/^#/, "")}` : "your order",
    status,
    expiresAt: record.expiresAt,
    openedAt: record.openedAt,
    submittedAt: record.submittedAt,
    revokedAt: record.revokedAt,
    completedAt: record.completedAt,
    items: safeItems,
    submissionVersion: Number(record.submissionVersion || 0),
    submittedChoices: scrubObject(record.submittedChoices || [])
  };
}

function appendRequestAudit(record, type, actor = "system", details = {}) {
  const audit = Array.isArray(record.audit) ? record.audit : [];
  return {
    ...record,
    audit: [
      ...audit,
      {
        eventType: scrubText(type, 80),
        timestamp: nowIso(),
        actor: scrubText(actor, 120),
        details: scrubObject(details)
      }
    ].slice(-100)
  };
}

function validateSubstitutionRequestInput(data) {
  if (!data || typeof data !== "object") return { ok: false, code: "INVALID_REQUEST", error: "Request is invalid." };
  if (!data.shopifyOrderId || !data.orderNumber) {
    return { ok: false, code: "INVALID_REQUEST", error: "Order reference is required." };
  }
  const items = Array.isArray(data.items) ? data.items : [];
  if (!items.length) return { ok: false, code: "INVALID_REQUEST", error: "At least one unavailable item is required." };
  if (items.length > 10) return { ok: false, code: "INVALID_REQUEST", error: "Too many unavailable items in one request." };
  for (const item of items) {
    if (!item.originalLineItemId || !item.originalTitle || !Number(item.quantity)) {
      return { ok: false, code: "INVALID_REQUEST", error: "Each unavailable item needs a title and quantity." };
    }
    const options = Array.isArray(item.substituteOptions) ? item.substituteOptions : [];
    if (options.length > 3) return { ok: false, code: "INVALID_REQUEST", error: "Each item can have up to three substitute options." };
    const seen = new Set();
    for (const option of options) {
      if (!option.variantId || seen.has(option.variantId)) return { ok: false, code: "INVALID_REQUEST", error: "Duplicate or invalid substitute option." };
      seen.add(option.variantId);
      if (!option.productTitle || !option.price) return { ok: false, code: "INVALID_REQUEST", error: "Each substitute needs a title and price." };
    }
  }
  return { ok: true };
}

async function createSubstitutionRequest(data, env = process.env) {
  const validation = validateSubstitutionRequestInput(data);
  if (!validation.ok) return validation;
  const token = data.token || createResponseToken();
  const tokenHash = hashResponseToken(token, env);
  const now = nowIso();
  const expiresAt = data.expiresAt || new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const requestId = data.requestId || newId("req");
  const baseUrl = String(data.baseUrl || env.PUBLIC_APP_URL || env.URL || "").replace(/\/$/, "");
  const record = appendRequestAudit({
    schemaVersion: SCHEMA_VERSION,
    requestId,
    tokenHash,
    shopifyOrderId: data.shopifyOrderId,
    orderNumber: String(data.orderNumber || "").replace(/^#/, ""),
    store: "welkom-usa",
    status: data.status || "awaiting_customer",
    items: data.items.map((item) => ({
      requestItemId: item.requestItemId || newId("item"),
      originalLineItemId: item.originalLineItemId,
      originalVariantId: item.originalVariantId || "",
      originalTitle: scrubCustomerText(item.originalTitle, 160),
      originalImageUrl: item.originalImageUrl || "",
      originalPrice: item.originalPrice || "",
      currency: item.currency || currencyFromMoney(item.originalPrice),
      quantity: Number(item.quantity || 1),
      staffNote: scrubCustomerText(item.staffNote || "", 180),
      substituteOptions: (item.substituteOptions || []).slice(0, 3).map((option) => ({
        optionId: option.optionId || newId("opt"),
        variantId: option.variantId,
        productTitle: scrubCustomerText(option.productTitle, 160),
        variantTitle: scrubCustomerText(option.variantTitle, 120),
        sku: scrubCustomerText(option.sku, 80),
        imageUrl: option.imageUrl || "",
        price: option.price || "",
        originalPrice: item.originalPrice || "",
        priceDifference: priceDifference(item.originalPrice, option.price),
        availableQuantityAtCreation: Number.isFinite(option.availableQuantityAtCreation) ? option.availableQuantityAtCreation : null,
        quantity: Number(option.quantity || item.quantity || 1),
        staffNote: scrubCustomerText(option.staffNote || "", 120)
      })),
      customerChoice: null
    })),
    staffNote: scrubCustomerText(data.staffNote || "", 240),
    createdBy: scrubCustomerText(data.createdBy || "staff", 120),
    createdAt: data.createdAt || now,
    updatedAt: data.updatedAt || now,
    expiresAt,
    openedAt: null,
    submittedAt: null,
    completedAt: null,
    revokedAt: null,
    sms: data.sms || {},
    submissionVersion: 0,
    submittedChoices: []
  }, "request_created", data.createdBy || "staff");

  const targetStore = store("requests", env);
  try {
    await setJson(targetStore, `tokens/${tokenHash}`, { schemaVersion: SCHEMA_VERSION, requestId, createdAt: now }, { onlyIfNew: true });
    await setJson(targetStore, `requests/${requestId}`, record, { onlyIfNew: true });
    await createAuditRecord({ type: "substitution_request_created", actor: record.createdBy, details: { requestId, orderNumber: record.orderNumber } }, env);
    return {
      ok: true,
      token,
      publicUrl: baseUrl ? `${baseUrl}/respond/${token}` : `/respond/${token}`,
      request: safeRequestForStaff({ ...record, transientPublicUrl: baseUrl ? `${baseUrl}/respond/${token}` : `/respond/${token}` }, true),
      record
    };
  } catch (error) {
    return { ok: false, code: "STORAGE_ERROR", error: "Substitution request could not be saved." };
  }
}

async function getSubstitutionRequest(id, env = process.env) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const record = await getJsonSafe(store("requests", env), `requests/${id}`);
  return record?.requestId ? record : null;
}

async function getSubstitutionRequestByToken(token, env = process.env) {
  if (!token || !/^[A-Za-z0-9_-]{32,}$/.test(String(token))) return null;
  const tokenHash = hashResponseToken(token, env);
  const pointer = await getJsonSafe(store("requests", env), `tokens/${tokenHash}`);
  if (!pointer?.requestId) return null;
  const record = await getSubstitutionRequest(pointer.requestId, env);
  return record?.tokenHash === tokenHash ? record : null;
}

async function rotateSubstitutionRequestToken(id, baseUrl = "", actor = "staff", env = process.env) {
  const record = await getSubstitutionRequest(id, env);
  if (!record) return { ok: false, code: "NOT_FOUND", error: "Substitution request was not found." };
  const token = createResponseToken();
  const tokenHash = hashResponseToken(token, env);
  const publicBase = String(baseUrl || env.PUBLIC_APP_URL || env.URL || "").replace(/\/$/, "");
  const publicUrl = publicBase ? `${publicBase}/respond/${token}` : `/respond/${token}`;
  const next = appendRequestAudit({
    ...record,
    tokenHash,
    updatedAt: nowIso()
  }, "request_token_rotated", actor);
  try {
    await setJson(store("requests", env), `tokens/${tokenHash}`, { schemaVersion: SCHEMA_VERSION, requestId: id, createdAt: nowIso() }, { onlyIfNew: true });
    const saved = await saveSubstitutionRequest(next, env);
    return { ok: true, token, publicUrl, record: saved };
  } catch (error) {
    return { ok: false, code: "STORAGE_ERROR", error: "Substitution request token could not be created." };
  }
}

async function saveSubstitutionRequest(record, env = process.env) {
  if (!record?.requestId) return null;
  const next = { ...record, status: requestStatus(record), updatedAt: nowIso() };
  await setJson(store("requests", env), `requests/${next.requestId}`, next);
  return next;
}

function validateCustomerChoices(record, choices) {
  const byItem = new Map((record.items || []).map((item) => [item.requestItemId, item]));
  const submitted = Array.isArray(choices) ? choices : [];
  if (submitted.length !== byItem.size) {
    return { ok: false, code: "INVALID_RESPONSE", error: "Please choose one option for each unavailable item." };
  }
  const cleanChoices = [];
  const seen = new Set();
  for (const choice of submitted) {
    const item = byItem.get(choice.requestItemId);
    if (!item || seen.has(choice.requestItemId)) return { ok: false, code: "INVALID_RESPONSE", error: "One of the selected items is invalid." };
    seen.add(choice.requestItemId);
    const type = String(choice.type || "").trim();
    if (!["substitute", "refund", "store_choice", "contact"].includes(type)) {
      return { ok: false, code: "INVALID_RESPONSE", error: "One of the selected choices is invalid." };
    }
    let selectedOption = null;
    if (type === "substitute") {
      selectedOption = (item.substituteOptions || []).find((option) => option.optionId === choice.optionId);
      if (!selectedOption) return { ok: false, code: "INVALID_RESPONSE", error: "Selected substitute is not approved for this request." };
    }
    cleanChoices.push({
      requestItemId: item.requestItemId,
      originalTitle: item.originalTitle,
      type,
      optionId: selectedOption?.optionId || "",
      productTitle: selectedOption?.productTitle || "",
      variantTitle: selectedOption?.variantTitle || "",
      price: selectedOption?.price || "",
      priceDifference: selectedOption?.priceDifference ?? null,
      note: scrubCustomerText(choice.note || "", 160)
    });
  }
  return { ok: true, choices: cleanChoices };
}

async function markSubstitutionRequestOpened(token, env = process.env) {
  const record = await getSubstitutionRequestByToken(token, env);
  if (!record) return { ok: false, status: 404, code: "REQUEST_UNAVAILABLE", error: "This request is not available." };
  const status = requestStatus(record);
  if (status === "awaiting_customer") {
    const opened = appendRequestAudit({ ...record, status: "opened", openedAt: record.openedAt || nowIso() }, "link_opened");
    const saved = await saveSubstitutionRequest(opened, env);
    await createAuditRecord({ type: "link_opened", details: { requestId: saved.requestId, orderNumber: saved.orderNumber } }, env);
    return { ok: true, record: saved };
  }
  if (status === "opened" || status === "customer_responded") return { ok: true, record };
  return { ok: false, status: 404, code: "REQUEST_UNAVAILABLE", error: "This request is not available." };
}

async function submitSubstitutionResponse(token, choices, env = process.env) {
  const record = await getSubstitutionRequestByToken(token, env);
  if (!record) return { ok: false, status: 404, code: "REQUEST_UNAVAILABLE", error: "This request is not available." };
  const status = requestStatus(record);
  if (status === "expired") return { ok: false, status: 410, code: "REQUEST_EXPIRED", error: "This request has expired." };
  if (status === "revoked") return { ok: false, status: 410, code: "REQUEST_REVOKED", error: "This request is no longer active." };
  if (status === "completed") return { ok: false, status: 409, code: "REQUEST_COMPLETED", error: "This request has already been completed by staff." };
  if (record.submittedAt || status === "customer_responded") return { ok: true, alreadySubmitted: true, record };
  if (!["awaiting_customer", "opened"].includes(status)) return { ok: false, status: 409, code: "REQUEST_UNAVAILABLE", error: "This request is not available." };
  const validation = validateCustomerChoices(record, choices);
  if (!validation.ok) return { ...validation, status: 400 };
  const nextItems = record.items.map((item) => ({
    ...item,
    customerChoice: validation.choices.find((choice) => choice.requestItemId === item.requestItemId) || null
  }));
  const submissionVersion = Number(record.submissionVersion || 0) + 1;
  const submitted = appendRequestAudit({
    ...record,
    status: "customer_responded",
    submittedAt: nowIso(),
    submittedChoices: validation.choices,
    submissionVersion,
    items: nextItems
  }, "customer_response_submitted");
  try {
    await setJson(store("requests", env), `submissions/${record.requestId}`, { schemaVersion: SCHEMA_VERSION, requestId: record.requestId, submissionVersion, createdAt: nowIso() }, { onlyIfNew: true });
  } catch (error) {
    const latest = await getSubstitutionRequest(record.requestId, env);
    if (latest?.submittedAt) return { ok: true, alreadySubmitted: true, record: latest };
    return { ok: false, status: 409, code: "REQUEST_UNAVAILABLE", error: "This request is not available." };
  }
  const saved = await saveSubstitutionRequest(submitted, env);
  await createAuditRecord({ type: "customer_response_submitted", details: { requestId: saved.requestId, orderNumber: saved.orderNumber } }, env);
  return { ok: true, record: saved };
}

async function updateSubstitutionRequestStatus(id, nextStatus, actor = "staff", env = process.env) {
  const record = await getSubstitutionRequest(id, env);
  if (!record) return { ok: false, code: "NOT_FOUND", error: "Substitution request was not found." };
  const allowed = new Set(["staff_reviewing", "completed", "revoked"]);
  if (!allowed.has(nextStatus)) return { ok: false, code: "INVALID_STATUS", error: "Unsupported request status." };
  const now = nowIso();
  const next = appendRequestAudit({
    ...record,
    status: nextStatus,
    completedAt: nextStatus === "completed" ? now : record.completedAt,
    revokedAt: nextStatus === "revoked" ? now : record.revokedAt
  }, nextStatus === "revoked" ? "request_revoked" : nextStatus === "completed" ? "request_completed" : "staff_reviewing", actor);
  const saved = await saveSubstitutionRequest(next, env);
  await createAuditRecord({ type: `substitution_${nextStatus}`, actor, details: { requestId: id } }, env);
  return { ok: true, request: safeRequestForStaff(saved) };
}

async function updateSubstitutionRequestSms(id, sms, actor = "system", env = process.env) {
  const record = await getSubstitutionRequest(id, env);
  if (!record) return null;
  const next = appendRequestAudit({ ...record, sms: { ...(record.sms || {}), ...scrubObject(sms) } }, "request_sms_updated", actor);
  return saveSubstitutionRequest(next, env);
}

async function listSubstitutionRequests(env = process.env, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 50), 1), 100);
  const page = Math.max(Number(filters.page || 1), 1);
  const includeLinks = Boolean(filters.includeLinks);
  let records = await listRawByPrefix(store("requests", env), "requests/", 1000);
  records = records.filter((record) => record.requestId).map((record) => ({ ...record, status: requestStatus(record) }));
  const status = String(filters.status || "").trim();
  if (status) records = records.filter((record) => record.status === status);
  const query = String(filters.query || filters.search || "").trim().toLowerCase();
  if (query) records = records.filter((record) => [record.orderNumber, record.customerFirstName, record.status].some((value) => String(value || "").toLowerCase().includes(query)));
  records.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  const start = (page - 1) * limit;
  return {
    requests: records.slice(start, start + limit).map((record) => safeRequestForStaff(record, includeLinks)),
    page,
    limit,
    total: records.length,
    totalPages: Math.max(Math.ceil(records.length / limit), 1)
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
    details: data.details && typeof data.details === "object" ? redactObject(data.details) : {},
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

async function findMessageRecordBySid(messageSid, env = process.env) {
  const sid = String(messageSid || "").trim();
  if (!/^SM[A-Za-z0-9]{6,64}$/.test(sid)) return null;
  const records = await listRawByPrefix(store("history", env), "records/", 1000);
  return records.find((record) => record.twilioMessageSid === sid) || null;
}

async function updateMessageStatusBySid(messageSid, status, env = process.env) {
  const record = await findMessageRecordBySid(messageSid, env);
  if (!record) return null;
  return updateMessageStatus(record.id, status, env);
}

async function getProcessedTwilioMessage(messageSid, env = process.env) {
  const sid = String(messageSid || "").trim();
  if (!/^SM[A-Za-z0-9]{3,64}$/.test(sid)) return null;
  const record = await getJsonSafe(store("history", env), `twilio-message-sids/${sid}`);
  return record?.messageSid ? record : null;
}

async function recordProcessedTwilioMessage(data, env = process.env) {
  const messageSid = String(data.messageSid || "").trim();
  if (!/^SM[A-Za-z0-9]{3,64}$/.test(messageSid)) return { ok: false, code: "INVALID_MESSAGE_SID" };
  const existing = await getProcessedTwilioMessage(messageSid, env);
  if (existing) return { ok: true, duplicate: true, record: existing };
  const record = {
    schemaVersion: SCHEMA_VERSION,
    messageSid,
    fromRedacted: data.fromRedacted || "[redacted]",
    toRedacted: data.toRedacted || "[redacted]",
    receivedAt: data.receivedAt || nowIso(),
    processingStatus: scrubCustomerText(data.processingStatus || "processed", 80),
    type: scrubCustomerText(data.type || "twilio_webhook", 80),
    associatedRecordId: scrubCustomerText(data.associatedRecordId || "", 120)
  };
  try {
    await setJson(store("history", env), `twilio-message-sids/${messageSid}`, record, { onlyIfNew: true });
    return { ok: true, duplicate: false, record };
  } catch (error) {
    if (error?.code !== "BLOB_ALREADY_EXISTS" && error?.status !== 412) throw error;
    const saved = await getProcessedTwilioMessage(messageSid, env);
    return { ok: true, duplicate: true, record: saved || record };
  }
}

async function saveOptOutStatus({ phone, fromRedacted, toRedacted, messageSid, keyword, status = "opted_out" }, env = process.env) {
  const phoneHash = hashPhoneNumber(phone, env);
  const record = {
    schemaVersion: SCHEMA_VERSION,
    phoneHash,
    fromRedacted: fromRedacted || "[redacted]",
    toRedacted: toRedacted || "[redacted]",
    messageSid: scrubCustomerText(messageSid || "", 80),
    keyword: scrubCustomerText(keyword || "", 20),
    status: scrubCustomerText(status, 40),
    updatedAt: nowIso()
  };
  await setJson(store("history", env), `opt-outs/${phoneHash}`, record);
  await createAuditRecord({ type: "twilio_opt_out", details: { status: record.status, fromRedacted: record.fromRedacted, keyword: record.keyword } }, env);
  return record;
}

async function getOptOutStatus(phone, env = process.env) {
  const phoneHash = hashPhoneNumber(phone, env);
  const record = await getJsonSafe(store("history", env), `opt-outs/${phoneHash}`);
  return record?.phoneHash ? record : null;
}

function classifyReply(body = "") {
  const keyword = String(body || "").trim().split(/\s+/)[0]?.toUpperCase() || "";
  if (["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"].includes(keyword)) return "stop";
  if (["HELP", "INFO"].includes(keyword)) return "help";
  return "ordinary";
}

async function findRecentOutgoingForPhone(redactedPhone, env = process.env) {
  const records = await listMessageRecords(env, 1000).catch(() => []);
  return records.find((record) => record.customerPhoneRedacted === redactedPhone && record.dryRun === false) ||
    records.find((record) => record.customerPhoneRedacted === redactedPhone) ||
    null;
}

async function createInboundReply(data, env = process.env) {
  const messageSid = scrubCustomerText(data.messageSid || "", 80);
  if (!/^SM[A-Za-z0-9]{3,64}$/.test(messageSid)) return { ok: false, code: "INVALID_MESSAGE_SID" };
  const existing = await getJsonSafe(store("history", env), `replies/by-sid/${messageSid}`);
  if (existing?.replyId) return { ok: true, duplicate: true, reply: existing };
  const fromRedacted = data.fromRedacted || "[redacted]";
  const matched = data.matchedMessageRecordId ? null : await findRecentOutgoingForPhone(fromRedacted, env);
  const replyId = data.replyId || newId("reply");
  const createdAt = data.createdAt || nowIso();
  const reply = {
    schemaVersion: SCHEMA_VERSION,
    replyId,
    messageSid,
    receivedAt: data.receivedAt || createdAt,
    fromHash: data.fromHash || "",
    fromRedacted,
    toRedacted: data.toRedacted || "[redacted]",
    body: scrubCustomerText(data.body || "", 1000),
    preview: scrubCustomerText(data.body || "", 140),
    matchedMessageRecordId: data.matchedMessageRecordId || matched?.id || "",
    matchedOrderId: data.matchedOrderId || matched?.orderId || "",
    matchedOrderName: data.matchedOrderName || matched?.orderName || "",
    customerName: scrubCustomerText(data.customerName || matched?.customerFirstName || "", 120),
    read: Boolean(data.read),
    reviewed: Boolean(data.reviewed),
    reviewedBy: scrubCustomerText(data.reviewedBy || "", 120),
    reviewedAt: data.reviewedAt || null,
    classification: data.classification || classifyReply(data.body),
    createdAt,
    updatedAt: data.updatedAt || createdAt
  };
  try {
    await setJson(store("history", env), `replies/by-sid/${messageSid}`, reply, { onlyIfNew: true });
    await setJson(store("history", env), `replies/${replyId}`, reply, { onlyIfNew: true });
    await createAuditRecord({ type: "inbound_reply_received", details: { replyId, classification: reply.classification, matched: Boolean(reply.matchedMessageRecordId) } }, env);
    return { ok: true, duplicate: false, reply };
  } catch (error) {
    const saved = await getJsonSafe(store("history", env), `replies/by-sid/${messageSid}`);
    if (saved?.replyId) return { ok: true, duplicate: true, reply: saved };
    return { ok: false, code: "STORAGE_ERROR", error: "Reply could not be saved." };
  }
}

function publicReply(reply, includeBody = false) {
  if (!reply?.replyId) return null;
  return {
    schemaVersion: reply.schemaVersion || SCHEMA_VERSION,
    id: reply.replyId,
    replyId: reply.replyId,
    messageSid: reply.messageSid,
    receivedAt: reply.receivedAt,
    fromRedacted: reply.fromRedacted,
    toRedacted: reply.toRedacted,
    preview: scrubText(reply.preview || reply.body || ""),
    body: includeBody ? scrubText(reply.body || "") : "",
    matchedMessageRecordId: reply.matchedMessageRecordId || "",
    matchedOrderId: reply.matchedOrderId || "",
    matchedOrderName: scrubText(reply.matchedOrderName || ""),
    customerName: scrubText(reply.customerName || ""),
    read: Boolean(reply.read),
    reviewed: Boolean(reply.reviewed),
    reviewedBy: scrubText(reply.reviewedBy || ""),
    reviewedAt: reply.reviewedAt || null,
    classification: reply.classification || "ordinary",
    createdAt: reply.createdAt,
    updatedAt: reply.updatedAt
  };
}

async function getReply(id, env = process.env) {
  if (!id || !/^[A-Za-z0-9_-]+$/.test(String(id))) return null;
  const reply = await getJsonSafe(store("history", env), `replies/${id}`);
  return reply?.replyId ? reply : null;
}

function filterReplies(replies, filters = {}) {
  const query = String(filters.query || filters.search || "").trim().toLowerCase();
  const status = String(filters.status || "").trim().toLowerCase();
  let result = replies;
  if (query) {
    result = result.filter((reply) => [
      reply.fromRedacted,
      reply.preview,
      reply.body,
      reply.matchedOrderName,
      reply.customerName,
      reply.classification
    ].some((value) => String(value || "").toLowerCase().includes(query)));
  }
  if (status === "unread") result = result.filter((reply) => !reply.read);
  if (status === "reviewed") result = result.filter((reply) => reply.reviewed);
  if (status === "unmatched") result = result.filter((reply) => !reply.matchedMessageRecordId);
  return result;
}

async function queryReplies(env = process.env, filters = {}) {
  const limit = Math.min(Math.max(Number(filters.limit || 25), 1), 100);
  const page = Math.max(Number(filters.page || 1), 1);
  const raw = await listRawByPrefix(store("history", env), "replies/", 1000);
  const unique = new Map();
  for (const reply of raw) {
    if (reply?.replyId && !unique.has(reply.replyId)) unique.set(reply.replyId, reply);
  }
  const records = filterReplies(Array.from(unique.values()), filters)
    .sort((a, b) => String(b.receivedAt || b.createdAt).localeCompare(String(a.receivedAt || a.createdAt)));
  const start = (page - 1) * limit;
  return {
    replies: records.slice(start, start + limit).map((reply) => publicReply(reply)),
    page,
    limit,
    total: records.length,
    totalPages: Math.max(Math.ceil(records.length / limit), 1)
  };
}

async function markReplyRead(id, env = process.env) {
  const reply = await getReply(id, env);
  if (!reply) return { ok: false, code: "NOT_FOUND", error: "Reply was not found." };
  const next = { ...reply, read: true, updatedAt: nowIso() };
  await setJson(store("history", env), `replies/${reply.replyId}`, next);
  await setJson(store("history", env), `replies/by-sid/${reply.messageSid}`, next);
  return { ok: true, reply: publicReply(next, true) };
}

async function markReplyReviewed(id, actor = "staff", env = process.env) {
  const reply = await getReply(id, env);
  if (!reply) return { ok: false, code: "NOT_FOUND", error: "Reply was not found." };
  const next = { ...reply, read: true, reviewed: true, reviewedBy: scrubCustomerText(actor, 120), reviewedAt: nowIso(), updatedAt: nowIso() };
  await setJson(store("history", env), `replies/${reply.replyId}`, next);
  await setJson(store("history", env), `replies/by-sid/${reply.messageSid}`, next);
  await createAuditRecord({ type: "reply_reviewed", actor, details: { replyId: id, classification: next.classification } }, env);
  return { ok: true, reply: publicReply(next, true) };
}

async function listRawByPrefix(targetStore, prefix, limit = 500) {
  const listed = await targetStore.list({ prefix });
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
  const initializedAt = nowIso();
  const stores = {};
  stores[STORE_NAMES.history] = await setJsonOnlyIfNew("history", "init/blob_initialization", {
    schemaVersion: SCHEMA_VERSION,
    initializedAt
  }, "history-first-write", "history-initialization");
  stores[STORE_NAMES.templates] = await setJsonOnlyIfNew("templates", "templates/default-substitution", defaultTemplate(), "template-default-write", "template");
  stores[STORE_NAMES.settings] = await setJsonOnlyIfNew("settings", "settings/blob_initialization", safeInitializationSettings(initializedAt), "settings-first-write", "settings");
  stores[STORE_NAMES.requests] = await setJsonOnlyIfNew("requests", "init/blob_initialization", {
    schemaVersion: SCHEMA_VERSION,
    initializedAt
  }, "requests-first-write", "substitution-requests");
  try {
    await createAuditRecord({
      type: "blob_stores_initialized",
      details: {
        history: stores[STORE_NAMES.history],
        templates: stores[STORE_NAMES.templates],
        settings: stores[STORE_NAMES.settings],
        requests: stores[STORE_NAMES.requests]
      }
    }, env);
    stores[STORE_NAMES.audit] = INIT_STATUS.initialized;
  } catch (error) {
    throw initializationFailure("audit-first-write", "audit", "audit", error);
  }
  return {
    ok: true,
    initializedAt,
    stores
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
    substitutionRequests: (await listSubstitutionRequests(env, { limit: 1000 })).requests,
    templates: await listTemplates(env),
    audit: await listRawByPrefix(store("audit", env), "events/", 1000),
    settings: await listRawByPrefix(store("settings", env), "settings/", 100)
  };
}

async function cleanupDataStoreRecords({ now = Date.now(), max = 100, env = process.env } = {}) {
  const targetHistory = store("history", env);
  const targetRequests = store("requests", env);
  const webhookCutoff = now - 14 * 24 * 60 * 60 * 1000;
  const requestCutoff = now - 30 * 24 * 60 * 60 * 1000;
  let removedWebhookDedupe = 0;
  let archivedExpiredRequests = 0;

  const sidRecords = await targetHistory.list({ prefix: "twilio-message-sids/" }).catch(() => ({ blobs: [] }));
  for (const blob of sidRecords.blobs || []) {
    if (removedWebhookDedupe >= max) break;
    const record = await getJsonSafe(targetHistory, blob.key);
    const timestamp = new Date(record?.receivedAt || record?.createdAt || 0).getTime();
    if (!record || timestamp < webhookCutoff) {
      if (await deleteKey(targetHistory, blob.key)) removedWebhookDedupe += 1;
    }
  }

  const requestRecords = await targetRequests.list({ prefix: "requests/" }).catch(() => ({ blobs: [] }));
  for (const blob of requestRecords.blobs || []) {
    if (archivedExpiredRequests >= max) break;
    const record = await getJsonSafe(targetRequests, blob.key);
    if (!record?.requestId || record.archivedAt) continue;
    const terminalAt = record.completedAt || record.revokedAt || record.submittedAt || (requestStatus(record, now) === "expired" ? record.expiresAt : "");
    if (terminalAt && new Date(terminalAt).getTime() < requestCutoff) {
      await setJson(targetRequests, blob.key, appendRequestAudit({ ...record, archivedAt: nowIso(), status: requestStatus(record, now) }, "request_archived"));
      archivedExpiredRequests += 1;
    }
  }

  if (removedWebhookDedupe || archivedExpiredRequests) {
    await createAuditRecord({ type: "cleanup_run", details: { removedWebhookDedupe, archivedExpiredRequests } }, env);
  }
  return { removedWebhookDedupe, archivedExpiredRequests };
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
  StoreInitializationError,
  archiveTemplate,
  backupPayload,
  checkDuplicateMessage,
  clearMemoryHistory,
  createResponseToken,
  createAuditRecord,
  cleanupDataStoreRecords,
  createMessageRecord,
  createInboundReply,
  createSubstitutionRequest,
  createTemplate,
  defaultTemplate,
  duplicateKey,
  exportSafeBackup,
  findByIdempotency,
  findDuplicate,
  findMessageRecordBySid,
  getMessageRecord,
  getOptOutStatus,
  getProcessedTwilioMessage,
  getReply,
  getSubstitutionRequest,
  getSubstitutionRequestByToken,
  hashPhoneNumber,
  hashResponseToken,
  idempotencyKey,
  initializeDataStores,
  listMessageRecords,
  markReplyRead,
  markReplyReviewed,
  listSubstitutionRequests,
  listTemplates,
  markSubstitutionRequestOpened,
  messageStats,
  publicRecord,
  publicReply,
  queryReplies,
  queryMessageRecords,
  recordProcessedTwilioMessage,
  recordsToCsv,
  resetStoreFactory,
  rotateSubstitutionRequestToken,
  saveOptOutStatus,
  saveRecord,
  saveTemplate,
  safeRequestForCustomer,
  safeRequestForStaff,
  setStoreFactory,
  submitSubstitutionResponse,
  updateSubstitutionRequestSms,
  updateSubstitutionRequestStatus,
  updateMessageStatus,
  updateMessageStatusBySid,
  updateTemplate,
  validateTemplate
};
