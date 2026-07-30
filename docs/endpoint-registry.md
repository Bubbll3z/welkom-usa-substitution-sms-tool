# Endpoint Registry

Every API route defaults to denied unless it is listed in `src/endpoint-registry.js`.

Access types:

- `public`
- `customer-token`
- `staff`
- `admin`
- `twilio-webhook`
- `shopify-webhook`

## Public

- `POST /api/login`

## Customer Token Protected

- `GET /api/public/substitution-request`
- `GET /api/public/substitution-request/:token`
- `POST /api/public/substitution-response`

## Staff Authenticated

- `POST /api/order-search`
- `POST /api/product-search`
- `POST /api/line-item-substitutions`
- `POST /api/duplicate-check`
- `POST /api/send-substitution-sms`
- `POST /api/send-replacement-sms`
- `POST /api/send-manual-sms`
- `GET /api/message-history`
- `GET /api/message-history/:id`
- `GET /api/substitution-requests`
- `GET /api/substitution-requests/:id`
- `POST /api/substitution-requests`
- `POST /api/substitution-requests/:id/revoke`
- `POST /api/substitution-requests/:id/complete`
- `POST /api/substitution-requests/:id/review`
- `POST /api/substitution-requests/:id/resend`
- `GET /api/replies`
- `GET /api/replies/:id`
- `POST /api/replies/:id/read`
- `POST /api/replies/:id/review`
- `GET /api/templates`
- `POST /api/templates`
- `POST /api/templates/:id/archive`
- `GET /api/dashboard`
- `GET /api/config-diagnostics`
- `GET /api/session`
- `POST /api/logout`

## Admin Only

- `POST /api/admin/init-blobs`
- `POST /api/admin/cleanup`
- `GET /api/backup.json`
- `GET /api/backup/messages.csv`

## Twilio Webhooks

- `POST /api/twilio-status`
- `POST /api/twilio-inbound`

Both validate `X-Twilio-Signature` before processing.

## Shopify Webhook

- `POST /api/shopify-webhook`

The webhook verifies the raw body HMAC, expected shop domain, allowed topics and delivery ID deduplication before processing.
