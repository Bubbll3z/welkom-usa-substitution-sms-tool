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
  searchProductsForSubstitutions,
  searchSubstitutionsForLineItem
} = require("../../src/shopify");
const { buildSubstitutionMessage, redactPhone, sendSms, smsLength, validateMessage, validateTwilioSignature } = require("../../src/sms");
const {
  createMessageRecord,
  findByIdempotency,
  findDuplicate,
  getMessageRecord,
  listMessageRecords,
  publicRecord,
  saveRecord,
  updateMessageStatus
} = require("../../src/history");

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
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  const result = await findOrder(body.query);
  return json(result.status, result.body);
}

async function handleProductSearch(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  const query = String(body.query || "").trim();
  if (!query) return error(400, "INVALID_REQUEST", "Product search is required.");
  if (query.length > 120) return error(400, "INVALID_REQUEST", "Product search is too long.");

  const products = await searchProductsForSubstitutions(query);
  return json(200, { success: true, products });
}

async function handleLineItemSubstitutions(event) {
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
    substituteVariantId: body.substituteVariantId
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

async function handleSendSubstitutionSms(event) {
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const auth = requireSession(event);
  if (auth.error) return auth.error;

  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");

  if (!body.orderId || !body.lineItemId || !body.substituteVariantId) {
    return error(400, "INVALID_REQUEST", "Order, unavailable item, and substitute item are required.");
  }

  const orderResult = await getOrderById(body.orderId);
  if (!orderResult.body.success) return json(orderResult.status, orderResult.body);
  const order = orderResult.body.order;
  const orderValidation = validateOrderForSending(order, body);
  if (orderValidation.error) return error(orderValidation.status, orderValidation.code, orderValidation.error);

  const substituteResult = await getVariantById(body.substituteVariantId);
  if (!substituteResult.body.success) return json(substituteResult.status, substituteResult.body);
  const substitute = substituteResult.body.product;
  if (substitute.productStatus !== "ACTIVE" || !substitute.availableForSale) {
    return error(400, "SUBSTITUTE_UNAVAILABLE", "The selected substitute is not currently available for sale.");
  }
  if (Number.isFinite(substitute.inventoryQuantity) && substitute.inventoryQuantity <= 0) {
    return error(400, "SUBSTITUTE_UNAVAILABLE", "The selected substitute has no available inventory.");
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
    substituteVariantId: substitute.id
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
    substituteVariantId: substitute.id,
    substituteTitle: substitute.title,
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
  const records = await listMessageRecords();
  return json(200, { success: true, records });
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

  if (route === "twilio-status" && event.httpMethod === "POST") return handleTwilioStatus(event);
  if (route === "session" && event.httpMethod === "GET") return handleSession(event);
  if (route === "message-history" && event.httpMethod === "GET") return handleHistory(event);
  if (route.startsWith("message-history/") && event.httpMethod === "GET") return handleHistoryRecord(event, route);

  if (event.httpMethod !== "POST") {
    return error(405, "INVALID_REQUEST", "Method not allowed.");
  }

  if (route === "login") return handleLogin(event);
  if (route === "logout") return handleLogout(event);
  if (route === "order-search") return handleOrderSearch(event);
  if (route === "product-search") return handleProductSearch(event);
  if (route === "line-item-substitutions") return handleLineItemSubstitutions(event);
  if (route === "duplicate-check") return handleDuplicateCheck(event);
  if (route === "send-substitution-sms") return handleSendSubstitutionSms(event);

  return error(404, "NOT_FOUND", "Not found.");
};
