require("dotenv").config();

const crypto = require("node:crypto");
const { connectLambda } = require("@netlify/blobs");

const {
  authRequired,
  cleanupExpiredSessions,
  requireAuth,
  requireRole
} = require("../../src/auth");
const { ACCESS_TYPES, API_ENDPOINTS, matchEndpoint } = require("../../src/endpoint-registry");
const {
  cleanString,
  validateE164,
  validateEnum,
  validateGid,
  validateId,
  validateObject,
  validateString
} = require("../../src/validation");
const {
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe
} = require("../../src/auth-handlers");
const {
  findOrder,
  getOrderById,
  getVariantById,
  hasConfig,
  searchProductsForSubstitutions,
  searchSubstitutionsForLineItem
} = require("../../src/shopify");
const { buildSubstitutionMessage, isE164, redactPhone, sendSms, smsLength, validateMessage, validateTwilioSignature } = require("../../src/sms");
const { checkRateLimit } = require("../../src/rate-limit");
const { securityHeaders, validateCsrf } = require("../../src/security");
const {
  archiveTemplate,
  backupPayload,
  cleanupDataStoreRecords,
  createAuditRecord,
  createMessageRecord,
  createSubstitutionRequest,
  defaultTemplate,
  findByIdempotency,
  findDuplicate,
  getOptOutStatus,
  getMessageRecord,
  getSubstitutionRequest,
  getSubstitutionRequestByToken,
  initializeDataStores,
  listTemplates,
  listMessageRecords,
  listSubstitutionRequests,
  markSubstitutionRequestOpened,
  messageStats,
  publicRecord,
  queryMessageRecords,
  recordProcessedTwilioMessage,
  recordsToCsv,
  rotateSubstitutionRequestToken,
  saveOptOutStatus,
  saveRecord,
  safeRequestForCustomer,
  safeRequestForStaff,
  saveTemplate,
  submitSubstitutionResponse,
  updateSubstitutionRequestSms,
  updateSubstitutionRequestStatus,
  updateMessageStatusBySid
} = require("../../src/history");
const { cleanupRateLimitRecords } = require("../../src/rate-limit");
const { logger } = require("../../src/safe-logger");

const MAX_BODY_BYTES = 16 * 1024;
const ALLOWED_TWILIO_STATUSES = new Set(["accepted", "queued", "sending", "sent", "delivered", "undelivered", "failed", "receiving", "received", "read"]);
const STOP_KEYWORDS = new Set(["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"]);
const HELP_KEYWORDS = new Set(["HELP", "INFO"]);
const ALLOWED_SHOPIFY_WEBHOOK_TOPICS = new Set(["orders/updated", "orders/cancelled"]);
let activeEvent = null;

function connectNetlifyBlobs(event) {
  if (!event?.blobs) return { connected: false, reason: "no-lambda-blob-payload" };
  try {
    connectLambda(event);
    return { connected: true };
  } catch (error) {
    return { connected: false, reason: error?.name || "blob-context-error" };
  }
}

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      ...securityHeaders(activeEvent || { headers: {} }),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function error(statusCode, code, message, headers = {}) {
  return json(statusCode, { success: false, code, error: message }, headers);
}

function publicError(statusCode, code = "REQUEST_FAILED") {
  return json(statusCode, { success: false, code, error: "Unable to process request" });
}

function methodNotAllowed(methods) {
  return json(405, { success: false, code: "INVALID_REQUEST", error: "Method not allowed." }, { Allow: methods.join(", ") });
}

function optionsResponse() {
  return {
    statusCode: 204,
    headers: {
      ...securityHeaders(activeEvent || { headers: {} }),
      "Access-Control-Max-Age": "600"
    },
    body: ""
  };
}

function storageErrorResponse(statusCode, code, message, diagnostic = {}) {
  return json(statusCode, {
    success: false,
    code,
    error: message,
    diagnostic: Object.fromEntries(Object.entries(diagnostic).filter(([, value]) => value !== undefined && value !== ""))
  });
}

function safeErrorDetail(errorValue) {
  const message = String(errorValue?.message || errorValue || "Unknown error.");
  if (/token|secret|password|authorization|cookie/i.test(message)) return "A protected configuration value could not be used.";
  return message.slice(0, 180);
}

function safeConfigDiagnostics(event) {
  const checks = [];
  const add = (name, ok, guidance) => checks.push({ name, ok: Boolean(ok), guidance: ok ? "" : guidance });
  const storageProvider = process.env.MESSAGE_STORAGE_PROVIDER || (process.env.NETLIFY === "true" ? "netlify-blobs" : "memory");
  add("Staff authentication", authRequired(), "Staff authentication must remain enabled.");
  add("Staff user store", true, "Create at least one admin user in the welkom-sms-users Blob store.");
  add("Session store", true, "Staff sessions are stored in the welkom-sms-sessions Blob store.");
  add("SHOPIFY_SHOP_DOMAIN", Boolean(process.env.SHOPIFY_SHOP_DOMAIN), "Add SHOPIFY_SHOP_DOMAIN, for example welkom-usa.myshopify.com.");
  add("Shopify credentials", hasConfig(), "Add SHOPIFY_ADMIN_ACCESS_TOKEN or SHOPIFY_CLIENT_ID plus SHOPIFY_CLIENT_SECRET.");
  add("TWILIO_ACCOUNT_SID", /^AC[a-fA-F0-9]{32}$/.test(String(process.env.TWILIO_ACCOUNT_SID || "")), "Add a valid TWILIO_ACCOUNT_SID starting with AC.");
  add("Twilio auth", Boolean(process.env.TWILIO_AUTH_TOKEN || (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET)), "Add TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID plus TWILIO_API_KEY_SECRET.");
  add("Twilio sender", Boolean(process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER), "Add TWILIO_MESSAGING_SERVICE_SID or a Twilio from number.");
  add("MESSAGE_STORAGE_PROVIDER", String(storageProvider).toLowerCase() === "netlify-blobs", "Set MESSAGE_STORAGE_PROVIDER=netlify-blobs in Netlify.");
  add("Netlify runtime", process.env.NETLIFY === "true", "This should be true automatically in deployed Netlify Functions. If false locally, Blob writes will not use deployed site credentials.");
  add("Netlify Blob payload", Boolean(event?.blobs || process.env.NETLIFY_BLOBS_CONTEXT), "Redeploy on Netlify so Functions receive the automatic Blob context payload.");
  add("SMS_DRY_RUN", String(process.env.SMS_DRY_RUN ?? process.env.DRY_RUN ?? "true").toLowerCase() !== "false", "Keep SMS_DRY_RUN=true until you are ready for real SMS sending.");
  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (parseError) {
    return null;
  }
}

function bodyTooLarge(event) {
  return Buffer.byteLength(event.body || "", "utf8") > MAX_BODY_BYTES;
}

function clientIp(event) {
  return String(event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || event.headers?.["client-ip"] || "local")
    .split(",")[0]
    .trim()
    .slice(0, 80) || "local";
}

function rateLimitResponse(result) {
  return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", { "Retry-After": String(result.retryAfter || 60) });
}

