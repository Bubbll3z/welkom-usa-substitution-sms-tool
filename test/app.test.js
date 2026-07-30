const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const twilio = require("twilio");

process.env.NODE_ENV = "test";
process.env.STAFF_NAME = "Test Staff";
process.env.DRY_RUN = "true";
process.env.SMS_DRY_RUN = "true";
process.env.MESSAGE_STORAGE_PROVIDER = "memory";

const { handler } = require("../netlify/functions/api");
const { handler: authLoginHandler } = require("../netlify/functions/auth-login");
const { handler: authLogoutHandler } = require("../netlify/functions/auth-logout");
const { handler: authMeHandler } = require("../netlify/functions/auth-me");
const { handler: adminCreateUserHandler } = require("../netlify/functions/admin-create-user");
const { handler: adminListUsersHandler } = require("../netlify/functions/admin-list-users");
const { handler: adminDisableUserHandler } = require("../netlify/functions/admin-disable-user");
const {
  clearAuthMemory,
  createSession,
  createUser,
  getUserByUsername,
  hashSessionId,
  resetAuthStoreFactory,
  saveUser,
  verifySession
} = require("../src/auth");
const { clearMemoryHistory, getMessageRecord, saveRecord } = require("../src/history");
const { resetStoreFactory, setStoreFactory } = require("../src/data-store");
const { checkRateLimit, cleanupRateLimitRecords, clearRateLimitMemory } = require("../src/rate-limit");
const { csrfTokenForSession } = require("../src/security");
const { buildSubstitutionMessage, sendSms, smsLength, validateMessage } = require("../src/sms");
const { consentFromAttributes, findOrder, getAccessToken, normalizeOrderQuery, searchProductsForSubstitutions } = require("../src/shopify");

const csrfByCookie = new Map();

function event(path, body, headers = {}, method = "POST") {
  const [pathOnly, rawQuery = ""] = path.split("?");
  const nextHeaders = {
    host: "localhost:3001",
    "x-forwarded-proto": "http",
    "content-type": "application/json",
    ...headers
  };
  const cookie = nextHeaders.cookie || nextHeaders.Cookie;
  const hasCsrfHeader = Object.prototype.hasOwnProperty.call(nextHeaders, "x-csrf-token") || Object.prototype.hasOwnProperty.call(nextHeaders, "X-CSRF-Token");
  if (cookie && !hasCsrfHeader && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const token = csrfByCookie.get(cookie);
    if (token) nextHeaders["x-csrf-token"] = token;
  }
  return {
    httpMethod: method,
    path: pathOnly,
    rawQuery,
    headers: nextHeaders,
    body: body === undefined ? "" : JSON.stringify(body)
  };
}

function formEvent(path, body, signature) {
  const [pathOnly, rawQuery = ""] = path.split("?");
  return {
    httpMethod: "POST",
    path: pathOnly,
    rawQuery,
    headers: {
      host: "example.netlify.app",
      "x-forwarded-proto": "https",
      "content-type": "application/x-www-form-urlencoded",
      "x-twilio-signature": signature
    },
    body: new URLSearchParams(body).toString()
  };
}

async function loginCookie(password = "test12345", username = "admin") {
  const response = await handler(event("/api/login", { username, password }));
  assert.equal(response.statusCode, 200);
  const cookie = response.headers["Set-Cookie"].split(";")[0];
  csrfByCookie.set(cookie, JSON.parse(response.body).csrfToken);
  return cookie;
}

function rawEvent(path, body, headers = {}, method = "POST") {
  const [pathOnly, rawQuery = ""] = path.split("?");
  return {
    httpMethod: method,
    path: pathOnly,
    rawQuery,
    headers: {
      host: "localhost:3001",
      "x-forwarded-proto": "http",
      "content-type": "application/json",
      ...headers
    },
    body
  };
}

function shopifyEnv() {
  return {
    SHOPIFY_SHOP_DOMAIN: "welkom-usa.myshopify.com",
    SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_test",
    SHOPIFY_API_VERSION: "2025-10"
  };
}

function orderNode(overrides = {}) {
  return {
    id: "gid://shopify/Order/1",
    name: "#1023",
    phone: "",
    processedAt: "2026-07-21T00:00:00Z",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "PARTIALLY_FULFILLED",
    cancelledAt: null,
    customAttributes: [{ key: "SMS consent", value: "Yes" }],
    totalPriceSet: { shopMoney: { amount: "47.98", currencyCode: "USD" } },
    customer: {
      firstName: "Sarah",
      lastName: "Johnson",
      email: "sarah@example.com",
      phone: "+15551234567"
    },
    shippingAddress: {
      name: "Sarah Johnson",
      address1: "123 Main St",
      address2: "",
      city: "Orlando",
      province: "FL",
      country: "USA",
      zip: "32801",
      phone: ""
    },
    billingAddress: { phone: "" },
    lineItems: {
      nodes: [
        {
          id: "gid://shopify/LineItem/1",
          title: "Cadbury Crunchie Chocolate Bar 44g",
          variantTitle: "",
          quantity: 1,
          sku: "CRUNCHIE44",
          image: { url: "https://example.com/crunchie.jpg" },
          variant: {
            id: "gid://shopify/ProductVariant/old",
            title: "Default Title",
            sku: "CRUNCHIE44",
            barcode: "600111",
            availableForSale: true,
            inventoryQuantity: 5,
            image: { url: "" },
            product: {
              id: "gid://shopify/Product/old",
              title: "Cadbury Crunchie Chocolate Bar 44g",
              status: "ACTIVE",
              featuredImage: { url: "https://example.com/crunchie.jpg" }
            }
          },
          originalUnitPriceSet: { shopMoney: { amount: "0.99", currencyCode: "USD" } }
        }
      ]
    },
    ...overrides
  };
}

function variantNode(overrides = {}) {
  return {
    id: "gid://shopify/ProductVariant/new",
    title: "Default Title",
    displayName: "Cadbury Flake Chocolate Bar 32g",
    sku: "FLAKE32",
    barcode: "600222",
    price: { amount: "0.99", currencyCode: "USD" },
    availableForSale: true,
    inventoryQuantity: 12,
    image: { url: "https://example.com/flake.jpg" },
    product: {
      id: "gid://shopify/Product/new",
      title: "Cadbury Flake Chocolate Bar 32g",
      status: "ACTIVE",
      featuredImage: { url: "https://example.com/flake.jpg" }
    },
    ...overrides
  };
}

function mockFetch({ order = orderNode(), variant = variantNode(), missingOrder = false } = {}) {
  return async (url, options) => {
    assert.match(url, /welkom-usa\.myshopify\.com/);
    assert.equal(options.headers["X-Shopify-Access-Token"], "shpat_test");
    const body = JSON.parse(options.body);
    if (body.query.includes("SearchOrder")) {
      return { ok: true, json: async () => ({ data: { orders: { nodes: missingOrder ? [] : [order] } } }) };
    }
    if (body.query.includes("GetOrder")) {
      return { ok: true, json: async () => ({ data: { order: missingOrder ? null : order } }) };
    }
    if (body.query.includes("GetVariant")) {
      return { ok: true, json: async () => ({ data: { productVariant: variant } }) };
    }
    if (body.query.includes("SubstitutionVariants")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productVariants: {
              nodes: [
                variant,
                variantNode({ id: "gid://shopify/ProductVariant/draft", product: { ...variant.product, status: "DRAFT" } }),
                variantNode({ id: "gid://shopify/ProductVariant/unavailable", availableForSale: false })
              ]
            }
          }
        })
      };
    }
    throw new Error("Unexpected Shopify query");
  };
}

test.beforeEach(async () => {
  clearMemoryHistory();
  clearAuthMemory();
  clearRateLimitMemory();
  csrfByCookie.clear();
  process.env.SHOPIFY_SHOP_DOMAIN = "welkom-usa.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2025-10";
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  delete process.env.BLOB_INIT_ENABLED;
  delete process.env.REQUIRE_LOGIN;
  resetStoreFactory();
  resetAuthStoreFactory();
  await createUser({ username: "admin", displayName: "Admin User", password: "test12345", role: "admin" });
  await createUser({ username: "staff", displayName: "Staff User", password: "staffpass123", role: "staff" });
});

