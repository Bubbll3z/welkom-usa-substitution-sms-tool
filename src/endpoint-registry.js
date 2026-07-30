const ACCESS_TYPES = {
  public: "public",
  customerToken: "customer-token",
  staff: "staff",
  admin: "admin",
  twilioWebhook: "twilio-webhook",
  shopifyWebhook: "shopify-webhook"
};

const API_ENDPOINTS = [
  { route: "login", methods: ["POST"], access: ACCESS_TYPES.public },
  { route: "logout", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "session", methods: ["GET"], access: ACCESS_TYPES.staff },
  { route: "twilio-status", methods: ["POST"], access: ACCESS_TYPES.twilioWebhook },
  { route: "twilio-inbound", methods: ["POST"], access: ACCESS_TYPES.twilioWebhook },
  { route: "shopify-webhook", methods: ["POST"], access: ACCESS_TYPES.shopifyWebhook },
  { route: "public/substitution-request", methods: ["GET"], access: ACCESS_TYPES.customerToken },
  { pattern: /^public\/substitution-request\/[^/]+$/, methods: ["GET"], access: ACCESS_TYPES.customerToken },
  { route: "public/substitution-response", methods: ["POST"], access: ACCESS_TYPES.customerToken },
  { route: "dashboard", methods: ["GET"], access: ACCESS_TYPES.staff },
  { route: "config-diagnostics", methods: ["GET"], access: ACCESS_TYPES.staff },
  { route: "replies", methods: ["GET"], access: ACCESS_TYPES.staff },
  { pattern: /^replies\/[A-Za-z0-9_-]+$/, methods: ["GET"], access: ACCESS_TYPES.staff },
  { pattern: /^replies\/[A-Za-z0-9_-]+\/(read|review)$/, methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "message-history", methods: ["GET"], access: ACCESS_TYPES.staff },
  { pattern: /^message-history\/[A-Za-z0-9_-]+$/, methods: ["GET"], access: ACCESS_TYPES.staff },
  { route: "substitution-requests", methods: ["GET", "POST"], access: ACCESS_TYPES.staff },
  { pattern: /^substitution-requests\/[A-Za-z0-9_-]+$/, methods: ["GET"], access: ACCESS_TYPES.staff },
  { pattern: /^substitution-requests\/[A-Za-z0-9_-]+\/(revoke|complete|review|resend)$/, methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "templates", methods: ["GET", "POST"], access: ACCESS_TYPES.staff },
  { pattern: /^templates\/[A-Za-z0-9_-]+\/archive$/, methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "backup.json", methods: ["GET"], access: ACCESS_TYPES.admin },
  { route: "backup/messages.csv", methods: ["GET"], access: ACCESS_TYPES.admin },
  { route: "admin/init-blobs", methods: ["POST"], access: ACCESS_TYPES.admin },
  { route: "admin/cleanup", methods: ["POST"], access: ACCESS_TYPES.admin },
  { route: "order-search", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "product-search", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "line-item-substitutions", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "duplicate-check", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "send-substitution-sms", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "send-manual-sms", methods: ["POST"], access: ACCESS_TYPES.staff },
  { route: "send-replacement-sms", methods: ["POST"], access: ACCESS_TYPES.staff }
];

const FUNCTION_ENDPOINTS = [
  { functionName: "auth-login", methods: ["POST"], access: ACCESS_TYPES.public },
  { functionName: "auth-logout", methods: ["POST"], access: ACCESS_TYPES.staff },
  { functionName: "auth-me", methods: ["GET"], access: ACCESS_TYPES.staff },
  { functionName: "auth-change-password", methods: ["POST"], access: ACCESS_TYPES.staff },
  { functionName: "admin-create-user", methods: ["POST"], access: ACCESS_TYPES.admin },
  { functionName: "admin-disable-user", methods: ["POST"], access: ACCESS_TYPES.admin },
  { functionName: "admin-reset-user-password", methods: ["POST"], access: ACCESS_TYPES.admin },
  { functionName: "admin-list-users", methods: ["GET"], access: ACCESS_TYPES.admin }
];

function matchEndpoint(route, endpoints = API_ENDPOINTS) {
  return endpoints.find((entry) => {
    if (entry.route) return entry.route === route;
    return entry.pattern?.test(route);
  }) || null;
}

module.exports = {
  ACCESS_TYPES,
  API_ENDPOINTS,
  FUNCTION_ENDPOINTS,
  matchEndpoint
};