async function rateLimit(key, limit, windowSeconds, blockSeconds = windowSeconds) {
  const result = await checkRateLimit({ key, limit, windowSeconds, blockSeconds });
  if (result.ok) return null;
  await createAuditRecord({
    type: "rate_limit_event",
    details: {
      keyHash: crypto.createHash("sha256").update(String(key || "")).digest("hex"),
      limit,
      windowSeconds,
      retryAfter: result.retryAfter
    }
  }).catch(() => {});
  return rateLimitResponse(result);
}

function parseForm(event) {
  return Object.fromEntries(new URLSearchParams(event.body || ""));
}

function timingSafeEqualText(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (!leftBuffer.length || leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(Buffer.alloc(1), Buffer.alloc(1));
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function routeName(event) {
  const raw = event.path || "";
  return raw.replace(/^\/\.netlify\/functions\/api\/?/, "").replace(/^\/api\/?/, "");
}

function requireJson(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  return contentType.includes("application/json");
}

async function authorizeRegisteredEndpoint(event, route) {
  const endpoint = matchEndpoint(route, API_ENDPOINTS);
  if (!endpoint) return publicError(404, "NOT_FOUND");
  if (!endpoint.methods.includes(event.httpMethod)) return methodNotAllowed(endpoint.methods);
  if (endpoint.access === ACCESS_TYPES.staff) {
    const auth = await requireAuth(event);
    if (!auth.ok) return publicError(auth.status || 401, auth.code || "AUTH_REQUIRED");
    const csrf = validateCsrf({ event, auth });
    if (!csrf.ok) return publicError(csrf.status || 403, csrf.code || "CSRF_INVALID");
  }
  if (endpoint.access === ACCESS_TYPES.admin) {
    const auth = await requireRole(event, "admin");
    if (!auth.ok) return publicError(auth.status || 403, auth.code || "FORBIDDEN");
    const csrf = validateCsrf({ event, auth });
    if (!csrf.ok) return publicError(csrf.status || 403, csrf.code || "CSRF_INVALID");
  }
  return null;
}

async function requireSession(event) {
  const session = await requireAuth(event);
  if (!session.ok) return { error: error(session.status, session.code, session.error) };
  return { session };
}

async function handleLogin(event) {
  return handleAuthLogin(event);
}

async function handleLogout(event) {
  return handleAuthLogout(event);
}

async function handleSession(event) {
  return handleAuthMe(event);
}

function publicBaseUrl(event) {
  const configured = String(process.env.PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  if (configured) return configured;
  const host = event.headers.host || event.headers.Host || "";
  const proto = event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https";
  return host ? `${proto}://${host}` : "";
}

function externallyVisibleWebhookUrl(event, route) {
  const statusBase = String(process.env.TWILIO_STATUS_CALLBACK_BASE_URL || "").replace(/\/$/, "");
  const inboundBase = String(process.env.TWILIO_INBOUND_WEBHOOK_BASE_URL || process.env.PUBLIC_APP_URL || process.env.URL || "").replace(/\/$/, "");
  const host = event.headers.host || event.headers.Host || "";
  const proto = event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https";
  const origin = route === "twilio-status" ? statusBase || inboundBase || `${proto}://${host}` : inboundBase || statusBase || `${proto}://${host}`;
  return `${origin}/api/${route}${event.rawQuery ? `?${event.rawQuery}` : ""}`;
}

function twiml(message = "") {
  const safe = String(message || "").replace(/[<>&'"]/g, (char) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    "'": "&apos;",
    "\"": "&quot;"
  })[char]);
  return {
    statusCode: 200,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: message ? `<Response><Message>${safe}</Message></Response>` : "<Response></Response>"
  };
}

function hashPhone(phone) {
  return crypto.createHash("sha256").update(String(phone || "").trim()).digest("hex");
}

function cleanText(value, max = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/<\/?[a-z][\s\S]*>/gi, "").slice(0, max);
}

function responseSmsMessage(orderNumber, secureLink) {
  return `Welkom USA: An item in order #${String(orderNumber || "").replace(/^#/, "")} is unavailable. Choose a substitute or refund here: ${secureLink}. Reply HELP for help or STOP to opt out.`;
}

function invalidRequest() {
  return error(400, "INVALID_REQUEST", "Unable to process request");
}

function validateBody(body, options) {
  const validation = validateObject(body, options);
  return validation.ok ? null : invalidRequest();
}

async function handleOrderSearch(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const limited = await rateLimit(`order-search:session:${auth.session.session.sessionIdHash}`, 30, 60);
  if (limited) return limited;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["query"], required: ["query"] });
  if (invalid) return invalid;
  const query = validateString(body.query, { min: 1, max: 80, pattern: /^#?[A-Za-z0-9-]+$/ });
  if (!query.ok) return invalidRequest();

  const result = await findOrder(query.value);
  return json(result.status, result.body);
}

async function handleProductSearch(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const limited = await rateLimit(`product-search:session:${auth.session.session.sessionIdHash}`, 60, 60);
  if (limited) return limited;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["query", "excludeVariantId"], required: ["query"] });
  if (invalid) return invalid;
  if (body.excludeVariantId && !validateGid(body.excludeVariantId, "ProductVariant").ok) return invalidRequest();

  const query = cleanString(body.query, 120);
  if (!query) return error(400, "INVALID_REQUEST", "Product search is required.");
  if (query.length > 120) return error(400, "INVALID_REQUEST", "Product search is too long.");
  if (!hasConfig()) return error(500, "SHOPIFY_ERROR", "Shopify Admin API is not configured.");

  const products = await searchProductsForSubstitutions(query, {
    excludeVariantId: body.excludeVariantId
  });
  return json(200, { success: true, products });
}

async function handleLineItemSubstitutions(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const limited = await rateLimit(`product-search:session:${auth.session.session.sessionIdHash}`, 60, 60);
  if (limited) return limited;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["orderId", "lineItemId"], required: ["orderId", "lineItemId"] });
  if (invalid) return invalid;
  if (!validateGid(body.orderId, "Order").ok || !validateGid(body.lineItemId, "LineItem").ok) return invalidRequest();

  const orderResult = await getOrderById(body.orderId);
  if (!orderResult.body.success) return json(orderResult.status, orderResult.body);
  const order = orderResult.body.order;
  const lineItem = order.lineItems.find((item) => item.id === body.lineItemId);
  if (!lineItem) return error(400, "LINE_ITEM_INVALID", "Selected line item does not belong to this order.");

  const products = await searchSubstitutionsForLineItem(lineItem);
  return json(200, { success: true, products });
}

async function handleDuplicateCheck(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["orderId", "lineItemId", "substituteVariantId", "customSubstituteTitle"] });
  if (invalid) return invalid;
  const duplicate = await findDuplicate({
    orderId: body.orderId,
    lineItemId: body.lineItemId,
    substituteVariantId: body.substituteVariantId,
    customSubstituteTitle: body.customSubstituteTitle
  });
  return json(200, { success: true, duplicate: Boolean(duplicate), record: publicRecord(duplicate) });
}