test("authentication supports login, session, logout, wrong password, and expired session", async () => {
  const wrong = await handler(event("/api/login", { username: "admin", password: "wrong" }));
  assert.equal(wrong.statusCode, 401);
  assert.equal(JSON.parse(wrong.body).error, "Invalid username or password.");

  const cookie = await loginCookie();
  const token = cookie.split("=")[1];
  assert.equal((await verifySession(decodeURIComponent(token))).ok, true);
  assert.equal((await verifySession(decodeURIComponent(token), process.env, Date.now() + 90 * 60 * 1000)).code, "AUTH_REQUIRED");

  const session = await handler(event("/api/session", undefined, { cookie }, "GET"));
  assert.equal(session.statusCode, 200);
  assert.equal(JSON.parse(session.body).role, "admin");

  const logout = await handler(event("/api/logout", {}, { cookie }));
  assert.equal(logout.statusCode, 200);
  const afterLogout = await handler(event("/api/session", undefined, { cookie }, "GET"));
  assert.equal(afterLogout.statusCode, 401);
});

test("remember me login extends only the absolute session limit", async () => {
  process.env.REMEMBER_ME_DAYS = "2";
  const response = await authLoginHandler(event("/.netlify/functions/auth-login", {
    username: "admin",
    password: "test12345",
    rememberMe: true
  }, { "x-forwarded-proto": "https" }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.ok(new Date(body.absoluteExpiresAt).getTime() - new Date(body.expiresAt).getTime() > 8 * 60 * 60 * 1000);
  assert.doesNotMatch(response.body, /test12345|passwordHash|passwordSalt/);
  delete process.env.REMEMBER_ME_DAYS;
});

test("unauthenticated API request is rejected", async () => {
  const response = await handler(event("/api/order-search", { query: "#1023" }));
  assert.equal(response.statusCode, 401);
});

test("temporary no-login mode no longer bypasses server authentication", async () => {
  process.env.REQUIRE_LOGIN = "false";

  const session = await handler(event("/api/session", undefined, {}, "GET"));
  assert.equal(session.statusCode, 401);

  const dashboard = await handler(event("/api/dashboard", undefined, {}, "GET"));
  assert.equal(dashboard.statusCode, 401);
});

test("temporary bootstrap login creates first admin user without exposing password", async () => {
  clearAuthMemory();
  process.env.ADMIN_BOOTSTRAP_ENABLED = "true";
  process.env.ADMIN_BOOTSTRAP_USERNAME = "manager";
  process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME = "Manager";
  process.env.ADMIN_BOOTSTRAP_PASSWORD = "bootstrap-pass-123";

  const response = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "manager", password: "bootstrap-pass-123" }, { "x-forwarded-proto": "https" }));
  assert.equal(response.statusCode, 200);
  assert.match(response.headers["Set-Cookie"], /HttpOnly/);
  assert.doesNotMatch(response.body, /bootstrap-pass-123|passwordHash|passwordSalt/);

  const body = JSON.parse(response.body);
  assert.equal(body.user.username, "manager");
  assert.equal(body.user.displayName, "Manager");
  assert.equal(body.user.role, "admin");

  const saved = await getUserByUsername("manager");
  assert.equal(saved.role, "admin");
  assert.ok(saved.passwordHash);
  assert.notEqual(saved.passwordHash, "bootstrap-pass-123");

  delete process.env.ADMIN_BOOTSTRAP_ENABLED;
  delete process.env.ADMIN_BOOTSTRAP_USERNAME;
  delete process.env.ADMIN_BOOTSTRAP_DISPLAY_NAME;
  delete process.env.ADMIN_BOOTSTRAP_PASSWORD;
});

test("auth functions protect passwords, disabled users, lockout, roles and cookie flags", async () => {
  const unknown = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "missing", password: "whatever123" }));
  assert.equal(unknown.statusCode, 401);
  assert.equal(JSON.parse(unknown.body).error, "Invalid username or password.");

  const adminLogin = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "test12345" }, { "x-forwarded-proto": "https" }));
  assert.equal(adminLogin.statusCode, 200);
  assert.match(adminLogin.headers["Set-Cookie"], /HttpOnly/);
  assert.match(adminLogin.headers["Set-Cookie"], /SameSite=Lax/);
  assert.match(adminLogin.headers["Set-Cookie"], /Secure/);
  assert.doesNotMatch(adminLogin.body, /passwordHash|passwordSalt|test12345/);
  const adminCookie = adminLogin.headers["Set-Cookie"].split(";")[0];
  csrfByCookie.set(adminCookie, JSON.parse(adminLogin.body).csrfToken);

  const staffCookie = await loginCookie("staffpass123", "staff");
  const rejected = await adminListUsersHandler(event("/.netlify/functions/admin-list-users", undefined, { cookie: staffCookie }, "GET"));
  assert.equal(rejected.statusCode, 403);

  const listed = await adminListUsersHandler(event("/.netlify/functions/admin-list-users", undefined, { cookie: adminCookie }, "GET"));
  assert.equal(listed.statusCode, 200);
  assert.doesNotMatch(listed.body, /passwordHash|passwordSalt|test12345|staffpass123/);

  const created = await adminCreateUserHandler(event("/.netlify/functions/admin-create-user", {
    username: "new.staff",
    displayName: "New Staff",
    password: "newpass123",
    role: "staff"
  }, { cookie: adminCookie }));
  assert.equal(created.statusCode, 200);
  assert.equal(JSON.parse(created.body).user.role, "staff");

  const staffUser = await getUserByUsername("staff");
  await saveUser({ ...staffUser, isActive: false });
  const disabled = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "staff", password: "staffpass123" }));
  assert.equal(disabled.statusCode, 401);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "badpass123" }));
    assert.equal(response.statusCode, 401);
  }
  const lockedUser = await getUserByUsername("admin");
  assert.ok(lockedUser.lockedUntil);
  const locked = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "test12345" }));
  assert.equal(locked.statusCode, 429);
  assert.ok(locked.headers["Retry-After"]);
});

test("sessions store only hashes and enforce idle and absolute expiry", async () => {
  const userResult = await createUser({ username: "timeout", displayName: "Timeout User", password: "timeout123", role: "staff" });
  const base = Date.now();
  const session = await createSession({ user: userResult.rawUser, event: event("/fake", {}, { "x-forwarded-proto": "https" }), now: base });
  const cookie = session.cookie.split(";")[0];
  const rawSessionId = cookie.split("=")[1];
  assert.notEqual(session.session.sessionIdHash, rawSessionId);
  assert.equal(session.session.sessionIdHash, hashSessionId(decodeURIComponent(rawSessionId)));

  const active = await authMeHandler(event("/.netlify/functions/auth-me", undefined, { cookie }, "GET"));
  assert.equal(active.statusCode, 200);

  const idleExpired = await verifySession(decodeURIComponent(rawSessionId), process.env, base + 31 * 60 * 1000);
  assert.equal(idleExpired.code, "AUTH_REQUIRED");

  const absoluteSession = await createSession({ user: userResult.rawUser, event: event("/fake", {}, { "x-forwarded-proto": "https" }), now: base });
  const absoluteCookie = absoluteSession.cookie.split(";")[0];
  csrfByCookie.set(absoluteCookie, csrfTokenForSession(absoluteSession.session));
  const absoluteToken = decodeURIComponent(absoluteCookie.split("=")[1]);
  const absoluteExpired = await verifySession(absoluteToken, process.env, base + 8 * 60 * 60 * 1000 + 1);
  assert.equal(absoluteExpired.code, "AUTH_REQUIRED");

  const logout = await authLogoutHandler(event("/.netlify/functions/auth-logout", {}, { cookie: absoluteCookie }));
  assert.equal(logout.statusCode, 200);
  const afterLogout = await authMeHandler(event("/.netlify/functions/auth-me", undefined, { cookie: absoluteCookie }, "GET"));
  assert.equal(afterLogout.statusCode, 401);
});

