const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.NODE_ENV = "test";
process.env.MESSAGE_STORAGE_PROVIDER = "memory";
process.env.SMS_DRY_RUN = "true";
process.env.DRY_RUN = "true";
process.env.SHOPIFY_SHOP_DOMAIN = "welkom-usa.myshopify.com";
process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
process.env.SHOPIFY_API_VERSION = "2025-10";

const { handler: apiHandler } = require("../netlify/functions/api");
const { handler: adminCreateUserHandler } = require("../netlify/functions/admin-create-user");
const { handler: adminDisableUserHandler } = require("../netlify/functions/admin-disable-user");
const { handler: adminListUsersHandler } = require("../netlify/functions/admin-list-users");
const { handler: authLoginHandler } = require("../netlify/functions/auth-login");
const { handler: authLogoutHandler } = require("../netlify/functions/auth-logout");
const { handler: authMeHandler } = require("../netlify/functions/auth-me");
const {
  clearAuthMemory,
  createUser,
  disableUser,
  getUserByUsername,
  verifySession
} = require("../src/auth");
const { clearMemoryHistory } = require("../src/history");
const { clearRateLimitMemory } = require("../src/rate-limit");

const csrfByCookie = new Map();
const results = [];
const validTemplateBody = "Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.";

const originalConsoleError = console.error;
console.error = (...args) => {
  if (String(args[0] || "").includes("Netlify Blobs connection failed")) return;
  originalConsoleError(...args);
};

function pass(name) {
  results.push({ name, ok: true });
}

function fail(name, error) {
  results.push({ name, ok: false, error });
}

async function check(name, fn) {
  try {
    await fn();
    pass(name);
  } catch (error) {
    fail(name, error);
  }
}

function event(pathname, body, headers = {}, method = "POST") {
  const [pathOnly, rawQuery = ""] = pathname.split("?");
  const nextHeaders = {
    host: "localhost:3001",
    "x-forwarded-proto": "http",
    "content-type": "application/json",
    ...headers
  };
  const cookie = nextHeaders.cookie || nextHeaders.Cookie;
  if (cookie && !Object.prototype.hasOwnProperty.call(nextHeaders, "x-csrf-token") && ["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    const csrf = csrfByCookie.get(cookie);
    if (csrf) nextHeaders["x-csrf-token"] = csrf;
  }
  return {
    httpMethod: method,
    path: pathOnly,
    rawQuery,
    headers: nextHeaders,
    body: body === undefined ? "" : JSON.stringify(body)
  };
}

function staticHtmlFor(route) {
  const indexHtml = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(indexHtml, /id="main"/);
  assert.match(indexHtml, /src="\/app\.js" defer/);
  assert.match(indexHtml, /href="\/styles\.css"/);
  assert.ok(["/", "/login", "/menu", "/substitution/order", "/admin/dashboard", "/unknown"].includes(route) || route.startsWith("/respond/"));
  return indexHtml;
}

function assertJsonResponse(response) {
  assert.match(response.headers?.["Content-Type"] || "", /application\/json/);
  assert.doesNotMatch(response.body || "", /<!DOCTYPE html>/i);
}

async function login(username = "admin", password = "test12345", rememberMe = false) {
  const response = await authLoginHandler(event("/.netlify/functions/auth-login", { username, password, rememberMe }));
  assert.equal(response.statusCode, 200);
  assertJsonResponse(response);
  const cookie = response.headers["Set-Cookie"].split(";")[0];
  const body = JSON.parse(response.body);
  csrfByCookie.set(cookie, body.csrfToken);
  return { cookie, body };
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
    customer: { firstName: "Sarah", lastName: "Johnson", email: "sarah@example.com", phone: "+15551234567" },
    shippingAddress: { name: "Sarah Johnson", address1: "123 Main St", city: "Orlando", province: "FL", country: "USA", zip: "32801", phone: "" },
    billingAddress: { phone: "" },
    lineItems: {
      nodes: [{
        id: "gid://shopify/LineItem/1",
        title: "Cadbury Crunchie Chocolate Bar 44g",
        variantTitle: "Default Title",
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
          product: { id: "gid://shopify/Product/old", title: "Cadbury Crunchie Chocolate Bar 44g", status: "ACTIVE", featuredImage: { url: "https://example.com/crunchie.jpg" } }
        },
        originalUnitPriceSet: { shopMoney: { amount: "0.99", currencyCode: "USD" } }
      }]
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
    product: { id: "gid://shopify/Product/new", title: "Cadbury Flake Chocolate Bar 32g", status: "ACTIVE", featuredImage: { url: "https://example.com/flake.jpg" } },
    ...overrides
  };
}