function validateOrderForSending(order, body) {
  if (order.cancelled) {
    return { status: 400, code: "ORDER_CANCELLED", error: "This order is cancelled. No message was sent." };
  }
  if (!order.smsConsent?.granted) {
    return { status: 400, code: "SMS_CONSENT_MISSING", error: "This order does not contain recorded SMS consent. No message was sent." };
  }
  if (!order.customer?.phone) {
    return { status: 400, code: "PHONE_MISSING", error: "This order does not contain a trusted customer phone number." };
  }
  const lineItem = order.lineItems.find((item) => item.id === body.lineItemId);
  if (!lineItem) {
    return { status: 400, code: "LINE_ITEM_INVALID", error: "Selected line item does not belong to this order." };
  }
  return { lineItem };
}

function validateCustomSubstituteTitle(value) {
  const title = String(value || "").trim().replace(/\s+/g, " ");
  if (!title) return { ok: false, code: "INVALID_REQUEST", error: "Substitute item is required." };
  if (title.length < 2 || title.length > 120) return { ok: false, code: "INVALID_REQUEST", error: "Custom substitute title must be between 2 and 120 characters." };
  if (/<\/?[a-z][\s\S]*>/i.test(title)) return { ok: false, code: "INVALID_REQUEST", error: "Custom substitute title cannot contain HTML." };
  return { ok: true, title };
}

function cleanManualText(value, fallback, max = 120) {
  const clean = String(value || "").trim().replace(/\s+/g, " ");
  if (!clean) return fallback;
  return clean.slice(0, max);
}

function manualPhoneHash(phone) {
  return crypto.createHash("sha256").update(String(phone || "").trim()).digest("hex").slice(0, 18);
}

async function handleSendManualSms(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return error(auth.status || 403, auth.code || "FORBIDDEN", auth.error || "You do not have permission to perform this action.");
  const limited = await rateLimit(`sms-action:user:${auth.user.id}`, 10, 10 * 60);
  if (limited) return limited;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, {
    allowed: ["phone", "firstName", "unavailableItem", "substituteItem", "reference", "message", "consentConfirmed", "sendConfirmed", "idempotencyKey", "authorizedResend"],
    required: ["phone", "message", "consentConfirmed", "sendConfirmed"]
  });
  if (invalid) return invalid;
  if (body.sendConfirmed !== true) return error(400, "SEND_CONFIRMATION_REQUIRED", "Confirm this SMS before sending.");
  if (!body.consentConfirmed) {
    return error(400, "CONSENT_CONFIRMATION_REQUIRED", "Staff must confirm this manual recipient gave permission to receive this SMS.");
  }

  const phoneValidation = validateE164(body.phone);
  if (!phoneValidation.ok) return error(400, "PHONE_INVALID", "Phone number must be valid E.164 format.");
  const phone = phoneValidation.value;
  const optOut = await getOptOutStatus(phone);
  if (optOut?.status === "opted_out") return error(400, "RECIPIENT_OPTED_OUT", "This recipient has opted out. No SMS was sent.");
  const firstName = cleanManualText(body.firstName, "there", 60);
  const unavailableItem = cleanManualText(body.unavailableItem, "your requested item");
  const substituteItem = cleanManualText(body.substituteItem, "a substitute item");
  const orderName = cleanManualText(body.reference, "manual", 40);
  const fallbackMessage = buildSubstitutionMessage({ firstName, unavailableItem, substituteItem, orderName });
  const finalMessage = String(body.message || "").trim() || fallbackMessage;
  const messageValidation = validateMessage(finalMessage, "");
  if (!messageValidation.ok) return error(400, messageValidation.code, messageValidation.error);

  const phoneHash = manualPhoneHash(phone);
  const idempotencyKey = body.idempotencyKey || `manual|${phoneHash}|${messageValidation.message}`;
  const existingRequest = await findByIdempotency(idempotencyKey);
  if (existingRequest) {
    return json(200, { success: true, idempotent: true, message: "This manual request was already processed.", record: publicRecord(existingRequest) });
  }

  const duplicate = await findDuplicate({
    orderId: `manual:${phoneHash}`,
    lineItemId: `manual:${unavailableItem.toLowerCase()}`,
    customSubstituteTitle: substituteItem
  });
  if (duplicate && !body.authorizedResend) {
    return json(409, {
      success: false,
      code: "DUPLICATE_MESSAGE",
      error: "A similar manual SMS was already processed for this recipient. Confirm authorised resend to send again.",
      duplicate: publicRecord(duplicate)
    });
  }

  const created = await createMessageRecord({
    orderId: `manual:${phoneHash}`,
    orderName: `Manual ${orderName}`,
    customerPhoneRedacted: redactPhone(phone),
    customerFirstName: firstName,
    unavailableLineItemId: `manual:${unavailableItem.toLowerCase()}`,
    unavailableTitle: unavailableItem,
    substituteTitle: substituteItem,
    customSubstitute: true,
    customSubstituteTitle: substituteItem,
    message: messageValidation.message,
    staffIdentity: auth.staffName,
    initialTwilioStatus: "created",
    latestTwilioStatus: "created",
    dryRun: undefined,
    idempotencyKey
  });
  if (!created.ok) return error(500, created.code || "STORAGE_ERROR", created.error || "Message history could not be saved.");
  if (created.idempotent) {
    return json(200, { success: true, idempotent: true, message: "This manual request was already processed.", record: publicRecord(created.record) });
  }

  const smsResult = await sendSms({
    phone,
    message: messageValidation.message,
    orderName: "",
    recordId: created.record.id
  });

  const updatedRecord = await saveRecord({
    ...created.record,
    dryRun: smsResult.body.dryRun,
    twilioMessageSid: smsResult.body.sid || "",
    initialTwilioStatus: smsResult.body.providerStatus || "failed",
    latestTwilioStatus: smsResult.body.providerStatus || "failed",
    failureReason: smsResult.body.success ? "" : smsResult.body.error
  });
  await createAuditRecord({
    type: smsResult.body.success ? "sms_send" : "sms_failure",
    actor: auth.staffName,
    messageRecordId: created.record.id,
    details: { mode: "manual", dryRun: smsResult.body.dryRun, providerStatus: smsResult.body.providerStatus }
  }).catch(() => {});

  if (smsResult.log) logger.error("Twilio manual send error", smsResult.log);
  logger.info("Manual SMS processed", {
    recipient: redactPhone(phone),
    dryRun: smsResult.body.dryRun,
    providerStatus: smsResult.body.providerStatus,
    staffIdentity: auth.staffName
  });

  return json(smsResult.status, { ...smsResult.body, record: publicRecord(updatedRecord || created.record) });
}

