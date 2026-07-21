const twilio = require("twilio");

const STORE_NAME = "Welkom USA";
const MAX_SMS_LENGTH = 320;
const GSM_7_BASIC = "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_7_EXTENDED = "^{}\\[~]|€";

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

function isGsm7(text) {
  return Array.from(String(text || "")).every((char) => GSM_7_BASIC.includes(char) || GSM_7_EXTENDED.includes(char));
}

function smsLength(text) {
  const value = String(text || "");
  if (!isGsm7(value)) {
    return { encoding: "UCS-2", length: Array.from(value).length, segments: segmentCount(Array.from(value).length, 70, 67) };
  }
  const length = Array.from(value).reduce((total, char) => total + (GSM_7_EXTENDED.includes(char) ? 2 : 1), 0);
  return { encoding: "GSM-7", length, segments: segmentCount(length, 160, 153) };
}

function segmentCount(length, singleLimit, multipartLimit) {
  if (!length) return 0;
  if (length <= singleLimit) return 1;
  return Math.ceil(length / multipartLimit);
}

function validateMessage(message, orderName, env = process.env) {
  const cleanMessage = String(message || "").trim();
  const maxLength = Number(env.MAX_SMS_LENGTH || MAX_SMS_LENGTH);

  if (!cleanMessage) {
    return { ok: false, code: "MESSAGE_EMPTY", error: "Message cannot be empty." };
  }
  if (!cleanMessage.startsWith(`${STORE_NAME}:`)) {
    return { ok: false, code: "MESSAGE_INVALID", error: `Message must start with "${STORE_NAME}:".` };
  }
  if (orderName && !cleanMessage.includes(`#${cleanOrderNumber(orderName)}`)) {
    return { ok: false, code: "MESSAGE_INVALID", error: "Message must include the order number." };
  }
  if (/\[[A-Z ]+\]/.test(cleanMessage)) {
    return { ok: false, code: "MESSAGE_INVALID", error: "Message still contains unresolved placeholders." };
  }
  if (cleanMessage.length > maxLength) {
    return { ok: false, code: "MESSAGE_TOO_LONG", error: `Message must be ${maxLength} characters or fewer.` };
  }
  return { ok: true, message: cleanMessage, estimate: smsLength(cleanMessage) };
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

function callbackUrl(env = process.env) {
  const base = String(env.TWILIO_STATUS_CALLBACK_BASE_URL || "").replace(/\/$/, "");
  return base ? `${base}/api/twilio-status` : "";
}

function twilioParams({ to, body, recordId }, env = process.env) {
  const params = { to, body };
  if (env.TWILIO_MESSAGING_SERVICE_SID) {
    params.messagingServiceSid = env.TWILIO_MESSAGING_SERVICE_SID;
  } else {
    params.from = env.TWILIO_FROM_NUMBER || env.TWILIO_PHONE_NUMBER;
  }
  const statusCallback = callbackUrl(env);
  if (statusCallback) {
    params.statusCallback = recordId ? `${statusCallback}?recordId=${encodeURIComponent(recordId)}` : statusCallback;
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

async function sendSms({ phone, message, orderName, recordId, env = process.env, twilioClient }) {
  const cleanPhone = String(phone || "").trim();
  const validation = validateMessage(message, orderName, env);
  const dryRun = isDryRun(env);

  if (!isE164(cleanPhone)) {
    return { status: 400, body: { success: false, code: "PHONE_INVALID", error: "Phone number must be valid E.164 format." } };
  }

  if (!validation.ok) {
    return { status: 400, body: { success: false, code: validation.code, error: validation.error } };
  }

  if (dryRun) {
    return {
      status: 200,
      body: {
        success: true,
        dryRun: true,
        message: "Dry run successful. SMS was not actually sent.",
        recipient: redactPhone(cleanPhone),
        providerStatus: "not-sent",
        estimate: validation.estimate
      }
    };
  }

  if (!hasTwilioConfig(env)) {
    return { status: 500, body: { success: false, code: "TWILIO_ERROR", error: "Twilio is not configured." } };
  }

  try {
    const client = twilioClient || makeTwilioClient(env);
    const sms = await client.messages.create(twilioParams({ to: cleanPhone, body: validation.message, recordId }, env));
    return {
      status: 200,
      body: {
        success: true,
        dryRun: false,
        message: "SMS sent successfully.",
        recipient: redactPhone(cleanPhone),
        providerStatus: sms.status || "sent",
        sid: sms.sid,
        estimate: validation.estimate
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        success: false,
        code: "TWILIO_ERROR",
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

function validateTwilioSignature({ url, params, signature, env = process.env }) {
  if (!env.TWILIO_AUTH_TOKEN || !signature || !url) return false;
  return twilio.validateRequest(env.TWILIO_AUTH_TOKEN, signature, url, params);
}

module.exports = {
  MAX_SMS_LENGTH,
  STORE_NAME,
  buildSubstitutionMessage,
  cleanOrderNumber,
  isDryRun,
  isE164,
  isGsm7,
  redactPhone,
  sendSms,
  smsLength,
  twilioParams,
  validateMessage,
  validateTwilioSignature
};
