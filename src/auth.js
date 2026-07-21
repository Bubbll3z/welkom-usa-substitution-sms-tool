const crypto = require("node:crypto");

const attempts = new Map();

function sessionDurationMs(env = process.env) {
  return Number(env.SESSION_DURATION_MINUTES || 480) * 60 * 1000;
}

function getSessionSecret(env = process.env) {
  return env.SESSION_SECRET || "";
}

function timingSafeEqualString(left, right) {
  const leftBuffer = Buffer.from(String(left || ""));
  const rightBuffer = Buffer.from(String(right || ""));
  if (leftBuffer.length !== rightBuffer.length) {
    crypto.timingSafeEqual(leftBuffer, leftBuffer);
    return false;
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function passwordConfigured(env = process.env) {
  return Boolean(env.STAFF_PASSWORD && !String(env.STAFF_PASSWORD).startsWith("change-"));
}

function sessionConfigured(env = process.env) {
  const secret = getSessionSecret(env);
  return secret.length >= 32;
}

function checkStaffPassword(password, env = process.env) {
  if (!passwordConfigured(env)) {
    return { ok: false, status: 500, code: "AUTH_REQUIRED", error: "Staff password is not configured." };
  }
  if (!timingSafeEqualString(password, env.STAFF_PASSWORD)) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Incorrect staff password." };
  }
  return { ok: true };
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function sign(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function createSession({ staffName = "Welkom USA Staff", env = process.env } = {}) {
  if (!sessionConfigured(env)) {
    return { ok: false, status: 500, code: "AUTH_REQUIRED", error: "SESSION_SECRET must be at least 32 characters." };
  }
  const now = Date.now();
  const payload = {
    staffName,
    iat: now,
    exp: now + sessionDurationMs(env),
    nonce: crypto.randomBytes(16).toString("hex")
  };
  const encoded = b64url(JSON.stringify(payload));
  return { ok: true, token: `${encoded}.${sign(encoded, getSessionSecret(env))}`, payload };
}

function parseCookies(header) {
  return String(header || "")
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((cookies, part) => {
      const index = part.indexOf("=");
      if (index > -1) cookies[part.slice(0, index)] = decodeURIComponent(part.slice(index + 1));
      return cookies;
    }, {});
}

function verifySession(token, env = process.env, now = Date.now()) {
  if (!token || !sessionConfigured(env)) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  }
  const [payload, signature] = String(token).split(".");
  if (!payload || !signature) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  }
  const expected = sign(payload, getSessionSecret(env));
  if (!timingSafeEqualString(signature, expected)) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  }
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Please log in again." };
  }
  if (!parsed.exp || parsed.exp < now) {
    return { ok: false, status: 401, code: "AUTH_REQUIRED", error: "Session expired. Please log in again." };
  }
  return { ok: true, staffName: parsed.staffName || "Welkom USA Staff", payload: parsed };
}

function getSessionFromEvent(event, env = process.env) {
  const cookies = parseCookies(event.headers?.cookie || event.headers?.Cookie || "");
  return verifySession(cookies.welkom_sms_session, env);
}

function cookieForSession(token, event, env = process.env) {
  const proto = event.headers?.["x-forwarded-proto"] || event.headers?.["X-Forwarded-Proto"] || "";
  const secure = proto === "https" || env.NETLIFY === "true";
  const maxAge = Math.floor(sessionDurationMs(env) / 1000);
  return [
    `welkom_sms_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : ""
  ].filter(Boolean).join("; ");
}

function clearSessionCookie() {
  return "welkom_sms_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

function rateLimitLogin(event, env = process.env) {
  const ip = event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"] || "local";
  const windowMs = Number(env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
  const maxAttempts = Number(env.LOGIN_RATE_LIMIT_MAX || 8);
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, resetAt: now + windowMs };
  if (entry.resetAt < now) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  attempts.set(ip, entry);
  if (entry.count > maxAttempts) {
    return { ok: false, status: 429, code: "AUTH_REQUIRED", error: "Too many login attempts. Please wait and try again." };
  }
  return { ok: true };
}

function resetLoginAttempts(event) {
  const ip = event.headers?.["x-forwarded-for"] || event.headers?.["client-ip"] || "local";
  attempts.delete(ip);
}

module.exports = {
  checkStaffPassword,
  clearSessionCookie,
  cookieForSession,
  createSession,
  getSessionFromEvent,
  parseCookies,
  rateLimitLogin,
  resetLoginAttempts,
  verifySession
};