async function handleSendSubstitutionSms(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const staffLimited = await rateLimit(`sms-action:user:${auth.session.user.id}`, 10, 10 * 60);
  if (staffLimited) return staffLimited;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, {
    allowed: ["orderId", "lineItemId", "substituteVariantId", "customSubstituteTitle", "message", "sendConfirmed", "idempotencyKey", "authorizedResend"],
    required: ["orderId", "lineItemId", "sendConfirmed"]
  });
  if (invalid) return invalid;
  if (body.sendConfirmed !== true) return error(400, "SEND_CONFIRMATION_REQUIRED", "Confirm this SMS before sending.");
  if (!validateGid(body.orderId, "Order").ok || !validateGid(body.lineItemId, "LineItem").ok) return invalidRequest();
  if (body.substituteVariantId && !validateGid(body.substituteVariantId, "ProductVariant").ok) return invalidRequest();

  const hasShopifySubstitute = Boolean(body.substituteVariantId);
  const customValidation = hasShopifySubstitute ? null : validateCustomSubstituteTitle(body.customSubstituteTitle);
  if (!body.orderId || !body.lineItemId || (!hasShopifySubstitute && !customValidation?.ok)) {
    return error(400, "INVALID_REQUEST", "Order, unavailable item, and substitute item are required.");
  }

  const orderResult = await getOrderById(body.orderId);
  if (!orderResult.body.success) return json(orderResult.status, orderResult.body);
  const order = orderResult.body.order;
  const orderValidation = validateOrderForSending(order, body);
  if (orderValidation.error) return error(orderValidation.status, orderValidation.code, orderValidation.error);
  const optOut = await getOptOutStatus(order.customer.phone);
  if (optOut?.status === "opted_out") return error(400, "RECIPIENT_OPTED_OUT", "This recipient has opted out. No SMS was sent.");

  let substitute;
  if (hasShopifySubstitute) {
    const substituteResult = await getVariantById(body.substituteVariantId);
    if (!substituteResult.body.success) return json(substituteResult.status, substituteResult.body);
    substitute = substituteResult.body.product;
    if (substitute.productStatus !== "ACTIVE" || !substitute.availableForSale) {
      return error(400, "SUBSTITUTE_UNAVAILABLE", "The selected substitute is not currently available for sale.");
    }
    if (Number.isFinite(substitute.inventoryQuantity) && substitute.inventoryQuantity <= 0) {
      return error(400, "SUBSTITUTE_UNAVAILABLE", "The selected substitute has no available inventory.");
    }
  } else {
    if (!customValidation.ok) return error(400, customValidation.code, customValidation.error);
    substitute = {
      id: `custom:${customValidation.title.toLowerCase()}`,
      title: customValidation.title,
      customSubstitute: true
    };
  }

  const fallbackMessage = buildSubstitutionMessage({
    firstName: order.customer.firstName,
    unavailableItem: orderValidation.lineItem.title,
    substituteItem: substitute.title,
    orderName: order.name
  });
  const finalMessage = String(body.message || "").trim() || fallbackMessage;
  const messageValidation = validateMessage(finalMessage, order.name);
  if (!messageValidation.ok) return error(400, messageValidation.code, messageValidation.error);

  const idempotencyKey = body.idempotencyKey || "";
  const existingRequest = await findByIdempotency(idempotencyKey);
  if (existingRequest) {
    return json(200, { success: true, idempotent: true, message: "This request was already processed.", record: publicRecord(existingRequest) });
  }

  const duplicate = await findDuplicate({
    orderId: order.id,
    lineItemId: orderValidation.lineItem.id,
    substituteVariantId: hasShopifySubstitute ? substitute.id : "",
    customSubstituteTitle: hasShopifySubstitute ? "" : substitute.title
  });
  if (duplicate && !body.authorizedResend) {
    return json(409, {
      success: false,
      code: "DUPLICATE_MESSAGE",
      error: "This substitution message was already sent for this order and item. Confirm authorised resend to send again.",
      duplicate: publicRecord(duplicate)
    });
  }
  const orderLimited = await rateLimit(`sms-order:${order.id}`, 3, 60 * 60);
  if (orderLimited) return orderLimited;

  const created = await createMessageRecord({
    orderId: order.id,
    orderName: order.name,
    customerPhoneRedacted: redactPhone(order.customer.phone),
    customerFirstName: order.customer.firstName,
    unavailableLineItemId: orderValidation.lineItem.id,
    unavailableTitle: orderValidation.lineItem.title,
    substituteVariantId: hasShopifySubstitute ? substitute.id : "",
    substituteTitle: substitute.title,
    customSubstitute: !hasShopifySubstitute,
    customSubstituteTitle: hasShopifySubstitute ? "" : substitute.title,
    message: messageValidation.message,
    staffIdentity: auth.session.staffName,
    initialTwilioStatus: "created",
    latestTwilioStatus: "created",
    dryRun: undefined,
    idempotencyKey
  });
  if (!created.ok) return error(500, created.code || "STORAGE_ERROR", created.error || "Message history could not be saved.");

  if (created.idempotent) {
    return json(200, { success: true, idempotent: true, message: "This request was already processed.", record: publicRecord(created.record) });
  }

  const smsResult = await sendSms({
    phone: order.customer.phone,
    message: messageValidation.message,
    orderName: order.name,
    recordId: created.record.id
  });

  const updatedRecord = await saveRecord({
    ...created.record,
    dryRun: smsResult.body.dryRun,
    twilioMessageSid: smsResult.body.sid || "",
    initialTwilioStatus: smsResult.body.providerStatus || "failed",
    latestTwilioStatus: smsResult.body.providerStatus || "failed",
    failureReason: smsResult.body.success ? "" : smsResult.body.error
  });
  await createAuditRecord({
    type: smsResult.body.success ? "sms_send" : "sms_failure",
    actor: auth.session.staffName,
    messageRecordId: created.record.id,
    details: { mode: "substitution", orderName: order.name, dryRun: smsResult.body.dryRun, providerStatus: smsResult.body.providerStatus }
  }).catch(() => {});

  if (smsResult.log) {
    logger.error("Twilio send error", smsResult.log);
  }
  logger.info("Substitution SMS processed", {
    orderName: order.name,
    dryRun: smsResult.body.dryRun,
    providerStatus: smsResult.body.providerStatus,
    staffIdentity: auth.session.staffName
  });

  return json(smsResult.status, { ...smsResult.body, record: publicRecord(updatedRecord || created.record) });
}

async function handleHistory(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const params = new URLSearchParams(event.rawQuery || "");
  try {
    const result = await queryMessageRecords(process.env, {
      page: params.get("page"),
      limit: params.get("limit"),
      query: params.get("query") || params.get("search"),
      status: params.get("status"),
      dryRun: params.get("dryRun")
    });
    return json(200, { success: true, ...result });
  } catch (storageError) {
    logger.error("Message history storage read error", { error: storageError.message });
    const limit = Math.min(Math.max(Number(params.get("limit") || 25), 1), 100);
    const page = Math.max(Number(params.get("page") || 1), 1);
    return json(200, {
      success: true,
      records: [],
      page,
      limit,
      total: 0,
      totalPages: 1,
      storageHealthy: false,
      warning: "Message history storage is not available yet. Sent messages will appear after Blob storage is initialized and the first message is recorded."
    });
  }
}