test("endpoint registry denies unknown routes, wrong methods, oversized bodies and dangerous fields", async () => {
  const cookie = await loginCookie();
  const unknown = await handler(event("/api/not-real", undefined, { cookie }, "GET"));
  assert.equal(unknown.statusCode, 404);
  assert.equal(JSON.parse(unknown.body).error, "Unable to process request");

  const wrongMethod = await handler(event("/api/order-search", undefined, { cookie }, "GET"));
  assert.equal(wrongMethod.statusCode, 405);
  assert.equal(wrongMethod.headers.Allow, "POST");

  const oversized = await handler(rawEvent("/api/order-search", JSON.stringify({ query: "#1023", pad: "x".repeat(17000) }), { cookie }));
  assert.equal(oversized.statusCode, 413);

  const dangerous = await handler(event("/api/order-search", { query: "#1023", role: "admin" }, { cookie }));
  assert.equal(dangerous.statusCode, 400);
  assert.equal(JSON.parse(dangerous.body).error, "Unable to process request");

  const nestedDanger = await adminCreateUserHandler(event("/.netlify/functions/admin-create-user", {
    username: "evil",
    password: "password123",
    role: "staff",
    profile: { passwordHash: "inject" }
  }, { cookie }));
  assert.equal(nestedDanger.statusCode, 400);
});

test("security headers, CSP and frame protection are present", async () => {
  const response = await handler(event("/api/session", undefined, {}, "GET"));
  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(response.headers["Referrer-Policy"], "no-referrer");
  assert.match(response.headers["Permissions-Policy"], /camera=\(\)/);
  assert.match(response.headers["Permissions-Policy"], /microphone=\(\)/);
  assert.match(response.headers["Permissions-Policy"], /geolocation=\(\)/);
  assert.match(response.headers["Permissions-Policy"], /payment=\(\)/);
  assert.equal(response.headers["X-Frame-Options"], "DENY");
  assert.match(response.headers["Content-Security-Policy"], /default-src 'self'/);
  assert.match(response.headers["Content-Security-Policy"], /script-src 'self'(;|$)/);
  assert.match(response.headers["Content-Security-Policy"], /style-src 'self'(;|$)/);
  assert.match(response.headers["Content-Security-Policy"], /frame-ancestors 'none'/);
  assert.match(response.headers["Content-Security-Policy"], /object-src 'none'/);
  assert.doesNotMatch(response.headers["Content-Security-Policy"], /unsafe-inline|unsafe-eval|script-src \*|style-src \*|connect-src \*|sha256-/);

  const config = fs.readFileSync(path.join(__dirname, "../netlify.toml"), "utf8");
  assert.match(config, /Content-Security-Policy/);
  assert.match(config, /frame-ancestors 'none'/);
  assert.match(config, /Referrer-Policy = "no-referrer"/);
  assert.doesNotMatch(config, /unsafe-inline|unsafe-eval|script-src \*|style-src \*|connect-src \*|sha256-/);
});

test("CSRF and Origin protection reject unsafe staff requests and allow valid tokens", async () => {
  const cookie = await loginCookie();
  const missing = await handler(event("/api/order-search", { query: "#1023" }, { cookie, "x-csrf-token": "" }));
  assert.equal(missing.statusCode, 403);
  assert.equal(JSON.parse(missing.body).error, "Unable to process request");

  const invalidToken = await handler(event("/api/order-search", { query: "#1023" }, { cookie, "x-csrf-token": "bad" }));
  assert.equal(invalidToken.statusCode, 403);

  const invalidOrigin = await handler(event("/api/order-search", { query: "#1023" }, { cookie, origin: "https://evil.example", "x-csrf-token": csrfByCookie.get(cookie) }));
  assert.equal(invalidOrigin.statusCode, 403);

  global.fetch = mockFetch();
  try {
    const valid = await handler(event("/api/order-search", { query: "#1023" }, { cookie, origin: "http://localhost:3001" }));
    assert.equal(valid.statusCode, 200);
  } finally {
    global.fetch = undefined;
  }
});

test("CORS never uses wildcard on protected APIs", async () => {
  const cookie = await loginCookie();
  const allowed = await handler(event("/api/message-history", undefined, { cookie, origin: "http://localhost:3001" }, "GET"));
  assert.equal(allowed.statusCode, 200);
  assert.equal(allowed.headers["Access-Control-Allow-Origin"], "http://localhost:3001");
  assert.notEqual(allowed.headers["Access-Control-Allow-Origin"], "*");

  const denied = await handler(event("/api/message-history", undefined, { cookie, origin: "https://evil.example" }, "GET"));
  assert.notEqual(denied.headers["Access-Control-Allow-Origin"], "*");
  assert.equal(denied.headers["Access-Control-Allow-Origin"], undefined);
});

test("invalid sessions, staff/admin boundaries and modified resource IDs are denied safely", async () => {
  const invalid = await handler(event("/api/message-history", undefined, { cookie: "welkom_sms_session=bad" }, "GET"));
  assert.equal(invalid.statusCode, 401);
  assert.equal(JSON.parse(invalid.body).error, "Unable to process request");

  const staffCookie = await loginCookie("staffpass123", "staff");
  const staffAdmin = await adminDisableUserHandler(event("/.netlify/functions/admin-disable-user", { userId: "anything" }, { cookie: staffCookie }));
  assert.equal(staffAdmin.statusCode, 403);

  const adminCookie = await loginCookie();
  const tamperedMessage = await handler(event("/api/message-history/../../secret", undefined, { cookie: adminCookie }, "GET"));
  assert.equal(tamperedMessage.statusCode, 404);
  assert.doesNotMatch(tamperedMessage.body, /Blob|by-id|by-username|C:\\|\.js|stack/i);

  const tamperedRequest = await handler(event("/api/substitution-requests/bad id", undefined, { cookie: adminCookie }, "GET"));
  assert.equal(tamperedRequest.statusCode, 404);
  assert.equal(JSON.parse(tamperedRequest.body).error, "Unable to process request");
});

test("unexpected browser roles are ignored by admin user creation", async () => {
  const adminCookie = await loginCookie();
  const created = await adminCreateUserHandler(event("/.netlify/functions/admin-create-user", {
    username: "rolecheck",
    displayName: "Role Check",
    password: "rolecheck123",
    role: "staff",
    isAdmin: true
  }, { cookie: adminCookie }));
  assert.equal(created.statusCode, 400);

  const allowed = await adminCreateUserHandler(event("/.netlify/functions/admin-create-user", {
    username: "rolecheck2",
    displayName: "Role Check",
    password: "rolecheck123",
    role: "staff"
  }, { cookie: adminCookie }));
  assert.equal(allowed.statusCode, 200);
  assert.equal(JSON.parse(allowed.body).user.role, "staff");
});

test("login and IP throttling return Retry-After without revealing keys", async () => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "badpass123" }, { "x-forwarded-for": "203.0.113.10" }));
    assert.equal(response.statusCode, 401);
  }
  const usernameLimited = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "badpass123" }, { "x-forwarded-for": "203.0.113.10" }));
  assert.equal(usernameLimited.statusCode, 429);
  assert.ok(usernameLimited.headers["Retry-After"]);
  assert.doesNotMatch(usernameLimited.body, /login-failed-username|203\.0\.113\.10|admin/i);

  clearRateLimitMemory();
  clearAuthMemory();
  await createUser({ username: "admin", displayName: "Admin User", password: "test12345", role: "admin" });
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const response = await authLoginHandler(event("/.netlify/functions/auth-login", { username: `missing${attempt}`, password: "badpass123" }, { "x-forwarded-for": "203.0.113.20" }));
    assert.equal(response.statusCode, 401);
  }
  const ipLimited = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "anothermissing", password: "badpass123" }, { "x-forwarded-for": "203.0.113.20" }));
  assert.equal(ipLimited.statusCode, 429);
  assert.ok(ipLimited.headers["Retry-After"]);
});

