const crypto = require("node:crypto");

const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data: https://cdn.shopify.com https://cdn.shopifycdn.net https://*.myshopify.com",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'"
  ].join("; ")
};

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function configuredOrigin(env = process.env) {
  return String(env.PUBLIC_APP_URL || env.URL || "").replace(/\/$/, "");
}

function requestOrigin(event) {
  return event.headers?.origin || event.headers?.Origin || "";
}

function requestHostOrigin(event) {
  const host = event.headers?.host || event.headers?.Host || "";
  const proto = event.headers?.["x-forwarded-proto"] || event.headers?.["X-Forwarded-Proto"] || (event.headers?.host?.includes("localhost") ? "http" : "https");
  return host ? `${proto}://${host}` : "";
}

function allowedOrigins(env = process.env) {
  return new Set([
    configuredOrigin(env),
    "http://localhost:3000",
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001"
  ].filter(Boolean));
}

function originAllowed(origin, event, env = process.env) {
  if (!origin) return env.NETLIFY !== "true";
  if (allowedOrigins(env).has(origin)) return true;
  const hostOrigin = requestHostOrigin(event);
  return Boolean(hostOrigin && origin === hostOrigin && env.NETLIFY !== "true");
}

function corsHeaders(event, { credentials = true, methods = "GET, POST, OPTIONS", headers = "Content-Type, X-CSRF-Token" } = {}, env = process.env) {
  const origin = requestOrigin(event);
  if (!origin || !originAllowed(origin, event, env)) return {};
  return {
    "Access-Control-Allow-Origin": origin,
    "Vary": "Origin",
    "Access-Control-Allow-Methods": methods,
    "Access-Control-Allow-Headers": headers,
    ...(credentials ? { "Access-Control-Allow-Credentials": "true" } : {})
  };
}

function securityHeaders(event, env = process.env) {
  const headers = { ...SECURITY_HEADERS };
  if (env.NETLIFY === "true") {
    headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains";
  }
  return { ...headers, ...corsHeaders(event, {}, env) };
}

function csrfSecret(env = process.env) {
  return String(env.CSRF_SECRET || env.SESSION_SECRET || env.SUBSTITUTION_TOKEN_PEPPER || "local-dev-csrf-secret");
}

function csrfTokenForSession(session, env = process.env) {
  if (!session?.sessionIdHash || !session?.userId) return "";
  return crypto.createHmac("sha256", csrfSecret(env)).update(`${session.sessionIdHash}:${session.userId}:${session.role || ""}`).digest("base64url");
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

function csrfHeader(event) {
  return event.headers?.["x-csrf-token"] || event.headers?.["X-CSRF-Token"] || "";
}

function validateOrigin(event, env = process.env) {
  const origin = requestOrigin(event);
  const referer = event.headers?.referer || event.headers?.Referer || "";
  if (origin) return originAllowed(origin, event, env);
  if (referer) {
    try {
      return originAllowed(new URL(referer).origin, event, env);
    } catch (error) {
      return false;
    }
  }
  return env.NETLIFY !== "true";
}

function validateCsrf({ event, auth, env = process.env }) {
  if (!STATE_CHANGING_METHODS.has(event.httpMethod)) return { ok: true };
  if (!validateOrigin(event, env)) return { ok: false, status: 403, code: "ORIGIN_INVALID", error: "Unable to process request" };
  const expected = csrfTokenForSession(auth?.session, env);
  if (!expected || !timingSafeEqualText(csrfHeader(event), expected)) {
    return { ok: false, status: 403, code: "CSRF_INVALID", error: "Unable to process request" };
  }
  return { ok: true };
}

module.exports = {
  SECURITY_HEADERS,
  corsHeaders,
  csrfTokenForSession,
  originAllowed,
  requestOrigin,
  securityHeaders,
  validateCsrf,
  validateOrigin
};