async function handleDashboard(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const status = safeConfigStatus();
  let stats;
  let warning = "";
  try {
    stats = await messageStats();
    status.storageHealthy = true;
  } catch (storageError) {
    logger.error("Dashboard storage read error", { error: storageError.message });
    status.storageHealthy = false;
    warning = "Message history storage is not available yet. Dashboard totals will appear after Blob storage is initialized and the first message is recorded.";
    stats = {
      total: 0,
      sentToday: 0,
      sentLast7Days: 0,
      failed: 0,
      dryRun: 0,
      production: 0,
      recent: []
    };
  }
  return json(200, {
    success: true,
    status,
    stats,
    warning
  });
}

function safeConfigStatus() {
  const sender = process.env.TWILIO_MESSAGING_SERVICE_SID
    ? `Messaging Service ${String(process.env.TWILIO_MESSAGING_SERVICE_SID).slice(0, 4)}...`
    : process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER
      ? `Number ${redactPhone(process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER)}`
      : "";
  return {
    shopifyDomain: process.env.SHOPIFY_SHOP_DOMAIN || "welkom-usa.myshopify.com",
    shopifyApiVersion: process.env.SHOPIFY_API_VERSION || "2025-10",
    shopifyConfigured: hasConfig(),
    twilioConfigured: Boolean(process.env.TWILIO_ACCOUNT_SID && (process.env.TWILIO_AUTH_TOKEN || (process.env.TWILIO_API_KEY_SID && process.env.TWILIO_API_KEY_SECRET)) && (process.env.TWILIO_MESSAGING_SERVICE_SID || process.env.TWILIO_FROM_NUMBER || process.env.TWILIO_PHONE_NUMBER)),
    twilioSender: sender,
    storageProvider: process.env.MESSAGE_STORAGE_PROVIDER || (process.env.NETLIFY === "true" ? "netlify-blobs" : "memory"),
    storagePersistent: (process.env.MESSAGE_STORAGE_PROVIDER || (process.env.NETLIFY === "true" ? "netlify-blobs" : "memory")).toLowerCase() === "netlify-blobs",
    blobInitEnabled: String(process.env.BLOB_INIT_ENABLED || "").toLowerCase() === "true",
    dryRun: String(process.env.SMS_DRY_RUN ?? process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
    productionSendingEnabled: String(process.env.SMS_DRY_RUN ?? process.env.DRY_RUN ?? "true").toLowerCase() === "false",
    sessionDurationMinutes: Number(process.env.SESSION_DURATION_MINUTES || 480),
    authRequired: authRequired(),
    consentEnforced: true,
    cloudflareRequired: false
  };
}

async function handleConfigDiagnostics(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  return json(200, { success: true, diagnostics: safeConfigDiagnostics(event) });
}

function findOrderLineItem(order, lineItemId) {
  return (order.lineItems || []).find((item) => item.id === lineItemId);
}

async function buildRequestItems(order, inputItems = []) {
  const items = [];
  const usedLineItems = new Set();
  for (const itemInput of inputItems.slice(0, 10)) {
    const lineItem = findOrderLineItem(order, itemInput.lineItemId || itemInput.originalLineItemId);
    if (!lineItem || usedLineItems.has(lineItem.id)) {
      return { ok: false, code: "LINE_ITEM_INVALID", error: "Each unavailable item must belong to this order and cannot be repeated." };
    }
    usedLineItems.add(lineItem.id);
    const requestedQuantity = Math.max(1, Math.min(Number(itemInput.quantity || lineItem.quantity || 1), Number(lineItem.quantity || 1)));
    const optionIds = Array.from(new Set((itemInput.substituteVariantIds || itemInput.substitutes || []).map((id) => String(id || "").trim()).filter(Boolean))).slice(0, 3);
    if (!optionIds.length) {
      return { ok: false, code: "SUBSTITUTE_REQUIRED", error: "Select at least one approved substitute for each unavailable item." };
    }
    const substituteOptions = [];
    for (const variantId of optionIds) {
      if (!validateGid(variantId, "ProductVariant").ok) return { ok: false, code: "SUBSTITUTE_INVALID", error: "One selected substitute is invalid." };
      const variantResult = await getVariantById(variantId);
      if (!variantResult.body.success) return { ok: false, code: "SUBSTITUTE_INVALID", error: "One selected substitute could not be loaded from Shopify." };
      const variant = variantResult.body.product;
      if (variant.productStatus !== "ACTIVE" || !variant.availableForSale) {
        return { ok: false, code: "SUBSTITUTE_UNAVAILABLE", error: `${variant.title || "A selected substitute"} is not currently available for sale.` };
      }
      if (Number.isFinite(variant.inventoryQuantity) && variant.inventoryQuantity < requestedQuantity && !itemInput.allowInsufficientInventory) {
        return { ok: false, code: "INSUFFICIENT_INVENTORY", error: `${variant.title || "A selected substitute"} does not have enough inventory. Confirm insufficient inventory before using it.` };
      }
      substituteOptions.push({
        variantId: variant.id,
        productTitle: variant.title,
        variantTitle: variant.variantTitle,
        sku: variant.sku,
        imageUrl: variant.imageUrl,
        price: variant.price,
        availableQuantityAtCreation: variant.inventoryQuantity,
        quantity: requestedQuantity,
        staffNote: itemInput.optionNotes?.[variantId] || ""
      });
    }
    items.push({
      originalLineItemId: lineItem.id,
      originalVariantId: lineItem.variantId || "",
      originalTitle: lineItem.title,
      originalImageUrl: lineItem.imageUrl || "",
      originalPrice: lineItem.price || "",
      currency: String(lineItem.price || order.totalPrice || "").match(/^([A-Z]{3})\s/)?.[1] || "USD",
      quantity: requestedQuantity,
      staffNote: itemInput.staffNote || "",
      substituteOptions
    });
  }
  return { ok: true, items };
}

async function createAndSendCustomerRequest({ event, body, auth, existingRequest = null }) {
  const orderResult = await getOrderById(body.orderId || existingRequest?.shopifyOrderId);
  if (!orderResult.body.success) return json(orderResult.status, orderResult.body);
  const order = orderResult.body.order;
  const orderValidation = validateOrderForSending(order, { lineItemId: order.lineItems?.[0]?.id });
  if (orderValidation.error && orderValidation.code !== "LINE_ITEM_INVALID") {
    return error(orderValidation.status, orderValidation.code, orderValidation.error);
  }
  const optOut = await getOptOutStatus(order.customer.phone);
  if (optOut?.status === "opted_out") return error(400, "RECIPIENT_OPTED_OUT", "This recipient has opted out. No SMS was sent.");

  let request = existingRequest;
  let token = "";
  let publicUrl = "";
  if (!request) {
    const builtItems = await buildRequestItems(order, body.items);
    if (!builtItems.ok) return error(400, builtItems.code, builtItems.error);
    const orderLimited = await rateLimit(`sms-order:${order.id}`, 3, 60 * 60);
    if (orderLimited) return orderLimited;
    const expiryHours = [24, 48, 72].includes(Number(body.expiryHours)) ? Number(body.expiryHours) : 48;
    const created = await createSubstitutionRequest({
      shopifyOrderId: order.id,
      orderNumber: order.name,
      items: builtItems.items,
      staffNote: cleanText(body.staffNote || "", 240),
      createdBy: auth.session.staffName,
      expiresAt: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString(),
      baseUrl: publicBaseUrl(event)
    });
    if (!created.ok) return error(500, created.code || "STORAGE_ERROR", created.error || "Substitution request could not be created.");
    request = created.record;
    token = created.token;
    publicUrl = created.publicUrl;
  } else {
    const rotated = await rotateSubstitutionRequestToken(request.requestId, publicBaseUrl(event), auth.session.staffName);
    if (!rotated.ok) return error(500, rotated.code || "STORAGE_ERROR", rotated.error || "Substitution request link could not be created.");
    request = rotated.record;
    token = rotated.token;
    publicUrl = rotated.publicUrl;
  }

  const message = responseSmsMessage(request.orderNumber, publicUrl);
  const history = await createMessageRecord({
    orderId: order.id,
    orderName: order.name,
    customerPhoneRedacted: redactPhone(order.customer.phone),
    customerFirstName: order.customer.firstName,
    unavailableLineItemId: `request:${request.requestId}`,
    unavailableTitle: `${request.items.length} unavailable item${request.items.length === 1 ? "" : "s"}`,
    substituteTitle: "Secure customer response link",
    customSubstitute: true,
    customSubstituteTitle: "Secure customer response link",
    message,
    staffIdentity: auth.session.staffName,
    initialTwilioStatus: "created",
    latestTwilioStatus: "created",
    idempotencyKey: body.idempotencyKey || `request-send:${request.requestId}:${message}`
  });
  if (!history.ok) return error(500, history.code || "STORAGE_ERROR", history.error || "Message history could not be saved.");

  const smsResult = await sendSms({
    phone: order.customer.phone,
    message,
    orderName: order.name,
    recordId: history.record.id
  });

  const updatedHistory = await saveRecord({
    ...history.record,
    dryRun: smsResult.body.dryRun,
    twilioMessageSid: smsResult.body.sid || "",
    initialTwilioStatus: smsResult.body.providerStatus || "failed",
    latestTwilioStatus: smsResult.body.providerStatus || "failed",
    failureReason: smsResult.body.success ? "" : smsResult.body.error
  });
  const savedRequest = await updateSubstitutionRequestSms(request.requestId, {
    twilioMessageSid: smsResult.body.sid || "",
    latestTwilioStatus: smsResult.body.providerStatus || "failed",
    dryRun: smsResult.body.dryRun,
    sentAt: new Date().toISOString(),
    messageRecordId: history.record.id,
    failureReason: smsResult.body.success ? "" : smsResult.body.error
  }, auth.session.staffName);
  await createAuditRecord({
    type: smsResult.body.success ? "sms_send" : "sms_failure",
    actor: auth.session.staffName,
    messageRecordId: history.record.id,
    details: { mode: "customer_response_link", requestId: request.requestId, dryRun: smsResult.body.dryRun, providerStatus: smsResult.body.providerStatus }
  }).catch(() => {});
  if (smsResult.log) logger.error("Twilio request send error", smsResult.log);
  return json(smsResult.status, {
    ...smsResult.body,
    request: safeRequestForStaff({ ...(savedRequest || request), transientPublicUrl: publicUrl }, true),
    publicUrl,
    messageRecordId: (updatedHistory || history.record).id
  });
}

async function handleCreateSubstitutionRequest(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const staffLimited = await rateLimit(`sms-action:user:${auth.session.user.id}`, 10, 10 * 60);
  if (staffLimited) return staffLimited;
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["orderId", "items", "expiryHours", "staffNote", "sendConfirmed", "idempotencyKey"], required: ["orderId", "items", "sendConfirmed"] });
  if (invalid) return invalid;
  if (body.sendConfirmed !== true) return error(400, "SEND_CONFIRMATION_REQUIRED", "Confirm this SMS before sending.");
  if (!validateGid(body.orderId, "Order").ok) return invalidRequest();
  return createAndSendCustomerRequest({ event, body, auth });
}