test("rate limit records reset after expiry and cleanup removes old records", async () => {
  const first = await checkRateLimit({ key: "unit-expiry", limit: 1, windowSeconds: 10, blockSeconds: 10, now: 1000, cleanup: false });
  assert.equal(first.ok, true);
  const blocked = await checkRateLimit({ key: "unit-expiry", limit: 1, windowSeconds: 10, blockSeconds: 10, now: 2000, cleanup: false });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfter > 0);
  const reset = await checkRateLimit({ key: "unit-expiry", limit: 1, windowSeconds: 10, blockSeconds: 10, now: 12000, cleanup: false });
  assert.equal(reset.ok, true);

  await checkRateLimit({ key: "unit-cleanup", limit: 1, windowSeconds: 1, blockSeconds: 1, now: 1000, cleanup: false });
  const cleanup = await cleanupRateLimitRecords({ olderThan: 100000, max: 10 });
  assert.ok(cleanup.removed >= 1);
});

test("builds and validates the approved substitution message", () => {
  const message = buildSubstitutionMessage({
    firstName: "Sarah",
    unavailableItem: "Cadbury Crunchie Chocolate Bar 44g",
    substituteItem: "Cadbury Flake Chocolate Bar 32g",
    orderName: "#1023"
  });
  assert.equal(
    message,
    "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out."
  );
  assert.equal(validateMessage(message, "#1023").ok, true);
  assert.equal(validateMessage("Welkom USA: Hi [FIRST NAME]", "#1023").code, "MESSAGE_INVALID");
});

test("calculates GSM-7 and Unicode SMS segments", () => {
  assert.deepEqual(smsLength("a".repeat(160)), { encoding: "GSM-7", length: 160, segments: 1 });
  assert.equal(smsLength("a".repeat(161)).segments, 2);
  assert.deepEqual(smsLength("😀".repeat(70)), { encoding: "UCS-2", length: 70, segments: 1 });
  assert.equal(smsLength("😀".repeat(71)).segments, 2);
});

test("dry-run SMS does not call Twilio and validates phone", async () => {
  const invalid = await sendSms({ phone: "555", message: "Welkom USA: Hi Sarah, order #1023 test" });
  assert.equal(invalid.body.code, "PHONE_INVALID");

  const result = await sendSms({
    phone: "+15555550123",
    orderName: "#1023",
    message: "Welkom USA: Hi Sarah, Test Item in order #1023 is unavailable. We can substitute it with Test Substitute. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    twilioClient: {
      messages: {
        create: async () => {
          throw new Error("Twilio should not be called in dry-run");
        }
      }
    }
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.dryRun, true);
});

test("Shopify consent mapping and exact order search", async () => {
  assert.equal(consentFromAttributes([{ key: "sms CONSENT", value: "yes" }]).granted, true);
  assert.equal(consentFromAttributes([{ key: "SMS consent", value: "No" }]).granted, false);
  assert.equal(consentFromAttributes([], { marketingState: "SUBSCRIBED" }).granted, true);
  assert.equal(consentFromAttributes([], { marketingState: "NOT_SUBSCRIBED" }).granted, false);
  assert.equal(normalizeOrderQuery("#1023"), "1023");

  const exact = await findOrder("#1023", { env: shopifyEnv(), fetchImpl: mockFetch() });
  assert.equal(exact.status, 200);
  assert.equal(exact.body.order.name, "#1023");
  assert.equal(exact.body.order.smsConsent.granted, true);
  assert.equal(exact.body.order.customer.redactedPhone, "+15*******67");
  assert.equal(exact.body.order.customer.phone, "");
  assert.equal(exact.body.order.customer.email, "");
  assert.match(exact.body.order.customer.maskedEmail, /^sa\*+@example\.com$/);
  assert.equal(exact.body.order.shippingAddress.address1, "");
  assert.equal(exact.body.order.shippingAddressDisplay, "Hidden for customer privacy");
  assert.doesNotMatch(JSON.stringify(exact.body.order), /15551234567|sarah@example\.com|123 Main St|Orlando|32801/);
  assert.equal(exact.body.order.totalPrice, "USD 47.98");

  const partial = await findOrder("#1023", { env: shopifyEnv(), fetchImpl: mockFetch({ order: orderNode({ name: "#10230" }) }) });
  assert.equal(partial.status, 404);
});

test("Shopify client credentials grant retrieves an expiring Admin API token only when explicitly enabled", async () => {
  const calls = [];
  const token = await getAccessToken({
    env: {
      SHOPIFY_SHOP_DOMAIN: "welkom-usa.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id",
      SHOPIFY_CLIENT_SECRET: "client-secret",
      SHOPIFY_CLIENT_CREDENTIALS_ENABLED: "true",
      SHOPIFY_API_VERSION: "2025-10"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, "https://welkom-usa.myshopify.com/admin/oauth/access_token");
      assert.equal(options.method, "POST");
      assert.match(options.body, /grant_type=client_credentials/);
      assert.match(options.body, /client_id=client-id/);
      assert.match(options.body, /client_secret=client-secret/);
      return {
        ok: true,
        json: async () => ({ access_token: "shpat_generated", expires_in: 86399, scope: "read_orders,read_products" })
      };
    }
  });
  assert.equal(token, "shpat_generated");
  assert.equal(calls.length, 1);
});

test("product search filters inactive and unavailable variants", async () => {
  const products = await searchProductsForSubstitutions("FLAKE32", { env: shopifyEnv(), fetchImpl: mockFetch(), excludeVariantId: "gid://shopify/ProductVariant/old" });
  assert.equal(products.length, 1);
  assert.equal(products[0].sku, "FLAKE32");
  assert.equal(products[0].inventoryQuantity, 12);
});

test("API order search and selected-line-item substitutions require session", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    const orderResponse = await handler(event("/api/order-search", { query: "1023" }, { cookie }));
    assert.equal(orderResponse.statusCode, 200);
    const lineResponse = await handler(event("/api/line-item-substitutions", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1"
    }, { cookie }));
    assert.equal(lineResponse.statusCode, 200);
    assert.equal(JSON.parse(lineResponse.body).products.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("manual product search reports missing Shopify configuration", async () => {
  const cookie = await loginCookie();
  delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  const response = await handler(event("/api/product-search", { query: "flake" }, { cookie }));
  const body = JSON.parse(response.body);
  assert.equal(response.statusCode, 500);
  assert.equal(body.code, "SHOPIFY_ERROR");
});

test("manual product search can exclude the selected order variant", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch({ variant: variantNode({ id: "gid://shopify/ProductVariant/old" }) });
  try {
    const response = await handler(event("/api/product-search", {
      query: "Crunchie",
      excludeVariantId: "gid://shopify/ProductVariant/old"
    }, { cookie }));
    assert.equal(response.statusCode, 200);
    assert.equal(JSON.parse(response.body).products.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("send revalidates order consent, line item, substitute inventory, duplicate and idempotency", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  const payload = {
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    substituteVariantId: "gid://shopify/ProductVariant/new",
    message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    sendConfirmed: true,
    idempotencyKey: "idem-1"
  };
  try {
    const first = await handler(event("/api/send-substitution-sms", payload, { cookie }));
    assert.equal(first.statusCode, 200);
    assert.equal(JSON.parse(first.body).dryRun, true);

    const repeat = await handler(event("/api/send-substitution-sms", payload, { cookie }));
    assert.equal(repeat.statusCode, 200);
    assert.equal(JSON.parse(repeat.body).idempotent, true);

    const duplicate = await handler(event("/api/send-substitution-sms", { ...payload, message: payload.message + " Thanks.", idempotencyKey: "idem-2" }, { cookie }));
    assert.equal(duplicate.statusCode, 409);
    assert.equal(JSON.parse(duplicate.body).code, "DUPLICATE_MESSAGE");
  } finally {
    global.fetch = originalFetch;
  }
});

test("send supports a validated custom substitute title when Shopify search has no match", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    const response = await handler(event("/api/send-substitution-sms", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      customSubstituteTitle: "Iwisa Maize Meal 2.5kg",
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Iwisa Maize Meal 2.5kg. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "custom-substitute"
    }, { cookie }));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, true);
    assert.equal(body.record.customSubstitute, true);
    assert.equal(body.record.substituteVariantId, "");
    assert.equal(body.record.substituteTitle, "Iwisa Maize Meal 2.5kg");
  } finally {
    global.fetch = originalFetch;
  }
});

