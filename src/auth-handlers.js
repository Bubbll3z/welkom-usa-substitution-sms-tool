const {
  authenticateUser,
  authBypassEnabled,
  bypassAuthResult,
  changePassword,
  clearSessionCookie,
  createUser,
  disableUser,
  listUsers,
  requireAuth,
  requireRole,
  resetUserPassword,
  revokeSession
} = require("./auth");
const { checkRateLimit } = require("./rate-limit");
const { csrfTokenForSession, securityHeaders, validateCsrf } = require("./security");
const { hasConfig: hasShopifyConfig } = require("./shopify");
const { validateEnum, validateId, validateObject, validateString } = require("./validation");

const MAX_BODY_BYTES = 16 * 1024;

function json(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      ...securityHeaders({ headers: {} }),
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

function parseBody(event) {
  try {
    return event.body ? JSON.parse(event.body) : {};
  } catch (parseError) {
    return null;
  }
}

function requireJson(event) {
  const contentType = event.headers?.["content-type"] || event.headers?.["Content-Type"] || "";
  return contentType.includes("application/json");
}

function bodyTooLarge(event) {
  return Buffer.byteLength(event.body || "", "utf8") > MAX_BODY_BYTES;
}

function method(event, expected) {
  if (event.httpMethod !== expected) return error(405, "INVALID_REQUEST", "Method not allowed.", { Allow: expected });
  return null;
}

function badAuth(result) {
  return error(result.status || 401, result.code || "AUTH_REQUIRED", result.error || "Please log in again.");
}

function badCsrf(result) {
  return error(result.status || 403, result.code || "CSRF_INVALID", result.error || "Unable to process request");
}

function clientIp(event) {
  return String(event.headers?.["x-forwarded-for"] || event.headers?.["X-Forwarded-For"] || event.headers?.["client-ip"] || "local")
    .split(",")[0]
    .trim()
    .slice(0, 80) || "local";
}

function rateLimited(result) {
  return error(429, "RATE_LIMITED", "Too many requests. Please wait and try again.", { "Retry-After": String(result.retryAfter || 60) });
}

function safeClientConfig(env = process.env) {
  return {
    dryRun: String(env.SMS_DRY_RUN ?? env.DRY_RUN ?? "true").toLowerCase() !== "false",
    productionSendingEnabled: String(env.SMS_DRY_RUN ?? env.DRY_RUN ?? "true").toLowerCase() === "false",
    staffCopyConfigured: Boolean(env.STAFF_COPY_PHONE_NUMBER || env.ADMIN_COPY_PHONE_NUMBER),
    shopifyConfigured: hasShopifyConfig(env)
  };
}

async function handleAuthLogin(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  if (authBypassEnabled()) {
    const result = bypassAuthResult();
    return json(200, {
      success: true,
      user: result.user,
      staffName: result.user.displayName,
      role: result.user.role,
      expiresAt: result.session.expiresAt,
      absoluteExpiresAt: result.session.absoluteExpiresAt,
      csrfToken: csrfTokenForSession(result.session),
      authRequired: false,
      bypass: true,
      config: safeClientConfig()
    });
  }
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  if (!validateObject(body, { allowed: ["username", "password", "rememberMe"], required: ["username", "password"] }).ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  if (!validateString(body.username, { min: 2, max: 80, pattern: /^[A-Za-z0-9._@-]+$/ }).ok) return error(400, "INVALID_REQUEST", "Unable to process request");

  const ipLimit = await checkRateLimit({
    key: `login-ip:${clientIp(event)}`,
    limit: 10,
    windowSeconds: 15 * 60,
    blockSeconds: 15 * 60
  });
  if (!ipLimit.ok) return rateLimited(ipLimit);

  const result = await authenticateUser({ username: body.username, password: body.password, event, rememberMe: body.rememberMe === true });
  if (!result.ok) {
    const usernameLimit = await checkRateLimit({
      key: `login-failed-username:${String(body.username || "").trim().toLowerCase()}`,
      limit: 5,
      windowSeconds: 15 * 60,
      blockSeconds: 15 * 60
    });
    if (!usernameLimit.ok) return rateLimited(usernameLimit);
    return badAuth(result);
  }
  return json(200, {
    success: true,
    user: result.user,
    staffName: result.user.displayName,
    role: result.user.role,
    expiresAt: result.session.expiresAt,
    absoluteExpiresAt: result.session.absoluteExpiresAt,
    csrfToken: csrfTokenForSession(result.session),
    authRequired: true,
    config: safeClientConfig()
  }, {
    "Set-Cookie": result.cookie
  });
}

async function handleAuthLogout(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  if (authBypassEnabled()) return json(200, { success: true, bypass: true }, { "Set-Cookie": clearSessionCookie() });
  const auth = await requireAuth(event);
  if (!auth.ok) return badAuth(auth);
  const csrf = validateCsrf({ event, auth });
  if (!csrf.ok) return badCsrf(csrf);
  await revokeSession(event);
  return json(200, { success: true }, { "Set-Cookie": clearSessionCookie() });
}

async function handleAuthMe(event) {
  const wrongMethod = method(event, "GET");
  if (wrongMethod) return wrongMethod;
  const auth = await requireAuth(event);
  if (!auth.ok) return badAuth(auth);
  return json(200, {
    success: true,
    user: auth.user,
    staffName: auth.user.displayName,
    role: auth.user.role,
    expiresAt: auth.session.expiresAt,
    absoluteExpiresAt: auth.session.absoluteExpiresAt,
    csrfToken: csrfTokenForSession(auth.session),
    authRequired: !auth.bypass,
    bypass: Boolean(auth.bypass),
    config: safeClientConfig()
  });
}

async function handleAuthChangePassword(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  if (!validateObject(body, { allowed: ["currentPassword", "newPassword"], required: ["currentPassword", "newPassword"] }).ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  const auth = await requireAuth(event);
  if (!auth.ok) return badAuth(auth);
  const csrf = validateCsrf({ event, auth });
  if (!csrf.ok) return badCsrf(csrf);
  const result = await changePassword({ event, currentPassword: body.currentPassword, newPassword: body.newPassword });
  if (!result.ok) return badAuth(result);
  return json(200, { success: true, user: result.user });
}

async function handleAdminCreateUser(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return badAuth(auth);
  const csrf = validateCsrf({ event, auth });
  if (!csrf.ok) return badCsrf(csrf);
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  if (!validateObject(body, { allowed: ["username", "displayName", "password", "role", "isActive"], required: ["username", "password", "role"] }).ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  const role = validateEnum(body.role || "staff", ["admin", "staff"]);
  if (!role.ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  const result = await createUser({
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    role: role.value,
    isActive: body.isActive !== false
  });
  if (!result.ok) return error(result.status || 400, result.code, result.error);
  return json(200, { success: true, user: result.user });
}

async function handleAdminDisableUser(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return badAuth(auth);
  const csrf = validateCsrf({ event, auth });
  if (!csrf.ok) return badCsrf(csrf);
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  if (!validateObject(body, { allowed: ["userId"], required: ["userId"] }).ok || !validateId(body.userId).ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  const result = await disableUser(body.userId);
  if (!result.ok) return error(result.status || 400, result.code, result.error);
  return json(200, { success: true, user: result.user });
}

async function handleAdminResetUserPassword(event) {
  const wrongMethod = method(event, "POST");
  if (wrongMethod) return wrongMethod;
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return badAuth(auth);
  const csrf = validateCsrf({ event, auth });
  if (!csrf.ok) return badCsrf(csrf);
  if (bodyTooLarge(event)) return error(413, "INVALID_REQUEST", "Request body is too large.");
  if (!requireJson(event)) return error(415, "INVALID_REQUEST", "Content-Type must be application/json.");
  const body = parseBody(event);
  if (!body) return error(400, "INVALID_REQUEST", "Request body must be valid JSON.");
  if (!validateObject(body, { allowed: ["userId", "password"], required: ["userId", "password"] }).ok || !validateId(body.userId).ok) return error(400, "INVALID_REQUEST", "Unable to process request");
  const result = await resetUserPassword({ userId: body.userId, password: body.password });
  if (!result.ok) return error(result.status || 400, result.code, result.error);
  return json(200, { success: true, user: result.user });
}

async function handleAdminListUsers(event) {
  const wrongMethod = method(event, "GET");
  if (wrongMethod) return wrongMethod;
  const auth = await requireRole(event, "admin");
  if (!auth.ok) return badAuth(auth);
  return json(200, { success: true, users: await listUsers() });
}

module.exports = {
  handleAdminCreateUser,
  handleAdminDisableUser,
  handleAdminListUsers,
  handleAdminResetUserPassword,
  handleAuthChangePassword,
  handleAuthLogin,
  handleAuthLogout,
  handleAuthMe,
  json,
  error,
  parseBody,
  requireJson
};