async function handleListSubstitutionRequests(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const params = new URLSearchParams(event.rawQuery || "");
  try {
    const result = await listSubstitutionRequests(process.env, {
      page: params.get("page"),
      limit: params.get("limit"),
      status: params.get("status"),
      query: params.get("query") || params.get("search"),
      includeLinks: true
    });
    return json(200, { success: true, ...result });
  } catch (storageError) {
    logger.error("Substitution request storage read error", { error: storageError.message });
    return json(200, { success: true, requests: [], page: 1, limit: 50, total: 0, totalPages: 1, storageHealthy: false, warning: "Substitution request storage is not available yet." });
  }
}

async function handleGetSubstitutionRequest(event, route) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const id = route.replace(/^substitution-requests\//, "").replace(/\/.*$/, "");
  const record = await getSubstitutionRequest(id);
  if (!record) return error(404, "NOT_FOUND", "Substitution request was not found.");
  return json(200, { success: true, request: safeRequestForStaff(record) });
}

async function handleRequestAction(event, route) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const match = route.match(/^substitution-requests\/([^/]+)\/(revoke|complete|review|resend)$/);
  if (!match) return error(404, "NOT_FOUND", "Not found.");
  const [, id, action] = match;
  if (action === "resend") {
    const body = parseBody(event);
    if (!body?.sendConfirmed) return error(400, "SEND_CONFIRMATION_REQUIRED", "Confirm this SMS before sending.");
    const record = await getSubstitutionRequest(id);
    if (!record) return error(404, "NOT_FOUND", "Substitution request was not found.");
    const staffLimited = await rateLimit(`sms-action:user:${auth.session.user.id}`, 10, 10 * 60);
    if (staffLimited) return staffLimited;
    const orderLimited = await rateLimit(`sms-order:${record.shopifyOrderId || record.orderNumber}`, 3, 60 * 60);
    if (orderLimited) return orderLimited;
    return createAndSendCustomerRequest({ event, body: { orderId: record.shopifyOrderId, idempotencyKey: `request-resend:${id}:${Date.now()}` }, auth, existingRequest: record });
  }
  const status = action === "revoke" ? "revoked" : action === "complete" ? "completed" : "staff_reviewing";
  const result = await updateSubstitutionRequestStatus(id, status, auth.session.staffName);
  if (!result.ok) return error(result.code === "NOT_FOUND" ? 404 : 400, result.code, result.error);
  return json(200, { success: true, request: result.request });
}

