const SECRET_KEY_PATTERN = /password|token|secret|authorization|cookie|session|apikey|api_key|authkey|auth_key|authtoken|auth_token|accesstoken|access_token|shopify.*token|twilio.*auth|raw.*response.*token/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /(?<![A-Za-z0-9])\+?\d[\d\s().-]{6,}\d(?![A-Za-z0-9])/g;
const MAX_STRING_LENGTH = 500;
const MAX_ARRAY_ITEMS = 20;
const MAX_OBJECT_KEYS = 40;
const MAX_DEPTH = 5;

function maskEmail(value) {
  return String(value || "").replace(EMAIL_PATTERN, (email) => {
    const [local = "", domain = ""] = email.split("@");
    const domainParts = domain.split(".");
    const name = domainParts.shift() || "";
    const suffix = domainParts.join(".");
    const maskedLocal = local.length <= 2 ? `${local[0] || "*"}***` : `${local.slice(0, 2)}***`;
    const maskedDomain = name.length <= 2 ? `${name[0] || "*"}***` : `${name.slice(0, 2)}***`;
    return `${maskedLocal}@${maskedDomain}${suffix ? `.${suffix}` : ""}`;
  });
}

function maskPhone(value) {
  return String(value || "").replace(PHONE_PATTERN, (phone) => {
    const digits = phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 16) return phone;
    const prefix = phone.trim().startsWith("+") ? "+" : "";
    return `${prefix}${digits.slice(0, 2)}${"*".repeat(Math.max(digits.length - 4, 3))}${digits.slice(-2)}`;
  });
}

function redactString(value) {
  return maskPhone(maskEmail(String(value || "").slice(0, MAX_STRING_LENGTH)));
}

function isSecretKey(key) {
  return SECRET_KEY_PATTERN.test(String(key || ""));
}

function redactValue(value, key = "", depth = 0) {
  if (isSecretKey(key)) return "[redacted]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_ARRAY_ITEMS).map((item) => redactValue(item, "", depth + 1));
  if (typeof value === "object") {
    const entries = Object.entries(value).slice(0, MAX_OBJECT_KEYS).map(([childKey, childValue]) => [
      redactString(childKey),
      redactValue(childValue, childKey, depth + 1)
    ]);
    return Object.fromEntries(entries);
  }
  return redactString(value);
}

function redactObject(value) {
  return redactValue(value);
}

function log(level, message, meta = {}) {
  const safeLevel = ["info", "warn", "error"].includes(level) ? level : "info";
  const safeMessage = redactString(message || "Application event");
  const safeMeta = redactObject(meta);
  const target = safeLevel === "error" ? console.error : safeLevel === "warn" ? console.warn : console.log;
  target(JSON.stringify({
    level: safeLevel,
    message: safeMessage,
    meta: safeMeta,
    timestamp: new Date().toISOString()
  }));
}

module.exports = {
  isSecretKey,
  log,
  logger: {
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta)
  },
  maskEmail,
  maskPhone,
  redactObject,
  redactString,
  redactValue
};
