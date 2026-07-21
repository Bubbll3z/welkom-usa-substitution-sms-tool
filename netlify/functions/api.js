require("dotenv").config();

const {
  checkStaffPassword,
  clearSessionCookie,
  cookieForSession,
  createSession,
  getSessionFromEvent,
  rateLimitLogin,
  resetLoginAttempts
} = require("../../src/auth");
const {
  findOrder,
  getOrderById,
  getVariantById,
  hasConfig,
  searchProductsForSubstitutions,
  searchSubstitutionsForLineItem
} = require("../../src/shopify");
const { buildSubstitutionMessage, redactPhone, sendSms, smsLength, validateMessage, validateTwilioSignature } = require("../../src/sms");
const {
  archiveTemplate,
  backupPayload,
  createMessageRecord,
  findByIdempotency,
  findDuplicate,
  getMessageRecord,
  listTemplates,
  listMessageRecords,
  messageStats,
  publicRecord,
  queryMessageRecords,
  recordsToCsv,
  saveRecord,
  saveTemplate,
  updateMessageStatus
} = require("../../src/history");

const apiBuckets = new Map();
const MAX_BODY_BYTES = 16 * 1024;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

function error(statusCode, code, message) {
  return json(statusCode, { success: false, code, error: message });
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

function clientKey(event, route) {
  return `${route}:${event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"] || "local"}`;
}

function rateLimit(event, route, max = 60, windowMs = 60 * 1000) {
  if (process.env.NODE_ENV === "test") return null;
  const key = clientKey(event, route);
  const now = Date.now();
  const entry = apiBuckets.get(key) || { count: 0, resetAt: now + windowMs };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  apiBuckets.set(key, entry);
  if (entry.count > max) return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.");
  return null;
}

function parseForm(event) {
  return Object.fromEntries(new URLSearchParams(event.body || ""));
}

function routeName(event) {
  const raw = event.path || "";
  return raw.replace(/^\/\.netlify\/functions\/api\/?/, "").replace(/^\/api\/?/, "");
}

function requireJson(event) {
  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  return contentType.includes("application/json");
}

function requireSession(event) {
  const session = getSessionFromEvent(event);
  if (!session.ok) return { error: error(session.status, session.code, session.error) };
  return { session };
}

async function handleLogin(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const limited = rateLimitLogin(event);
  if (!limited.ok) return error(limited.status, limited.code, limited.error);

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  const password = checkStaffPassword(body.password);
  if (!password.ok) return error(password.status, password.code, password.error);

  const session = createSession({ staffName: body.staffName || process.env.STAFF_NAME || "Welkom USA Staff" });
  if (!session.ok) return error(session.status, session.code, session.error);

  resetLoginAttempts(event);
  return json(200, {
    success: true,
    staffName: session.payload.staffName,
    expiresAt: new Date(session.payload.exp).toISOString()
  }, {
    "Set-Cookie": cookieForSession(session.token, event)
  });
}

async function handleLogout() {
  return json(200, { success: true }, { "Set-Cookie": clearSessionCookie() });
}

async function handleSession(event) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  return json(200, { success: true, staffName: auth.session.staffName, expiresAt: new Date(auth.session.payload.exp).toISOString() });
}

async function handleOrderSearch(event) {
  const limited = rateLimit(event, "order-search", 30);
  if (limited) return limited;
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  const result = await findOrder(body.query);
  return json(result.status, result.body);
}

async function handleProductSearch(event) {
  const limited = rateLimit(event, "product-search", 40);
  if (limited) return limited;
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  const query = String(body.query || "").trim();
  if (!query) return error(400, "INVALID_REQUEST", "Product search is required.");
  if (query.length > 120) return error(400, "INVALID_REQUEST", "Product search is too long.");
  if (!hasConfig()) return error(500, "SHOPIFY_ERROR", "Shopify Admin API is not configured.");

  const products = await searchProductsForSubstitutions(query);
  return json(200, { success: true, products });
}

async function handleLineItemSubstitutions(event) {
  const limited = rateLimit(event, "line-item-substitutions", 40);
  if (limited) return limited;
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

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
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
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

async function handleSendSubstitutionSms(event) {
  const limited = rateLimit(event, "send-substitution-sms", 10);
  if (limited) return limited;
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

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

  if (created.idempotent) {
    return json(200, { success: true, idempotent: true, message: "This request was already processed.", record: publicRecord(created.record) });
  }

  const smsResult = await sendSms({
    phone: order.customer.phone,
    message: messageValidation.message,
    orderName: order.name,
    recordId: created.record.id
  });

  created.record.dryRun = smsResult.body.dryRun;
  created.record.twilioMessageSid = smsResult.body.sid || "";
  created.record.initialTwilioStatus = smsResult.body.providerStatus || "failed";
  created.record.latestTwilioStatus = smsResult.body.providerStatus || "failed";
  created.record.failureReason = smsResult.body.success ? "" : smsResult.body.error;
  await saveRecord(created.record);

  if (smsResult.log) {
    console.error("Twilio send error:", smsResult.log);
  }
  console.log("Substitution SMS processed.", {
    orderName: order.name,
    dryRun: smsResult.body.dryRun,
    providerStatus: smsResult.body.providerStatus,
    staffIdentity: auth.session.staffName
  });

  return json(smsResult.status, { ...smsResult.body, record: publicRecord(created.record) });
}

async function handleHistory(event) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  const params = new URLSearchParams(event.rawQuery || "");
  const result = await queryMessageRecords(process.env, {
    page: params.get("page"),
    limit: params.get("limit"),
    query: params.get("query"),
    status: params.get("status"),
    dryRun: params.get("dryRun")
  });
  return json(200, { success: true, ...result });
}

