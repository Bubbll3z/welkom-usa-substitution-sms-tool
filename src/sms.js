const twilio = require("twilio");

const STORE_NAME = "Welkom USA";
const MAX_SMS_LENGTH = 320;

function isDryRun(env = process.env) {
  const value = env.SMS_DRY_RUN ?? env.DRY_RUN ?? "true";
  return String(value).toLowerCase() !== "false";
}

function redactPhone(phone) {
  if (!phone || typeof phone !== "string") return "[redacted]";
  const clean = phone.trim();
  if (clean.length < 6) return "[redacted]";
  return `${clean.slice(0, 3)}${"*".repeat(Math.max(clean.length - 5, 3))}${clean.slice(-2)}`;
}

function isE164(phone) {
  return typeof phone === "string" && /^\+[1-9]\d{7,14}$/.test(phone.trim());
}

function cleanOrderNumber(orderName) {
  return String(orderName || "").trim().replace(/^#/, "");
}

function buildSubstitutionMessage({ firstName, unavailableItem, substituteItem, orderName }) {
  return `${STORE_NAME}: Hi ${firstName || "there"}, ${unavailableItem} in order #${cleanOrderNumber(
    orderName
  )} is unavailable. We can substitute it with ${substituteItem}. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.`;
}

function hasTwilioConfig(env = process.env) {
  return Boolean(
    env.TWILIO_ACCOUNT_SID &&
      (env.TWILIO_AUTH_TOKEN || (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET)) &&
      (env.TWILIO_MESSAGING_SERVICE_SID || env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER)
  );
}

function makeTwilioClient(env = process.env) {
  if (env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET) {
    return twilio(env.TWILIO_API_KEY_SID, env.TWILIO_API_KEY_SECRET, {
      accountSid: env.TWILIO_ACCOUNT_SID
    });
  }
  return twilio(env.TWILIO_ACCOUNT_SID, env.TWILIO_AUTH_TOKEN);
}

function twilioParams({ to, body }, env = process.env) {
  const params = { to, body };
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER;
  }
  return params;
}

function safeTwilioError(error) {
  if (error.code === 30032) return "Twilio toll-free verification is incomplete. No SMS was delivered.";
  if (error.code === 21610) return "This recipient has opted out. No SMS was delivered.";
  if (error.code === 21211 || error.code === 21614) return "The destination phone number cannot receive this SMS.";
  if (error.status === 401 || error.status === 403) return "Twilio authentication or sender configuration failed.";
  if (error.status === 429) return "Twilio rate limit reached. Please wait and try again.";
  return "SMS could not be sent. Please try again.";
}

async function sendSms({ phone, message, env = process.env, twilioClient }) {
  const cleanPhone = String(phone || "").trim();
  const cleanMessage = String(message || "").trim();
  const dryRun = isDryRun(env);

  if (!isE164(cleanPhone)) {
    return { status: 400, body: { success: false, error: "Phone number must be valid E.164 format." } };
  }

  if (!cleanMessage || !cleanMessage.startsWith(`${STORE_NAME}:`)) {
    return { status: 400, body: { success: false, error: `Message must start with "${STORE_NAME}:".` } };
  }

  if (cleanMessage.length > MAX_SMS_LENGTH) {
    return { status: 400, body: { success: false, error: `Message must be ${MAX_SMS_LENGTH} characters or fewer.` } };
  }

  if (dryRun) {
    return {
      status: 200,
      body: {
        success: true,
        dryRun: true,
        message: "Dry run successful. SMS was not actually sent.",
        recipient: redactPhone(cleanPhone),
        providerStatus: "not-sent"
      }
    };
  }

  if (!hasTwilioConfig(env)) {
    return { status: 500, body: { success: false, error: "Twilio is not configured." } };
  }

  try {
    const client = twilioClient || makeTwilioClient(env);
    const sms = await client.messages.create(twilioParams({ to: cleanPhone, body: cleanMessage }, env));
    return {
      status: 200,
      body: {
        success: true,
        dryRun: false,
        message: "SMS sent successfully.",
        recipient: redactPhone(cleanPhone),
        providerStatus: sms.status || "sent",
        sid: sms.sid
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        success: false,
        dryRun: false,
        error: safeTwilioError(error),
        recipient: redactPhone(cleanPhone),
        providerStatus: "failed"
      },
      log: {
        code: error.code,
        status: error.status,
        name: error.name
      }
    };
  }
}

module.exports = {
  MAX_SMS_LENGTH,
  STORE_NAME,
  buildSubstitutionMessage,
  cleanOrderNumber,
  isDryRun,
  isE164,
  redactPhone,
  sendSms
};