test("guided replacement SMS supports multiple order items with server-side validation", async () => {
  const cookie = await loginCookie("staffpass123", "staff");
  const twoItemOrder = orderNode({
    lineItems: {
      nodes: [
        orderNode().lineItems.nodes[0],
        {
          ...orderNode().lineItems.nodes[0],
          id: "gid://shopify/LineItem/2",
          title: "Mrs Balls Chutney 470g",
          quantity: 2,
          variant: {
            ...orderNode().lineItems.nodes[0].variant,
            id: "gid://shopify/ProductVariant/old2",
            sku: "CHUTNEY470",
            barcode: "600333"
          }
        }
      ]
    }
  });
  const originalFetch = global.fetch;
  global.fetch = mockFetch({ order: twoItemOrder });
  try {
    const response = await handler(event("/api/send-replacement-sms", {
      orderId: "gid://shopify/Order/1",
      replacements: [
        {
          lineItemId: "gid://shopify/LineItem/1",
          substituteVariantId: "gid://shopify/ProductVariant/new"
        },
        {
          lineItemId: "gid://shopify/LineItem/2",
          customSubstituteTitle: "Mrs Balls Peach Chutney 470g"
        }
      ],
      message: "Welkom USA: Hi Sarah, these items in order #1023 need attention: 1. Cadbury Crunchie Chocolate Bar 44g - substitute: Cadbury Flake Chocolate Bar 32g; 2. Mrs Balls Chutney 470g - substitute: Mrs Balls Peach Chutney 470g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "multi-replacement-1"
    }, { cookie }));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, true);
    assert.equal(body.record.unavailableTitle, "2 unavailable items");
    assert.match(body.record.substituteTitle, /Mrs Balls Peach Chutney/);
    assert.doesNotMatch(JSON.stringify(body.record), /15551234567|sarah@example\.com|123 Main St/);
  } finally {
    global.fetch = originalFetch;
  }
});

test("manual SMS requires consent confirmation, redacts phone, and stays in dry-run", async () => {
  const cookie = await loginCookie();
  const payload = {
    phone: "+15551234567",
    firstName: "Walk In",
    unavailableItem: "Requested biscuits",
    substituteItem: "Replacement biscuits",
    reference: "physical-shop",
    consentConfirmed: true,
    sendConfirmed: true,
    message: "Welkom USA: Hi Walk In, Requested biscuits in order #physical-shop is unavailable. We can substitute it with Replacement biscuits. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    idempotencyKey: "manual-dry-run"
  };

  const blocked = await handler(event("/api/send-manual-sms", { ...payload, consentConfirmed: false }, { cookie }));
  assert.equal(blocked.statusCode, 400);
  assert.equal(JSON.parse(blocked.body).code, "CONSENT_CONFIRMATION_REQUIRED");

  const invalidPhone = await handler(event("/api/send-manual-sms", { ...payload, phone: "5551234567" }, { cookie }));
  assert.equal(invalidPhone.statusCode, 400);
  assert.equal(JSON.parse(invalidPhone.body).code, "PHONE_INVALID");

  const response = await handler(event("/api/send-manual-sms", payload, { cookie }));
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.equal(body.dryRun, true);
  assert.equal(body.record.orderName, "Manual physical-shop");
  assert.equal(body.record.customerPhoneRedacted, "+15*******67");
  assert.doesNotMatch(response.body, /15551234567/);

  const repeat = await handler(event("/api/send-manual-sms", payload, { cookie }));
  assert.equal(repeat.statusCode, 200);
  assert.equal(JSON.parse(repeat.body).idempotent, true);
});

test("Shopify API access is explicit and rejects proxy-style requests", async () => {
  const blockedGraphql = await handler(event("/api/shopify/graphql", { query: "{ shop { name } }" }, {}, "POST"));
  assert.equal(blockedGraphql.statusCode, 404);

  const cookie = await loginCookie();
  const arbitraryGraphql = await handler(event("/api/order-search", { query: "#1023", graphql: "{ customers { nodes { id } } }" }, { cookie }));
  assert.equal(arbitraryGraphql.statusCode, 400);

  const arbitraryRest = await handler(event("/api/product-search", { path: "/admin/api/2025-10/orders.json", query: "flake" }, { cookie }));
  assert.equal(arbitraryRest.statusCode, 400);

  const directRest = await handler(event("/api/shopify/rest/admin/api/2025-10/orders.json", {}, { cookie }));
  assert.equal(directRest.statusCode, 404);
});

test("staff SMS actions are throttled per staff user", async () => {
  const cookie = await loginCookie();
  for (let index = 0; index < 10; index += 1) {
    const response = await handler(event("/api/send-manual-sms", {
      phone: `+15551234${String(index).padStart(2, "0")}`,
      message: `Welkom USA: Manual rate limit dry-run message ${index}. Reply STOP to opt out.`,
      consentConfirmed: true,
      sendConfirmed: true,
      idempotencyKey: `manual-rate-${index}`
    }, { cookie }));
    assert.equal(response.statusCode, 200);
  }
  const limited = await handler(event("/api/send-manual-sms", {
    phone: "+1555123499",
    message: "Welkom USA: Manual rate limit dry-run message final. Reply STOP to opt out.",
    consentConfirmed: true,
    sendConfirmed: true,
    idempotencyKey: "manual-rate-final"
  }, { cookie }));
  assert.equal(limited.statusCode, 429);
  assert.ok(limited.headers["Retry-After"]);
});

test("substitution SMS sends are throttled per order", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    for (let index = 0; index < 3; index += 1) {
      const response = await handler(event("/api/send-substitution-sms", {
        orderId: "gid://shopify/Order/1",
        lineItemId: "gid://shopify/LineItem/1",
        customSubstituteTitle: "Cadbury Flake Chocolate Bar 32g",
        message: `Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out. ${index}`,
        sendConfirmed: true,
        authorizedResend: true,
        idempotencyKey: `order-rate-${index}`
      }, { cookie }));
      assert.equal(response.statusCode, 200);
    }
    const limited = await handler(event("/api/send-substitution-sms", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      customSubstituteTitle: "Cadbury Flake Chocolate Bar 32g",
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out. final",
      sendConfirmed: true,
      authorizedResend: true,
      idempotencyKey: "order-rate-final"
    }, { cookie }));
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["Retry-After"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("send blocks missing consent, cancelled order, invalid line item, and unavailable substitute", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  const payload = {
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    substituteVariantId: "gid://shopify/ProductVariant/new",
    sendConfirmed: true,
    message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out."
  };

  global.fetch = mockFetch({ order: orderNode({ customAttributes: [{ key: "SMS consent", value: "No" }] }) });
  const noConsent = await handler(event("/api/send-substitution-sms", payload, { cookie }));
  assert.equal(JSON.parse(noConsent.body).code, "SMS_CONSENT_MISSING");

  global.fetch = mockFetch({ order: orderNode({ cancelledAt: "2026-07-20T00:00:00Z" }) });
  const cancelled = await handler(event("/api/send-substitution-sms", payload, { cookie }));
  assert.equal(JSON.parse(cancelled.body).code, "ORDER_CANCELLED");

  global.fetch = mockFetch();
  const badLine = await handler(event("/api/send-substitution-sms", { ...payload, lineItemId: "gid://shopify/LineItem/999" }, { cookie }));
  assert.equal(JSON.parse(badLine.body).code, "LINE_ITEM_INVALID");

  global.fetch = mockFetch({ variant: variantNode({ availableForSale: false }) });
  const unavailable = await handler(event("/api/send-substitution-sms", payload, { cookie }));
  assert.equal(JSON.parse(unavailable.body).code, "SUBSTITUTE_UNAVAILABLE");
  global.fetch = originalFetch;
});