function installShopifyMock({ missingOrder = false, shopifyFailure = false } = {}) {
  global.fetch = async (url, options) => {
    assert.match(url, /welkom-usa\.myshopify\.com/);
    assert.equal(options.headers["X-Shopify-Access-Token"], "shpat_test");
    if (shopifyFailure) {
      return {
        ok: false,
        status: 500,
        json: async () => ({ errors: [{ message: "upstream failed" }] }),
        text: async () => "upstream failed"
      };
    }
    const body = JSON.parse(options.body);
    if (body.query.includes("SearchOrder")) {
      return { ok: true, json: async () => ({ data: { orders: { nodes: missingOrder ? [] : [orderNode()] } } }) };
    }
    if (body.query.includes("GetOrder")) {
      return { ok: true, json: async () => ({ data: { order: missingOrder ? null : orderNode() } }) };
    }
    if (body.query.includes("GetVariant")) {
      return { ok: true, json: async () => ({ data: { productVariant: variantNode() } }) };
    }
    if (body.query.includes("SubstitutionVariants")) {
      return {
        ok: true,
        json: async () => ({
          data: {
            productVariants: {
              nodes: [
                variantNode(),
                variantNode({ id: "gid://shopify/ProductVariant/archived", product: { ...variantNode().product, status: "ARCHIVED" } }),
                variantNode({ id: "gid://shopify/ProductVariant/unavailable", availableForSale: false, inventoryQuantity: 0 })
              ]
            }
          }
        })
      };
    }
    throw new Error("Unexpected Shopify query");
  };
}