async function handlePublicRequest(event) {
  const limited = await rateLimit(`public-read:ip:${clientIp(event)}`, 30, 10 * 60);
  if (limited) return limited;
  const token = new URLSearchParams(event.rawQuery || "").get("token") || routeName(event).replace(/^public\/substitution-request\//, "");
  if (!token) return error(404, "REQUEST_UNAVAILABLE", "This request is not available.");
  const result = await markSubstitutionRequestOpened(token);
  if (!result.ok) return error(404, "REQUEST_UNAVAILABLE", "This request is not available.");
  return json(200, { success: true, request: safeRequestForCustomer(result.record) });
}

async function handlePublicSubmit(event) {
  const ipLimited = await rateLimit(`public-submit:ip:${clientIp(event)}`, 5, 10 * 60);
  if (ipLimited) return ipLimited;
  const tokenForLimit = (() => {
    const parsed = parseBody(event);
    return parsed?.token || "";
  })();
  if (tokenForLimit) {
    const tokenLimited = await rateLimit(`public-submit:token:${tokenForLimit}`, 5, 10 * 60);
    if (tokenLimited) return tokenLimited;
  }
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const invalid = validateBody(body, { allowed: ["token", "choices"], required: ["token", "choices"] });
  if (invalid) return invalid;
  if (!Array.isArray(body.choices) || body.choices.length > 10) return invalidRequest();
  for (const choice of body.choices) {
    const choiceInvalid = validateBody(choice, { allowed: ["requestItemId", "type", "optionId", "note"], required: ["requestItemId", "type"] });
    if (choiceInvalid) return choiceInvalid;
  }
  const result = await submitSubstitutionResponse(body.token, body.choices);
  if (!result.ok) return error(result.status || 400, result.code || "INVALID_RESPONSE", "This request is not available.");
  return json(200, {
    success: true,
    alreadySubmitted: Boolean(result.alreadySubmitted),
    message: result.alreadySubmitted ? "We already received your choices. Our team will review them before updating your order." : "Thank you - we've received your choices. Our team will review them before updating your order.",
    request: safeRequestForCustomer(result.record)
  });
}

async function handleInitializeBlobs(event, blobConnection = { connected: false, reason: "unknown" }) {
  if (String(process.env.BLOB_INIT_ENABLED || "").toLowerCase() !== "true") {
    return error(403, "BLOB_INIT_DISABLED", "Blob initialization is disabled. Temporarily set BLOB_INIT_ENABLED=true in Netlify, run initialization from Settings, then set it back to false.");
  }
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return error(auth.status || 403, auth.code || "FORBIDDEN", auth.error || "You do not have permission to perform this action.");
  try {
    const result = await initializeDataStores();
    return json(200, { success: true, ...result });
  } catch (initError) {
    const diagnostic = {
      stage: initError.stage || "unknown",
      storeName: initError.storeName || "",
      recordType: initError.recordType || "",
      fieldName: initError.fieldName || "",
      rule: initError.rule || "",
      errorCode: initError.code || "STORAGE_ERROR",
      errorName: initError.cause?.name || initError.name || "",
      blobContext: blobConnection.connected ? "lambda-payload" : blobConnection.reason
    };
    logger.error("Blob initialization error", diagnostic);
    return storageErrorResponse(500, "STORAGE_ERROR", `Blob initialization failed during ${diagnostic.stage}.`, diagnostic);
  }
}

async function handleTemplates(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  if (event.httpMethod === "GET") {
    try {
      return json(200, { success: true, templates: await listTemplates(), storageHealthy: true });
    } catch (storageError) {
      logger.error("Template storage read error", { error: storageError.message });
      return json(200, {
        success: true,
        templates: [defaultTemplate()],
        storageHealthy: false,
        warning: "Template storage is not available yet. The default template is shown temporarily. Use Settings to initialize Blob stores."
      });
    }
  }
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  let result;
  try {
    result = await saveTemplate(body);
  } catch (storageError) {
    logger.error("Template save error", { error: storageError.message });
    return error(500, "STORAGE_ERROR", `Template could not be saved: ${safeErrorDetail(storageError)}`);
  }
  if (!result.ok) return error(400, result.code, result.error);
  return json(200, { success: true, template: result.template });
}

async function handleTemplateArchive(event, route) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const id = decodeURIComponent(route.replace(/^templates\//, "").replace(/\/archive$/, ""));
  let result;
  try {
    result = await archiveTemplate(id);
  } catch (storageError) {
    logger.error("Template archive error", { error: storageError.message });
    return error(500, "STORAGE_ERROR", `Template could not be archived: ${safeErrorDetail(storageError)}`);
  }
  if (!result.ok) return error(400, result.code, result.error);
  return json(200, { success: true, template: result.template });
}

async function handleBackup(event, route) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const payload = await backupPayload();
  await createAuditRecord({
    type: "backup_exported",
    actor: auth.session.staffName,
    details: { route, format: route.endsWith(".csv") ? "csv" : "json" }
  }).catch(() => {});
  if (route === "backup/messages.csv") {
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Disposition": `attachment; filename="welkom-sms-messages-${new Date().toISOString().slice(0, 10)}.csv"`
      },
      body: recordsToCsv(payload.messageHistory)
    };
  }
  return json(200, payload, {
    "Content-Disposition": `attachment; filename="welkom-sms-backup-${new Date().toISOString().slice(0, 10)}.json"`
  });
}

async function handleAdminCleanup(event) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const sessions = await cleanupExpiredSessions();
  const rateLimits = await cleanupRateLimitRecords({ olderThan: Date.now(), max: 100 });
  const data = await cleanupDataStoreRecords({ max: 100 });
  await createAuditRecord({
    type: "admin_cleanup_run",
    actor: auth.session.staffName,
    details: { sessions, rateLimits, data }
  }).catch(() => {});
  return json(200, { success: true, cleanup: { sessions, rateLimits, data } });
}