test("history endpoint lists stored message records without secrets", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    await handler(event("/api/send-substitution-sms", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      substituteVariantId: "gid://shopify/ProductVariant/new",
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "history"
    }, { cookie }));
    const history = await handler(event("/api/message-history", undefined, { cookie }, "GET"));
    assert.equal(history.statusCode, 200);
    assert.doesNotMatch(history.body, /shpat_test|15551234567/);
    assert.equal(JSON.parse(history.body).records.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("secure substitution request API creates link, redacts public data, and accepts one customer response", async () => {
  const blocked = await handler(event("/api/substitution-requests", {
    orderId: "gid://shopify/Order/1",
    items: []
  }));
  assert.equal(blocked.statusCode, 401);

  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    const created = await handler(event("/api/substitution-requests", {
      orderId: "gid://shopify/Order/1",
      expiryHours: 48,
      staffNote: "Please choose the option you prefer.",
      items: [{
        lineItemId: "gid://shopify/LineItem/1",
        quantity: 1,
        substituteVariantIds: ["gid://shopify/ProductVariant/new"]
      }],
      sendConfirmed: true,
      idempotencyKey: "secure-request-api"
    }, { cookie }));
    assert.equal(created.statusCode, 200);
    const createdBody = JSON.parse(created.body);
    assert.equal(createdBody.success, true);
    assert.match(createdBody.publicUrl, /\/respond\//);
    assert.doesNotMatch(created.body, /15551234567|shpat_test|tokenHash|gid:\/\/shopify\/Order/);

    const token = createdBody.publicUrl.split("/respond/")[1];
    const publicRead = await handler(event(`/api/public/substitution-request?token=${encodeURIComponent(token)}`, undefined, {}, "GET"));
    assert.equal(publicRead.statusCode, 200);
    const publicBody = JSON.parse(publicRead.body);
    assert.equal(publicBody.success, true);
    assert.equal(publicBody.request.items.length, 1);
    assert.doesNotMatch(publicRead.body, /15551234567|sarah@example|Main St|shpat_test|tokenHash|gid:\/\/shopify|customerPhone|customerFirstName|staffNote|createdBy/);

    const item = publicBody.request.items[0];
    const guessed = await handler(event("/api/public/substitution-request?token=abcdefghijklmnopqrstuvwxyz1234567890ABCDEFZ", undefined, {}, "GET"));
    assert.equal(guessed.statusCode, 404);
    assert.equal(JSON.parse(guessed.body).error, "This request is not available.");

    const invalid = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: item.requestItemId, type: "substitute", optionId: "unapproved" }]
    }));
    assert.equal(invalid.statusCode, 400);
    assert.equal(JSON.parse(invalid.body).code, "INVALID_RESPONSE");

    const priceTamper = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: item.requestItemId, type: "substitute", optionId: item.substituteOptions[0].optionId, price: "USD 0.01" }]
    }));
    assert.equal(priceTamper.statusCode, 400);

    const orderTamper = await handler(event("/api/public/substitution-response", {
      token,
      orderId: "gid://shopify/Order/evil",
      choices: [{ requestItemId: item.requestItemId, type: "substitute", optionId: item.substituteOptions[0].optionId }]
    }));
    assert.equal(orderTamper.statusCode, 400);

    const submitted = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: item.requestItemId, type: "substitute", optionId: item.substituteOptions[0].optionId }]
    }));
    assert.equal(submitted.statusCode, 200);
    assert.equal(JSON.parse(submitted.body).request.status, "customer_responded");

    const repeat = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: item.requestItemId, type: "refund" }]
    }));
    assert.equal(repeat.statusCode, 200);
    assert.equal(JSON.parse(repeat.body).alreadySubmitted, true);
    assert.equal(JSON.parse(repeat.body).request.submittedChoices[0].type, "substitute");

    const list = await handler(event("/api/substitution-requests", undefined, { cookie }, "GET"));
    assert.equal(list.statusCode, 200);
    assert.equal(JSON.parse(list.body).requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("customer submission attempts are throttled by IP and token", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    const created = await handler(event("/api/substitution-requests", {
      orderId: "gid://shopify/Order/1",
      expiryHours: 48,
      items: [{
        lineItemId: "gid://shopify/LineItem/1",
        quantity: 1,
        substituteVariantIds: ["gid://shopify/ProductVariant/new"]
      }],
      sendConfirmed: true,
      idempotencyKey: "customer-submit-rate"
    }, { cookie }));
    assert.equal(created.statusCode, 200);
    const token = JSON.parse(created.body).publicUrl.split("/respond/")[1];

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await handler(event("/api/public/substitution-response", {
        token,
        choices: [{ requestItemId: "bad-item", type: "refund" }]
      }, { "x-forwarded-for": "198.51.100.77" }));
      assert.equal(response.statusCode, 400);
    }
    const limited = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: "bad-item", type: "refund" }]
    }, { "x-forwarded-for": "198.51.100.77" }));
    assert.equal(limited.statusCode, 429);
    assert.ok(limited.headers["Retry-After"]);
    assert.doesNotMatch(limited.body, new RegExp(token));
  } finally {
    global.fetch = originalFetch;
  }
});

test("public customer response page markup is present", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  assert.match(html, /id="main"/);
  assert.match(app, /Choose what you would prefer/);
  assert.match(app, /Submit choice/);
  assert.match(app, /choice-card/);
});

test("frontend build does not expose Shopify Admin secrets or direct Admin API calls", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  const app = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "../public/styles.css"), "utf8");
  assert.match(html, /<link rel="stylesheet" href="\/styles\.css">/);
  assert.match(html, /<script src="\/app\.js" defer><\/script>/);
  assert.doesNotMatch(html, /<style[\s>]|<script(?!\s+src=)|\sstyle=/i);
  assert.doesNotMatch(`${html}\n${app}\n${css}`, /shpat_|SHOPIFY_ADMIN_ACCESS_TOKEN|SHOPIFY_CLIENT_SECRET|X-Shopify-Access-Token|\/admin\/api\/|graphql\.json|VITE_.*SHOPIFY/i);
});

test("config diagnostics reports safe check names without secret values", async () => {
  const blocked = await handler(event("/api/config-diagnostics", undefined, {}, "GET"));
  assert.equal(blocked.statusCode, 401);
  const cookie = await loginCookie();
  const response = await handler(event("/api/config-diagnostics", undefined, { cookie }, "GET"));
  assert.equal(response.statusCode, 200);
  assert.doesNotMatch(response.body, /shpat_test|test123|12345678901234567890123456789012/);
  const body = JSON.parse(response.body);
  assert.equal(body.success, true);
  assert.ok(body.diagnostics.checks.some((check) => check.name === "MESSAGE_STORAGE_PROVIDER"));
});

test("dashboard, backup and filtered history endpoints are protected and do not expose secrets", async () => {
  const blocked = await handler(event("/api/dashboard", undefined, {}, "GET"));
  assert.equal(blocked.statusCode, 401);

  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    await handler(event("/api/send-substitution-sms", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      substituteVariantId: "gid://shopify/ProductVariant/new",
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "dashboard-history"
    }, { cookie }));

    const dashboard = await handler(event("/api/dashboard", undefined, { cookie }, "GET"));
    assert.equal(dashboard.statusCode, 200);
    assert.doesNotMatch(dashboard.body, /shpat_test|test123|12345678901234567890123456789012|15551234567/);
    const dashboardBody = JSON.parse(dashboard.body);
    assert.equal(dashboardBody.success, true);
    assert.equal(dashboardBody.status.shopifyConfigured, true);
    assert.equal(dashboardBody.status.cloudflareRequired, false);
    assert.equal(dashboardBody.stats.total, 1);

    const filtered = await handler(event("/api/message-history?search=1023&dryRun=true&limit=10", undefined, { cookie }, "GET"));
    assert.equal(filtered.statusCode, 200);
    assert.equal(JSON.parse(filtered.body).records.length, 1);

    const jsonBackup = await handler(event("/api/backup.json", undefined, { cookie }, "GET"));
    assert.equal(jsonBackup.statusCode, 200);
    assert.doesNotMatch(jsonBackup.body, /shpat_test|test123|12345678901234567890123456789012|15551234567/);
    assert.equal(JSON.parse(jsonBackup.body).messageHistory.length, 1);

    const csvBackup = await handler(event("/api/backup/messages.csv", undefined, { cookie }, "GET"));
    assert.equal(csvBackup.statusCode, 200);
    assert.match(csvBackup.body, /orderName/);
    assert.doesNotMatch(csvBackup.body, /15551234567/);

    const staffCookie = await loginCookie("staffpass123", "staff");
    const staffBackup = await handler(event("/api/backup.json", undefined, { cookie: staffCookie }, "GET"));
    assert.equal(staffBackup.statusCode, 403);

    const cleanup = await handler(event("/api/admin/cleanup", {}, { cookie }, "POST"));
    assert.equal(cleanup.statusCode, 200);
    assert.equal(JSON.parse(cleanup.body).success, true);
  } finally {
    global.fetch = originalFetch;
  }
});

