# Endpoint Registry

Every route defaults to denied unless it is listed in `src/endpoint-registry.js`.

Access types:

- `public`
- `customer-token`
- `staff`
- `admin`
- `twilio-webhook`
- `shopify-webhook`

The Welkom USA SMS app currently has no Shopify webhook endpoint. Add one only with HMAC validation.
