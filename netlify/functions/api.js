require("dotenv").config();

const { findOrder } = require("../../src/shopify");
const { buildSubstitutionMessage, sendSms } = require("../../src/sms");

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (error) {
    return null;
  }
}

function checkStaffPassword(password) {
  if (!process.env.STAFF_PASSWORD) {
    return { status: 500, body: { success: false, error: "Staff password is not configured." } };
  }

  if (password !== process.env.STAFF_PASSWORD) {
    return { status: 401, body: { success: false, error: "Incorrect staff password." } };
  }

  return null;
}

function routeName(event) {
  const raw = event.path || "";
  return raw.replace(/^\/\.netlify\/functions\/api\/?/, "").replace(/^\/api\/?/, "");
}

async function handleOrderSearch(event) {
  const body = parseBody(event);
  if (!body) return json(400, { success: false, error: "Request body must be valid JSON." });

  const authError = checkStaffPassword(body.password);
  if (authError) return json(authError.status, authError.body);

  const result = await findOrder(body.query);
  return json(result.status, result.body);
}

async function handleSendSubstitutionSms(event) {
  const body = parseBody(event);
  if (!body) return json(400, { success: false, error: "Request body must be valid JSON." });

  const authError = checkStaffPassword(body.password);
  if (authError) return json(authError.status, authError.body);

  const message = String(body.message || "").trim() || buildSubstitutionMessage({
    firstName: body.firstName,
    unavailableItem: body.unavailableItem,
    substituteItem: body.substituteItem,
    orderName: body.orderName
  });

  const result = await sendSms({
    phone: body.phone,
    message
  });

  if (result.log) {
    console.error("Twilio send error:", result.log);
  }

  console.log("Substitution SMS request processed.", {
    orderName: body.orderName,
    unavailableItemLength: String(body.unavailableItem || "").length,
    substituteItemLength: String(body.substituteItem || "").length,
    dryRun: result.body.dryRun,
    providerStatus: result.body.providerStatus
  });

  return json(result.status, result.body);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed." });
  }

  const contentType = event.headers["content-type"] || event.headers["Content-Type"] || "";
  if (!contentType.includes("application/json")) {
    return json(415, { success: false, error: "Content-Type must be application/json." });
  }

  const route = routeName(event);

  if (route === "order-search") {
    return handleOrderSearch(event);
  }

  if (route === "send-substitution-sms") {
    return handleSendSubstitutionSms(event);
  }

  return json(404, { success: false, error: "Not found." });
};