test("dashboard still loads when message history storage is unavailable", async () => {
  const cookie = await loginCookie();
  process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";
  setStoreFactory(() => ({
    async list() {
      throw new Error("storage unavailable");
    },
    async get() {
      throw new Error("storage unavailable");
    },
    async setJSON() {
      throw new Error("storage unavailable");
    }
  }));
  try {
    const dashboard = await handler(event("/api/dashboard", undefined, { cookie }, "GET"));
    assert.equal(dashboard.statusCode, 200);
    const body = JSON.parse(dashboard.body);
    assert.equal(body.success, true);
    assert.equal(body.stats.total, 0);
    assert.equal(body.status.storageHealthy, false);
    assert.match(body.warning, /storage/i);
  } finally {
    process.env.MESSAGE_STORAGE_PROVIDER = "memory";
    resetStoreFactory();
  }
});

test("message history still loads empty when storage is unavailable", async () => {
  const cookie = await loginCookie();
  process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";
  setStoreFactory(() => ({
    async list() {
      throw new Error("storage unavailable");
    },
    async get() {
      throw new Error("storage unavailable");
    },
    async setJSON() {
      throw new Error("storage unavailable");
    }
  }));
  try {
    const history = await handler(event("/api/message-history?limit=10", undefined, { cookie }, "GET"));
    assert.equal(history.statusCode, 200);
    const body = JSON.parse(history.body);
    assert.equal(body.success, true);
    assert.equal(body.records.length, 0);
    assert.equal(body.storageHealthy, false);
    assert.match(body.warning, /history storage/i);
  } finally {
    process.env.MESSAGE_STORAGE_PROVIDER = "memory";
    resetStoreFactory();
  }
});

test("template endpoint validates approved wording and supports archive", async () => {
  const cookie = await loginCookie();

  const initial = await handler(event("/api/templates", undefined, { cookie }, "GET"));
  assert.equal(initial.statusCode, 200);
  assert.equal(JSON.parse(initial.body).templates.length, 1);

  const invalid = await handler(event("/api/templates", {
    name: "Bad",
    body: "Hi [FIRST NAME], your item is unavailable."
  }, { cookie }));
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).code, "TEMPLATE_INVALID");

  const validBody = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";
  const saved = await handler(event("/api/templates", {
    name: "Substitution approval",
    body: validBody
  }, { cookie }));
  assert.equal(saved.statusCode, 200);
  const template = JSON.parse(saved.body).template;
  assert.equal(template.name, "Substitution approval");

  const archived = await handler(event(`/api/templates/${encodeURIComponent(template.id)}/archive`, {}, { cookie }));
  assert.equal(archived.statusCode, 200);

  const remaining = await handler(event("/api/templates", undefined, { cookie }, "GET"));
  assert.equal(JSON.parse(remaining.body).templates.some((item) => item.id === template.id), false);
});

test("template endpoint falls back safely when template storage is unavailable", async () => {
  const cookie = await loginCookie();
  process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";
  setStoreFactory(() => ({
    async list() {
      throw new Error("template storage unavailable");
    },
    async get() {
      throw new Error("template storage unavailable");
    },
    async setJSON() {
      throw new Error("template storage unavailable");
    }
  }));
  try {
    const response = await handler(event("/api/templates", undefined, { cookie }, "GET"));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.success, true);
    assert.equal(body.storageHealthy, false);
    assert.equal(body.templates.length, 1);
    assert.match(body.warning, /default template/i);
  } finally {
    process.env.MESSAGE_STORAGE_PROVIDER = "memory";
    resetStoreFactory();
  }
});

test("template save returns safe storage errors without leaking secret-like details", async () => {
  const cookie = await loginCookie();
  process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";
  setStoreFactory(() => ({
    async list() {
      return { blobs: [] };
    },
    async get() {
      return null;
    },
    async setJSON() {
      throw new Error("TWILIO_AUTH_TOKEN secret failed");
    }
  }));
  try {
    const response = await handler(event("/api/templates", {
      name: "Default substitution",
      body: "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out."
    }, { cookie }));
    assert.equal(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.equal(body.code, "STORAGE_ERROR");
    assert.match(body.error, /protected configuration value/i);
    assert.doesNotMatch(response.body, /TWILIO_AUTH_TOKEN|secret failed/);
  } finally {
    process.env.MESSAGE_STORAGE_PROVIDER = "memory";
    resetStoreFactory();
  }
});

test("blob initialization endpoint requires staff authentication and is idempotent", async () => {
  const cookie = await loginCookie();
  const disabled = await handler(event("/api/admin/init-blobs", {}, { cookie }, "POST"));
  assert.equal(disabled.statusCode, 403);
  assert.equal(JSON.parse(disabled.body).code, "BLOB_INIT_DISABLED");

  process.env.BLOB_INIT_ENABLED = "true";
  const blocked = await handler(event("/api/admin/init-blobs", {}, {}, "POST"));
  assert.equal(blocked.statusCode, 401);

  const first = await handler(event("/api/admin/init-blobs", {}, { cookie }, "POST"));
  assert.equal(first.statusCode, 200);
  const firstBody = JSON.parse(first.body);
  assert.equal(firstBody.success, true);
  assert.equal(firstBody.stores["welkom-sms-history"], "initialized");
  assert.equal(firstBody.stores["welkom-sms-templates"], "initialized");
  assert.equal(firstBody.stores["welkom-sms-audit"], "initialized");
  assert.equal(firstBody.stores["welkom-sms-settings"], "initialized");

  const second = await handler(event("/api/admin/init-blobs", {}, { cookie }, "POST"));
  assert.equal(second.statusCode, 200);
  assert.equal(JSON.parse(second.body).success, true);
});

test("blob initialization failures return safe structured diagnostics", async () => {
  const cookie = await loginCookie();
  process.env.BLOB_INIT_ENABLED = "true";
  process.env.MESSAGE_STORAGE_PROVIDER = "netlify-blobs";
  setStoreFactory((name) => ({
    async list() {
      return { blobs: [] };
    },
    async get() {
      return null;
    },
    async setJSON(key) {
      if (name === "welkom-sms-settings" && key.startsWith("settings/")) {
        const error = new Error("protected token value should not be shown");
        error.code = "SIMULATED_STORAGE_ERROR";
        throw error;
      }
    }
  }));
  try {
    const response = await handler(event("/api/admin/init-blobs", {}, { cookie }, "POST"));
    assert.equal(response.statusCode, 500);
    const body = JSON.parse(response.body);
    assert.equal(body.code, "STORAGE_ERROR");
    assert.equal(body.diagnostic.stage, "settings-first-write");
    assert.equal(body.diagnostic.storeName, "welkom-sms-settings");
    assert.equal(body.diagnostic.recordType, "settings");
    assert.equal(body.diagnostic.errorCode, "SIMULATED_STORAGE_ERROR");
    assert.doesNotMatch(response.body, /protected token value should not be shown/);
  } finally {
    process.env.MESSAGE_STORAGE_PROVIDER = "memory";
    resetStoreFactory();
  }
});

test("Twilio status callback validates signatures", async () => {
  process.env.TWILIO_AUTH_TOKEN = "secret";
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  const send = await handler(event("/api/send-substitution-sms", {
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    substituteVariantId: "gid://shopify/ProductVariant/new",
    message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
    sendConfirmed: true,
    idempotencyKey: "callback"
  }, { cookie }));
  global.fetch = originalFetch;
  const sentRecord = JSON.parse(send.body).record;
  const recordId = sentRecord.id;
  await saveRecord({ ...sentRecord, twilioMessageSid: "SM123456789" });
  const url = `https://example.netlify.app/api/twilio-status?recordId=${encodeURIComponent(recordId)}`;
  const params = { MessageSid: "SM123456789", MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  const bad = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, "bad"));
  assert.equal(bad.statusCode, 403);
  const missing = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, ""));
  assert.equal(missing.statusCode, 403);
  const good = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, signature));
  assert.equal(good.statusCode, 200);
  assert.equal((await getMessageRecord(recordId)).latestTwilioStatus, "delivered");
  const duplicate = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, signature));
  assert.equal(duplicate.statusCode, 200);
  assert.equal(JSON.parse(duplicate.body).duplicate, true);

  const invalidStatusParams = { MessageSid: "SM999", MessageStatus: "made_up" };
  const invalidStatusSignature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, invalidStatusParams);
  const invalidStatus = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, invalidStatusParams, invalidStatusSignature));
  assert.equal(invalidStatus.statusCode, 400);
});

