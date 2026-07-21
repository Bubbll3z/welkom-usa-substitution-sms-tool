const assert = require("node:assert/strict");
const test = require("node:test");

process.env.STAFF_PASSWORD = "test123";
process.env.DRY_RUN = "true";
process.env.SMS_DRY_RUN = "true";

const { handler } = require("../netlify/functions/api");
const { buildSubstitutionMessage, sendSms } = require("../src/sms");
const { findOrder, normalizeOrderQuery } = require("../src/shopify");

function event(path, body, headers = {}) {
  return {
    httpMethod: "POST",
    path,
    headers: {
      "content-type": "application/json",
      ...headers
    },
    body: JSON.stringify(body)
  };
}

test("builds the approved substitution message", () => {
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
});

test("dry-run SMS does not call Twilio", async () => {
  const result = await sendSms({
    phone: "+15555550123",
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
  assert.equal(result.body.providerStatus, "not-sent");
});

test("API rejects wrong staff password", async () => {
  const response = await handler(event("/api/order-search", { password: "wrong", query: "#1023" }));
  assert.equal(response.statusCode, 401);
});

test("API searches products with staff password", async () => {
  process.env.SHOPIFY_SHOP_DOMAIN = "welkom-usa.myshopify.com";
  process.env.SHOPIFY_ADMIN_ACCESS_TOKEN = "shpat_test";
  process.env.SHOPIFY_API_VERSION = "2026-07";

  const originalFetch = global.fetch;
  global.fetch = async (url, options) => {
    assert.match(url, /welkom-usa\.myshopify\.com/);
    assert.equal(options.headers["X-Shopify-Access-Token"], "shpat_test");
    return {
      ok: true,
      json: async () => ({
        data: {
          products: {
            nodes: [
              {
                id: "product-1",
                title: "Cadbury Flake Chocolate Bar 32g",
                status: "ACTIVE",
                featuredImage: { url: "https://example.com/flake.jpg" },
                variants: {
                  nodes: [{ id: "variant-1", title: "Default Title", price: { amount: "0.99" } }]
                }
              }
            ]
          }
        }
      })
    };
  };

  try {
    const response = await handler(event("/api/product-search", { password: "test123", query: "FLAKE32" }));
    const body = JSON.parse(response.body);
    assert.equal(response.statusCode, 200);
    assert.equal(body.success, true);
    assert.equal(body.products[0].title, "Cadbury Flake Chocolate Bar 32g");
    assert.doesNotMatch(response.body, /shpat_test/);
  } finally {
    global.fetch = originalFetch;
    delete process.env.SHOPIFY_SHOP_DOMAIN;
    delete process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
    delete process.env.SHOPIFY_API_VERSION;
  }
});

test("normalizes order numbers", () => {
  assert.equal(normalizeOrderQuery("#1023"), "1023");
  assert.equal(normalizeOrderQuery("1023"), "1023");
});

test("Shopify lookup maps order and substitution suggestions", async () => {
  const calls = [];
  const result = await findOrder("#1023", {
    env: {
      SHOPIFY_SHOP_DOMAIN: "welkom-usa.myshopify.com",
      SHOPIFY_ADMIN_ACCESS_TOKEN: "shpat_test",
      SHOPIFY_API_VERSION: "2026-07"
    },
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      const body = JSON.parse(options.body);
      if (body.query.includes("SearchOrder")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              orders: {
                nodes: [
                  {
                    id: "gid://shopify/Order/1",
                    name: "#1023",
                    phone: "",
                    processedAt: "2026-07-21T00:00:00Z",
                    displayFulfillmentStatus: "PARTIALLY_FULFILLED",
                    cancelledAt: null,
                    customer: {
                      firstName: "Sarah",
                      lastName: "Johnson",
                      email: "sarah@example.com",
                      phone: "+15551234567"
                    },
                    shippingAddress: {
                      name: "Sarah Johnson",
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
                          id: "line-1",
                          title: "Cadbury Crunchie Chocolate Bar 44g",
                          variantTitle: "",
                          quantity: 1,
                          sku: "CRUNCHIE44",
                          image: { url: "https://example.com/crunchie.jpg" },
                          variant: { sku: "CRUNCHIE44", image: { url: "" } },
                          originalUnitPriceSet: { shopMoney: { amount: "0.99", currencyCode: "USD" } }
                        }
                      ]
                    }
                  }
                ]
              }
            }
          })
        };
      }

      return {
        ok: true,
        json: async () => ({
          data: {
            products: {
              nodes: [
                {
                  id: "product-1",
                  title: "Cadbury Flake Chocolate Bar 32g",
                  status: "ACTIVE",
                  featuredImage: { url: "https://example.com/flake.jpg" },
                  variants: {
                    nodes: [{ id: "variant-1", title: "Default Title", price: { amount: "0.99" } }]
                  }
                }
              ]
            }
          }
        })
      };
    }
  });

  assert.equal(result.status, 200);
  assert.equal(result.body.order.name, "#1023");
  assert.equal(result.body.order.customer.redactedPhone, "+15*******67");
  assert.equal(result.body.order.lineItems[0].title, "Cadbury Crunchie Chocolate Bar 44g");
  assert.equal(result.body.order.substitutionProducts[0].title, "Cadbury Flake Chocolate Bar 32g");
  assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(result.body), /shpat_test/);
});