async function handleHistoryRecord(event, route) {
  const auth = await requireSession(event);
  if (auth.error) return auth.error;
  const id = route.replace(/^message-history\//, "");
  const record = await getMessageRecord(id);
  if (!record) return error(404, "NOT_FOUND", "Message record was not found.");
  return json(200, { success: true, record: publicRecord(record) });
}

async function handleTwilioStatus(event) {
  const params = parseForm(event);
  const url = externallyVisibleWebhookUrl(event, "twilio-status");
  const signature = event.headers["x-twilio-signature"] || event.headers["X-Twilio-Signature"];
  if (!validateTwilioSignature({ url, params, signature })) {
    await createAuditRecord({ type: "invalid_twilio_signature", details: { webhook: "delivery_status" } }).catch(() => {});
    return error(403, "TWILIO_ERROR", "Invalid Twilio webhook signature.");
  }
  const messageSid = params.MessageSid || params.SmsSid || "";
  if (!messageSid) return error(400, "INVALID_REQUEST", "Missing Twilio message SID.");
  const status = String(params.MessageStatus || params.SmsStatus || "").trim().toLowerCase();
  if (!ALLOWED_TWILIO_STATUSES.has(status)) return error(400, "INVALID_REQUEST", "Invalid Twilio status.");
  const associatedRecordId = new URLSearchParams(event.rawQuery || "").get("recordId") || params.recordId || "";
  const processed = await recordProcessedTwilioMessage({
    messageSid,
    fromRedacted: redactPhone(params.From || ""),
    toRedacted: redactPhone(params.To || ""),
    processingStatus: `delivery_${status}`,
    type: "delivery_status",
    associatedRecordId
  });
  if (processed.duplicate) return json(200, { success: true, duplicate: true });
  const record = await updateMessageStatusBySid(messageSid, status);
  if (!record) return error(404, "NOT_FOUND", "Message record was not found.");
  return json(200, { success: true });
}

async function handleTwilioInbound(event) {
  const params = parseForm(event);
  const url = externallyVisibleWebhookUrl(event, "twilio-inbound");
  const signature = event.headers["x-twilio-signature"] || event.headers["X-Twilio-Signature"];
  if (!validateTwilioSignature({ url, params, signature })) {
    await createAuditRecord({ type: "invalid_twilio_signature", details: { webhook: "inbound" } }).catch(() => {});
    return error(403, "TWILIO_ERROR", "Invalid Twilio webhook signature.");
  }
  const messageSid = params.MessageSid || params.SmsSid || "";
  if (!messageSid) return twiml();
  const from = String(params.From || "").trim();
  const to = String(params.To || "").trim();
  const keyword = String(params.Body || "").trim().split(/\s+/)[0]?.toUpperCase() || "";
  const processed = await recordProcessedTwilioMessage({
    messageSid,
    fromRedacted: redactPhone(from),
    toRedacted: redactPhone(to),
    processingStatus: STOP_KEYWORDS.has(keyword) ? "opted_out" : HELP_KEYWORDS.has(keyword) ? "help_requested" : "received",
    type: "inbound_message",
    associatedRecordId: params.RequestId || ""
  });
  if (processed.duplicate) return twiml();
  if (STOP_KEYWORDS.has(keyword)) {
    await saveOptOutStatus({ phone: from, fromRedacted: redactPhone(from), toRedacted: redactPhone(to), messageSid, keyword, status: "opted_out" });
    return twiml("You have been opted out and will not receive further non-essential Welkom USA SMS messages.");
  }
  if (HELP_KEYWORDS.has(keyword)) {
    return twiml("Welkom USA support: reply STOP to opt out. For order help, please contact Welkom USA customer service.");
  }
  return twiml();
}

async function handleShopifyWebhook(event) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET || process.env.SHOPIFY_CLIENT_SECRET || "";
  if (!secret) return error(500, "SHOPIFY_WEBHOOK_ERROR", "Shopify webhook secret is not configured.");
  const supplied = event.headers["x-shopify-hmac-sha256"] || event.headers["X-Shopify-Hmac-Sha256"] || "";
  const expected = crypto.createHmac("sha256", secret).update(event.body || "", "utf8").digest("base64");
  if (!timingSafeEqualText(supplied, expected)) {
    await createAuditRecord({ type: "invalid_shopify_hmac", details: { topic: event.headers["x-shopify-topic"] || event.headers["X-Shopify-Topic"] || "" } }).catch(() => {});
    return error(403, "SHOPIFY_WEBHOOK_ERROR", "Invalid Shopify webhook signature.");
  }
  const shopDomain = String(event.headers["x-shopify-shop-domain"] || event.headers["X-Shopify-Shop-Domain"] || "").trim().toLowerCase();
  const expectedShopDomain = String(process.env.SHOPIFY_SHOP_DOMAIN || "welkom-usa.myshopify.com").trim().toLowerCase();
  if (shopDomain && shopDomain !== expectedShopDomain) return error(403, "SHOPIFY_WEBHOOK_ERROR", "Invalid Shopify shop domain.");
  const topic = String(event.headers["x-shopify-topic"] || event.headers["X-Shopify-Topic"] || "").trim().toLowerCase();
  if (!ALLOWED_SHOPIFY_WEBHOOK_TOPICS.has(topic)) return error(400, "SHOPIFY_WEBHOOK_ERROR", "Unexpected Shopify webhook topic.");
  const deliveryId = event.headers["x-shopify-webhook-id"] || event.headers["X-Shopify-Webhook-Id"] || "";
  if (!deliveryId || !/^[A-Za-z0-9._:-]{6,160}$/.test(String(deliveryId))) return error(400, "SHOPIFY_WEBHOOK_ERROR", "Missing Shopify webhook delivery ID.");
  if (deliveryId) {
    const duplicate = await checkRateLimit({
      key: `shopify-webhook-id:${deliveryId}`,
      limit: 1,
      windowSeconds: 24 * 60 * 60,
      blockSeconds: 24 * 60 * 60
    });
    if (!duplicate.ok) return json(200, { success: true, duplicate: true });
  }
  return json(200, { success: true });
}

exports.handler = async (event) => {
  activeEvent = event;
  const blobConnection = connectNetlifyBlobs(event);
  const route = routeName(event);
  if (event.httpMethod === "OPTIONS") return optionsResponse();
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");
  const denied = await authorizeRegisteredEndpoint(event, route);
  if (denied) return denied;

  if (route === "twilio-status" && event.httpMethod === "POST") return handleTwilioStatus(event);
  if (route === "twilio-inbound" && event.httpMethod === "POST") return handleTwilioInbound(event);
  if (route === "shopify-webhook" && event.httpMethod === "POST") return handleShopifyWebhook(event);
  if ((route === "public/substitution-request" || route.startsWith("public/substitution-request/")) && event.httpMethod === "GET") return handlePublicRequest(event);
  if (route === "public/substitution-response" && event.httpMethod === "POST") return handlePublicSubmit(event);
  if (route === "session" && event.httpMethod === "GET") return handleSession(event);
  if (route === "dashboard" && event.httpMethod === "GET") return handleDashboard(event);
  if (route === "config-diagnostics" && event.httpMethod === "GET") return handleConfigDiagnostics(event);
  if (route === "message-history" && event.httpMethod === "GET") return handleHistory(event);
  if (route.startsWith("message-history/") && event.httpMethod === "GET") return handleHistoryRecord(event, route);
  if (route === "substitution-requests" && event.httpMethod === "GET") return handleListSubstitutionRequests(event);
  if (/^substitution-requests\/[^/]+$/.test(route) && event.httpMethod === "GET") return handleGetSubstitutionRequest(event, route);
  if (route === "templates" && event.httpMethod === "GET") return handleTemplates(event);
  if (route === "backup.json" && event.httpMethod === "GET") return handleBackup(event, route);
  if (route === "backup/messages.csv" && event.httpMethod === "GET") return handleBackup(event, route);

  if (route === "login") return handleLogin(event);
  if (route === "logout") return handleLogout(event);
  if (route === "admin/init-blobs") return handleInitializeBlobs(event, blobConnection);
  if (route === "admin/cleanup") return handleAdminCleanup(event);
  if (route === "templates") return handleTemplates(event);
  if (/^templates\/.+\/archive$/.test(route)) return handleTemplateArchive(event, route);
  if (route === "order-search") return handleOrderSearch(event);
  if (route === "product-search") return handleProductSearch(event);
  if (route === "line-item-substitutions") return handleLineItemSubstitutions(event);
  if (route === "duplicate-check") return handleDuplicateCheck(event);
  if (route === "send-substitution-sms") return handleSendSubstitutionSms(event);
  if (route === "send-manual-sms") return handleSendManualSms(event);
  if (route === "substitution-requests") return handleCreateSubstitutionRequest(event);
  if (/^substitution-requests\/[^/]+\/(revoke|complete|review|resend)$/.test(route)) return handleRequestAction(event, route);

  return publicError(404, "NOT_FOUND");
};