async function handleDashboard(event) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  return json(200, {
    success: true,
    status: safeConfigStatus(),
    stats: await messageStats()
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
    storagePersistent: (process.env.MESSAGE_STORAGE_PROVIDER || "").toLowerCase() === "netlify-blobs",
    dryRun: String(process.env.SMS_DRY_RUN ?? process.env.DRY_RUN ?? "true").toLowerCase() !== "false",
    productionSendingEnabled: String(process.env.SMS_DRY_RUN ?? process.env.DRY_RUN ?? "true").toLowerCase() === "false",
    sessionDurationMinutes: Number(process.env.SESSION_DURATION_MINUTES || 480),
    consentEnforced: true,
    cloudflareRequired: false
  };
}

async function handleTemplates(event) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  if (event.httpMethod === "GET") return json(200, { success: true, templates: await listTemplates() });
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  const result = await saveTemplate(body);
  if (!result.ok) return error(400, result.code, result.error);
  return json(200, { success: true, template: result.template });
}

async function handleTemplateArchive(event, route) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  const id = decodeURIComponent(route.replace(/^templates\//, "").replace(/\/archive$/, ""));
  const result = await archiveTemplate(id);
  if (!result.ok) return error(400, result.code, result.error);
  return json(200, { success: true, template: result.template });
}

async function handleBackup(event, route) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  const payload = await backupPayload();
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

async function handleHistoryRecord(event, route) {
  const auth = requireSession(event);
  if (auth.error) return auth.error;
  const id = route.replace(/^message-history\//, "");
  const record = await getMessageRecord(id);
  if (!record) return error(404, "NOT_FOUND", "Message record was not found.");
  return json(200, { success: true, record: publicRecord(record) });
}

async function handleTwilioStatus(event) {
  const params = parseForm(event);
  const host = event.headers.host || event.headers.Host;
  const proto = event.headers["x-forwarded-proto"] || event.headers["X-Forwarded-Proto"] || "https";
  const url = `${proto}://${host}${event.path}${event.rawQuery ? `?${event.rawQuery}` : ""}`;
  const signature = event.headers["x-twilio-signature"] || event.headers["X-Twilio-Signature"];
  if (!validateTwilioSignature({ url, params, signature })) {
    return error(403, "TWILIO_ERROR", "Invalid Twilio webhook signature.");
  }
  const recordId = new URLSearchParams(event.rawQuery || "").get("recordId") || params.recordId;
  if (!recordId) return error(400, "INVALID_REQUEST", "Missing message record ID.");
  const status = params.MessageStatus || params.SmsStatus || "";
  const record = await updateMessageStatus(recordId, status);
  if (!record) return error(404, "NOT_FOUND", "Message record was not found.");
  return json(200, { success: true });
}

exports.handler = async (event) => {
  const route = routeName(event);
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");

  if (route === "twilio-status" && event.httpMethod === "POST") return handleTwilioStatus(event);
  if (route === "session" && event.httpMethod === "GET") return handleSession(event);
  if (route === "dashboard" && event.httpMethod === "GET") return handleDashboard(event);
  if (route === "message-history" && event.httpMethod === "GET") return handleHistory(event);
  if (route.startsWith("message-history/") && event.httpMethod === "GET") return handleHistoryRecord(event, route);
  if (route === "templates" && event.httpMethod === "GET") return handleTemplates(event);
  if (route === "backup.json" && event.httpMethod === "GET") return handleBackup(event, route);
  if (route === "backup/messages.csv" && event.httpMethod === "GET") return handleBackup(event, route);

  if (event.httpMethod !== "POST") {
    return error(405, "INVALID_REQUEST", "Method not allowed.");
  }

  if (route === "login") return handleLogin(event);
  if (route === "logout") return handleLogout(event);
  if (route === "templates") return handleTemplates(event);
  if (/^templates\/.+\/archive$/.test(route)) return handleTemplateArchive(event, route);
  if (route === "order-search") return handleOrderSearch(event);
  if (route === "product-search") return handleProductSearch(event);
  if (route === "line-item-substitutions") return handleLineItemSubstitutions(event);
  if (route === "duplicate-check") return handleDuplicateCheck(event);
  if (route === "send-substitution-sms") return handleSendSubstitutionSms(event);

  return error(404, "NOT_FOUND", "Not found.");
};