async function main() {
  clearAuthMemory();
  clearMemoryHistory();
  clearRateLimitMemory();
  await createUser({ username: "admin", displayName: "Admin User", password: "test12345", role: "admin" });
  await createUser({ username: "staff", displayName: "Staff User", password: "staffpass123", role: "staff" });
  const disabled = await createUser({ username: "disabled", displayName: "Disabled User", password: "disabled123", role: "staff" });
  await disableUser(disabled.user.id);

  await check("PUBLIC AND ROUTING: SPA routes serve the current index shell", async () => {
    ["/", "/login", "/menu", "/substitution/order", "/admin/dashboard", "/unknown", "/respond/example-token"].forEach(staticHtmlFor);
  });

  await check("PUBLIC AND ROUTING: API routes return JSON, not index.html", async () => {
    const response = await apiHandler(event("/api/dashboard", undefined, {}, "GET"));
    assert.equal(response.statusCode, 401);
    assertJsonResponse(response);
  });

  await check("AUTHENTICATION: logged-out auth-me returns controlled 401 JSON", async () => {
    const response = await authMeHandler(event("/.netlify/functions/auth-me", undefined, {}, "GET"));
    assert.equal(response.statusCode, 401);
    assertJsonResponse(response);
    assert.equal(JSON.parse(response.body).code, "AUTH_REQUIRED");
  });

  let adminCookie = "";
  let csrfToken = "";
  await check("AUTHENTICATION: correct admin login succeeds and sets session cookie", async () => {
    const result = await login();
    adminCookie = result.cookie;
    csrfToken = result.body.csrfToken;
    assert.equal(result.body.user.role, "admin");
    assert.equal(result.body.user.isActive, true);
    assert.match(result.cookie, /^welkom_sms_session=/);
  });

  await check("AUTHENTICATION: following request sends cookie and auth-me retrieves session", async () => {
    const response = await authMeHandler(event("/.netlify/functions/auth-me", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(response.statusCode, 200);
    const body = JSON.parse(response.body);
    assert.equal(body.user.username, "admin");
    assert.equal(body.user.role, "admin");
    assert.equal(body.user.isActive, true);
  });

  await check("AUTHENTICATION: session remains valid across function invocations", async () => {
    const rawSessionId = decodeURIComponent(adminCookie.split("=")[1]);
    const first = await verifySession(rawSessionId);
    const second = await verifySession(rawSessionId);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
  });

  await check("AUTHENTICATION: incorrect and disabled users get generic failures", async () => {
    const wrong = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "admin", password: "wrongpass123" }));
    assert.equal(wrong.statusCode, 401);
    assert.equal(JSON.parse(wrong.body).error, "Invalid username or password.");
    const disabledLogin = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "disabled", password: "disabled123" }));
    assert.equal(disabledLogin.statusCode, 401);
    assert.equal(JSON.parse(disabledLogin.body).error, "Invalid username or password.");
  });

  await check("AUTHENTICATION: staff users return role=staff and active", async () => {
    const staff = await login("staff", "staffpass123");
    assert.equal(staff.body.user.role, "staff");
    assert.equal(staff.body.user.isActive, true);
  });

  await check("AUTHENTICATION: CSRF protection rejects missing token on POST", async () => {
    const response = await apiHandler(event("/api/templates", { name: "Smoke Template", body: validTemplateBody }, { cookie: adminCookie, "x-csrf-token": "" }));
    assert.equal(response.statusCode, 403);
  });

  await check("AUTHENTICATION: remember-me extends absolute expiry", async () => {
    const regular = await login("admin", "test12345", false);
    const remembered = await login("admin", "test12345", true);
    const regularMs = new Date(regular.body.absoluteExpiresAt).getTime() - Date.now();
    const rememberedMs = new Date(remembered.body.absoluteExpiresAt).getTime() - Date.now();
    assert.ok(rememberedMs > regularMs);
  });

  await check("ADMIN: dashboard, diagnostics, templates and backup load for admin", async () => {
    const dashboard = await apiHandler(event("/api/dashboard", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(dashboard.statusCode, 200);
    const diagnostics = await apiHandler(event("/api/config-diagnostics", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(diagnostics.statusCode, 200);
    const templates = await apiHandler(event("/api/templates", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(templates.statusCode, 200);
    const savedTemplate = await apiHandler(event("/api/templates", { name: "Smoke Template", body: validTemplateBody }, { cookie: adminCookie }));
    assert.equal(savedTemplate.statusCode, 200);
    process.env.BLOB_INIT_ENABLED = "true";
    const init = await apiHandler(event("/api/admin/init-blobs", {}, { cookie: adminCookie }));
    assert.equal(init.statusCode, 200);
    const backup = await apiHandler(event("/api/backup.json", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(backup.statusCode, 200);
    assert.doesNotMatch(backup.body, /test12345|shpat_test|15551234567/);
  });

  await check("ADMIN: staff cannot access admin-only backup route", async () => {
    const staff = await login("staff", "staffpass123");
    const backup = await apiHandler(event("/api/backup.json", undefined, { cookie: staff.cookie }, "GET"));
    assert.equal(backup.statusCode, 403);
  });

  await check("ADMIN: user create/list/disable works and indexes remain consistent", async () => {
    const create = await adminCreateUserHandler(event("/.netlify/functions/admin-create-user", { username: "worker1", displayName: "Worker One", password: "workerpass123", role: "staff" }, { cookie: adminCookie }));
    assert.equal(create.statusCode, 200);
    const createdUser = JSON.parse(create.body).user;
    const byUsername = await getUserByUsername("worker1");
    assert.equal(byUsername.id, createdUser.id);
    const list = await adminListUsersHandler(event("/.netlify/functions/admin-list-users", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(list.statusCode, 200);
    const disable = await adminDisableUserHandler(event("/.netlify/functions/admin-disable-user", { userId: createdUser.id }, { cookie: adminCookie }));
    assert.equal(disable.statusCode, 200);
    const blocked = await authLoginHandler(event("/.netlify/functions/auth-login", { username: "worker1", password: "workerpass123" }));
    assert.equal(blocked.statusCode, 401);
  });

  await check("SHOPIFY: order and product search handle valid, missing and failure states safely", async () => {
    installShopifyMock();
    const order = await apiHandler(event("/api/order-search", { query: "1023" }, { cookie: adminCookie }));
    assert.equal(order.statusCode, 200);
    assert.doesNotMatch(order.body, /shpat_test|123 Main St/);
    const products = await apiHandler(event("/api/product-search", { query: "flake" }, { cookie: adminCookie }));
    assert.equal(products.statusCode, 200);
    const body = JSON.parse(products.body);
    assert.equal(body.products.length, 1);
    assert.equal(body.products[0].inventoryQuantity, 12);
    installShopifyMock({ missingOrder: true });
    const missing = await apiHandler(event("/api/order-search", { query: "9999" }, { cookie: adminCookie }));
    assert.equal(missing.statusCode, 404);
    installShopifyMock({ shopifyFailure: true });
    const failed = await apiHandler(event("/api/order-search", { query: "1023" }, { cookie: adminCookie }));
    assert.equal(failed.statusCode, 502);
    assert.doesNotMatch(failed.body, /shpat_test|X-Shopify-Access-Token/);
  });

  await check("SUBSTITUTION AND TWILIO: dry-run send, duplicate protection and history work", async () => {
    installShopifyMock();
    const payload = {
      orderId: "gid://shopify/Order/1",
      replacements: [{
        lineItemId: "gid://shopify/LineItem/1",
        substituteVariantId: "gid://shopify/ProductVariant/new"
      }],
      message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.",
      sendConfirmed: true,
      idempotencyKey: "smoke-substitution"
    };
    const send = await apiHandler(event("/api/send-replacement-sms", payload, { cookie: adminCookie }));
    assert.equal(send.statusCode, 200, send.body);
    const body = JSON.parse(send.body);
    assert.equal(body.dryRun, true);
    assert.equal(body.record.latestTwilioStatus, "not-sent");
    const repeat = await apiHandler(event("/api/send-replacement-sms", { ...payload, idempotencyKey: "smoke-substitution-2" }, { cookie: adminCookie }));
    assert.equal(repeat.statusCode, 409);
    const history = await apiHandler(event("/api/message-history", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(history.statusCode, 200);
    assert.match(history.body, /#1023/);
  });

  await check("TWILIO: manual phone validation and consent confirmation are enforced", async () => {
    const base = {
      phone: "+15551234567",
      message: "Welkom USA: Manual smoke test message. Reply STOP to opt out.",
      consentConfirmed: true,
      sendConfirmed: true,
      idempotencyKey: "manual-smoke"
    };
    const badPhone = await apiHandler(event("/api/send-manual-sms", { ...base, phone: "5551234567" }, { cookie: adminCookie }));
    assert.equal(badPhone.statusCode, 400);
    const noConsent = await apiHandler(event("/api/send-manual-sms", { ...base, consentConfirmed: false }, { cookie: adminCookie }));
    assert.equal(noConsent.statusCode, 400);
    const ok = await apiHandler(event("/api/send-manual-sms", base, { cookie: adminCookie }));
    assert.equal(ok.statusCode, 200);
    assert.equal(JSON.parse(ok.body).dryRun, true);
  });

  await check("AUTHENTICATION: logout clears session", async () => {
    const logout = await authLogoutHandler(event("/.netlify/functions/auth-logout", {}, { cookie: adminCookie, "x-csrf-token": csrfToken }));
    assert.equal(logout.statusCode, 200);
    assert.match(logout.headers["Set-Cookie"], /Max-Age=0/);
    const me = await authMeHandler(event("/.netlify/functions/auth-me", undefined, { cookie: adminCookie }, "GET"));
    assert.equal(me.statusCode, 401);
  });

  const failed = results.filter((result) => !result.ok);
  results.forEach((result) => {
    console.log(`${result.ok ? "PASS" : "FAIL"} ${result.name}`);
    if (!result.ok) console.log(`  ${result.error.stack || result.error.message}`);
  });
  console.log(`\nSmoke audit: ${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
