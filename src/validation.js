const DANGEROUS_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype",
  "passwordHash",
  "passwordSalt",
  "sessionId",
  "sessionIdHash",
  "tokenHash",
  "roleOverride",
  "isAdmin",
  "authorization",
  "cookie",
  "env",
  "process"
]);

function hasDangerousShape(value, depth = 0) {
  if (depth > 4) return true;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((item) => hasDangerousShape(item, depth + 1));
  return Object.entries(value).some(([key, item]) => DANGEROUS_KEYS.has(key) || hasDangerousShape(item, depth + 1));
}

function validateObject(value, { allowed = [], required = [] } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  }
  if (hasDangerousShape(value)) return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (allowed.length && !allowedSet.has(key)) return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  }
  for (const key of required) {
    if (value[key] === undefined || value[key] === null || value[key] === "") {
      return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
    }
  }
  return { ok: true };
}

function cleanString(value, max = 240) {
  return String(value || "").trim().replace(/\s+/g, " ").replace(/<\/?[a-z][\s\S]*>/gi, "").slice(0, max);
}

function validateString(value, { min = 0, max = 240, pattern = null } = {}) {
  const clean = cleanString(value, max);
  if (clean.length < min) return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  if (pattern && !pattern.test(clean)) return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  return { ok: true, value: clean };
}

function validateEnum(value, allowed) {
  const clean = String(value || "").trim();
  if (!allowed.includes(clean)) return { ok: false, code: "INVALID_REQUEST", error: "Unable to process request" };
  return { ok: true, value: clean };
}

function validateGid(value, kind = "") {
  const escapedKind = kind ? kind.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "[A-Za-z]+";
  return validateString(value, {
    min: 8,
    max: 120,
    pattern: new RegExp(`^gid://shopify/${escapedKind}/[A-Za-z0-9_-]+$`)
  });
}

function validateId(value) {
  return validateString(value, { min: 3, max: 120, pattern: /^[A-Za-z0-9_-]+$/ });
}

function normalizePhone(value) {
  return String(value || "").trim().replace(/[\s().-]/g, "");
}

function validateE164(value) {
  const phone = normalizePhone(value);
  if (!/^\+[1-9]\d{7,14}$/.test(phone)) return { ok: false, code: "PHONE_INVALID", error: "Unable to process request" };
  return { ok: true, value: phone };
}

module.exports = {
  cleanString,
  hasDangerousShape,
  normalizePhone,
  validateE164,
  validateEnum,
  validateGid,
  validateId,
  validateObject,
  validateString
};
