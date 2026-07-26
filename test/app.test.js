const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const twilio = require("twilio");

process.env.NODE_ENV = "test";
process.env.STAFF_PASSWORD = "test123";
process.env.STAFF_NAME = "Test Staff";
process.env.SESSION_SECRET = "12345678901234567890123456789012";
process.env.SESSION_DURATION_MINUTES = "60";
process.env.DRY_RUN = "true";
process.env.SMS_DRY_RUN = "true";
process.env.MESSAGE_STORAGE_PROVIDER = "memory";

const { handler } = require("../netlify/functions/api");
const { verifySession } = require("../src/auth");
const { clearMemoryHistory } = require("../src/history");
const { resetStoreFactory, setStoreFactory } = require("../src/data-store");
const { buildSubstitutionMessage, sendSms, smsLength, validateMessage } = require("../src/sms");
const { consentFromAttributes, findOrder, getAccessToken, normalizeOrderQuery, searchProductsForSubstitutions } = require("../src/shopify");

function event(path, body, headers = {}, method = "POST") {
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

async function loginCookie(password = "test123") {
  const response = await handler(event("/api/login", { password }));
  assert.equal(response.statusCode, 200);
  return response.headers["Set-Cookie"].split(";")[0];
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

test.beforeEach(() => {
  clearMemoryHistory();
  process.env.SHOPIFY_SHOP_DOMAIN = "welkom-usa.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2025-10";
  delete process.env.SHOPIFY_CLIENT_ID;
  delete process.env.SHOPIFY_CLIENT_SECRET;
  delete process.env.BLOB_INIT_ENABLED;
  delete process.env.REQUIRE_LOGIN;
  resetStoreFactory();
});

test("authentication supports login, session, logout, wrong password, and expired session", async () => {
  const wrong = await handler(event("/api/login", { password: "wrong" }));
  assert.equal(wrong.statusCode, 401);

  const cookie = await loginCookie();
  const token = cookie.split("=")[1];
  assert.equal(verifySession(decodeURIComponent(token)).ok, true);
  assert.equal(verifySession(decodeURIComponent(token), process.env, Date.now() + 90 * 60 * 1000).code, "AUTH_REQUIRED");

  const session = await handler(event("/api/session", undefined, { cookie }, "GET"));
  assert.equal(session.statusCode, 200);

  const logout = await handler(event("/api/logout", {}, { cookie }));
  assert.equal(logout.statusCode, 200);
});

test("unauthenticated API request is rejected", async () => {
  const response = await handler(event("/api/order-search", { query: "#1023" }));
  assert.equal(response.statusCode, 401);
});

test("temporary no-login mode opens authenticated routes without a password", async () => {
  process.env.REQUIRE_LOGIN = "false";

  const session = await handler(event("/api/session", undefined, {}, "GET"));
  assert.equal(session.statusCode, 200);
  assert.equal(JSON.parse(session.body).authRequired, false);

  const dashboard = await handler(event("/api/dashboard", undefined, {}, "GET"));
  assert.equal(dashboard.statusCode, 200);
  const dashboardBody = JSON.parse(dashboard.body);
  assert.equal(dashboardBody.success, true);
  assert.equal(dashboardBody.status.authRequired, false);
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
  assert.equal(exact.body.order.totalPrice, "USD 47.98");

  const partial = await findOrder("#1023", { env: shopifyEnv(), fetchImpl: mockFetch({ order: orderNode({ name: "#10230" }) }) });
  assert.equal(partial.status, 404);
});

test("Shopify client credentials grant retrieves an expiring Admin API token", async () => {
  const calls = [];
  const token = await getAccessToken({
    env: {
      SHOPIFY_SHOP_DOMAIN: "welkom-usa.myshopify.com",
      SHOPIFY_CLIENT_ID: "client-id",
      SHOPIFY_CLIENT_SECRET: "client-secret",
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

test("manual SMS requires consent confirmation, redacts phone, and stays in dry-run", async () => {
  const cookie = await loginCookie();
  const payload = {
    phone: "+15551234567",
    firstName: "Walk In",
    unavailableItem: "Requested biscuits",
    substituteItem: "Replacement biscuits",
    reference: "physical-shop",
    consentConfirmed: true,
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

test("send blocks missing consent, cancelled order, invalid line item, and unavailable substitute", async () => {
  const cookie = await loginCookie();
  const originalFetch = global.fetch;
  const payload = {
    orderId: "gid://shopify/Order/1",
    lineItemId: "gid://shopify/LineItem/1",
    substituteVariantId: "gid://shopify/ProductVariant/new",
    message: "Welkom USA: Hi Sarah, Cadbury Crunchie Chocolate Bar 44g in order #1023 is unavailable. We can substitute it with Cadbury Flake Chocolate Bar 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out."
  };

  global.fetch = mockFetch({ order: orderNode({ customAttributes: [{ key: "SMS consent", value: "No" }] }) });
  const noConsent = await handler(event("/api/send-substitution-sms", payload, { cookie }));
  assert.equal(JSON.parse(noConsent.body).code, "SMS_CONSENT_MISSING");

  global.fetch = mockFetch({ order: orderNode({ cancelledAt: "2026-07-20T00:00:00Z" }) });
  const cancelled = await handler(event("/api/send-substitution-sms", payload, { cookie }));
  assert.equal(JSON.parse(cancelled.body).code, "ORDER_CANCELLED");

  global.fetch = mockFetch();
  const badLine = await handler(event("/api/send-substitution-sms", { ...payload, lineItemId: "bad" }, { cookie }));
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
    assert.doesNotMatch(publicRead.body, /15551234567|shpat_test|tokenHash|gid:\/\/shopify/);

    const item = publicBody.request.items[0];
    const invalid = await handler(event("/api/public/substitution-response", {
      token,
      choices: [{ requestItemId: item.requestItemId, type: "substitute", optionId: "unapproved" }]
    }));
    assert.equal(invalid.statusCode, 400);
    assert.equal(JSON.parse(invalid.body).code, "INVALID_RESPONSE");

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
    assert.equal(repeat.statusCode, 409);
    assert.equal(JSON.parse(repeat.body).code, "ALREADY_SUBMITTED");

    const list = await handler(event("/api/substitution-requests", undefined, { cookie }, "GET"));
    assert.equal(list.statusCode, 200);
    assert.equal(JSON.parse(list.body).requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("public customer response page markup is present", () => {
  const html = fs.readFileSync(path.join(__dirname, "../public/index.html"), "utf8");
  assert.match(html, /id="respondPage"/);
  assert.match(html, /Choose what you would prefer/);
  assert.match(html, /Confirm My Choices/);
  assert.match(html, /choice-card/);
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
    idempotencyKey: "callback"
  }, { cookie }));
  global.fetch = originalFetch;
  const recordId = JSON.parse(send.body).record.id;
  const url = `https://example.netlify.app/api/twilio-status?recordId=${encodeURIComponent(recordId)}`;
  const params = { MessageSid: "SM123", MessageStatus: "delivered" };
  const signature = twilio.getExpectedTwilioSignature(process.env.TWILIO_AUTH_TOKEN, url, params);
  const bad = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, "bad"));
  assert.equal(bad.statusCode, 403);
  const good = await handler(formEvent(`/api/twilio-status?recordId=${recordId}`, params, signature));
  assert.equal(good.statusCode, 200);
});