test("Twilio inbound STOP and HELP are signature-validated and safe", async () => {
  process.env.TWILIO_AUTH_TOKEN = "secret";
  const stopParams = { MessageSid: "SMSTOP123", From: "+15551234567", To: "+15550000000", Body: "STOP" };
  const stopUrl = "https://example.netlify.app/api/twilio-inbound";
  const stopSignature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, stopUrl, stopParams);
  const invalid = await handler(formEvent("/api/twilio-inbound", stopParams, "bad"));
  assert.equal(invalid.statusCode, 403);

  const stop = await handler(formEvent("/api/twilio-inbound", stopParams, stopSignature));
  assert.equal(stop.statusCode, 200);
  assert.match(stop.body, /opted out/i);
  assert.doesNotMatch(stop.body, /15551234567|secret/);

  const duplicate = await handler(formEvent("/api/twilio-inbound", stopParams, stopSignature));
  assert.equal(duplicate.statusCode, 200);

  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  global.fetch = mockFetch();
  try {
    const blocked = await handler(event("/api/send-substitution-sms", {
      orderId: "gid://shopify/Order/1",
      lineItemId: "gid://shopify/LineItem/1",
      substituteVariantId: "gid://shopify/ProductVariant/new",
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "optout-block"
    }, { cookie }));
    assert.equal(blocked.statusCode, 400);
    assert.equal(JSON.parse(blocked.body).code, "RECIPIENT_OPTED_OUT");
  } finally {
    global.fetch = originalFetch;
  }

  clearMemoryHistory();
  const helpParams = { MessageSid: "SMHELP123", From: "+15557654321", To: "+15550000000", Body: "HELP" };
  const helpSignature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, stopUrl, helpParams);
  const help = await handler(formEvent("/api/twilio-inbound", helpParams, helpSignature));
  assert.equal(help.statusCode, 200);
  assert.match(help.body, /support/i);
  assert.match(help.body, /STOP/i);
});

test("Twilio inbound ordinary replies are stored for staff review", async () => {
  process.env.TWILIO_AUTH_TOKEN = "secret";
  const params = { MessageSid: "SMREPLY123", From: "+15551234567", To: "+15550000000", Body: "SUBSTITUTE please" };
  const url = "https://example.netlify.app/api/twilio-inbound";
  const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  const inbound = await handler(formEvent("/api/twilio-inbound", params, signature));
  assert.equal(inbound.statusCode, 200);

  const cookie = await loginCookie("staffpass123", "staff");
  const list = await handler(event("/api/replies", undefined, { cookie }, "GET"));
  assert.equal(list.statusCode, 200);
  const body = JSON.parse(list.body);
  assert.equal(body.replies.length, 1);
  assert.equal(body.replies[0].messageSid, "SMREPLY123");
  assert.equal(body.replies[0].fromRedacted, "+15*******67");
  assert.equal(body.replies[0].preview, "SUBSTITUTE please");
  assert.equal(body.replies[0].body, "");
  assert.doesNotMatch(JSON.stringify(body.replies[0]), /15551234567|secret/);

  const detail = await handler(event(`/api/replies/${body.replies[0].id}`, undefined, { cookie }, "GET"));
  assert.equal(detail.statusCode, 200);
  assert.equal(JSON.parse(detail.body).reply.body, "SUBSTITUTE please");

  const reviewed = await handler(event(`/api/replies/${body.replies[0].id}/review`, {}, { cookie }));
  assert.equal(reviewed.statusCode, 200);
  assert.equal(JSON.parse(reviewed.body).reply.reviewed, true);
});

test("manual arbitrary destination SMS is staff allowed but requires consent and confirmation", async () => {
  const staffCookie = await loginCookie("staffpass123", "staff");
  const staff = await handler(event("/api/send-manual-sms", {
    phone: "+15551234567",
    consentConfirmed: true,
    sendConfirmed: true,
    message: "Welkom USA: Manual staff permission test. Reply STOP to opt out."
  }, { cookie: staffCookie }));
  assert.equal(staff.statusCode, 200);

  const adminCookie = await loginCookie();
  const unconfirmed = await handler(event("/api/send-manual-sms", {
    phone: "+15551234567",
    consentConfirmed: true,
    message: "Welkom USA: Manual confirmation test. Reply STOP to opt out."
  }, { cookie: adminCookie }));
  assert.equal(unconfirmed.statusCode, 400);
  assert.equal(JSON.parse(unconfirmed.body).code, "INVALID_REQUEST");
});

test("Shopify webhook validates HMAC and deduplicates delivery IDs", async () => {
  process.env.SHOPIFY_WEBHOOK_SECRET = "shopify-webhook-secret";
  const body = JSON.stringify({ id: 1, topic: "orders/updated" });
  const signature = require("node:crypto").createHmac("sha256", process.env.SHOPIFY_WEBHOOK_SECRET).update(body, "utf8").digest("base64");
  const valid = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": signature,
    "x-shopify-shop-domain": "welkom-usa.myshopify.com",
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": "webhook-delivery-1"
  }));
  assert.equal(valid.statusCode, 200);

  const duplicate = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": signature,
    "x-shopify-shop-domain": "welkom-usa.myshopify.com",
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": "webhook-delivery-1"
  }));
  assert.equal(duplicate.statusCode, 200);
  assert.equal(JSON.parse(duplicate.body).duplicate, true);

  const invalid = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": "bad",
    "x-shopify-shop-domain": "welkom-usa.myshopify.com",
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": "webhook-delivery-2"
  }));
  assert.equal(invalid.statusCode, 403);
  assert.doesNotMatch(invalid.body, /shopify-webhook-secret/);

  const wrongShop = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": signature,
    "x-shopify-shop-domain": "evil.myshopify.com",
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": "webhook-delivery-3"
  }));
  assert.equal(wrongShop.statusCode, 403);

  const badTopic = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": signature,
    "x-shopify-shop-domain": "welkom-usa.myshopify.com",
    "x-shopify-topic": "customers/create",
    "x-shopify-webhook-id": "webhook-delivery-4"
  }));
  assert.equal(badTopic.statusCode, 400);

  const wrongMethod = await handler(rawEvent("/api/shopify-webhook", body, {
    "content-type": "application/json",
    "x-shopify-hmac-sha256": signature,
    "x-shopify-shop-domain": "welkom-usa.myshopify.com",
    "x-shopify-topic": "orders/updated",
    "x-shopify-webhook-id": "webhook-delivery-5"
  }, "GET"));
  assert.equal(wrongMethod.statusCode, 405);
  delete process.env.SHOPIFY_WEBHOOK_SECRET;
});
