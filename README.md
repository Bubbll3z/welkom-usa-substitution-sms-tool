# Welkom USA Substitution SMS Tool

Internal Netlify-ready dashboard for Welkom USA staff to search a Shopify order, select an unavailable item, choose a substitute product variant, edit the approved SMS, and send it through Twilio.

## Production Safety

This branch includes:

- Staff user login with scrypt password hashes stored in Netlify Blobs.
- Hashed server-side sessions stored in Netlify Blobs and sent through secure HttpOnly cookies.
- Account lockout after repeated failed login attempts.
- Exact Shopify order-number matching.
- Shopify order custom attribute consent validation for `SMS consent = Yes`.
- Server-side order revalidation before sending.
- No arbitrary browser-provided recipient phone numbers.
- Cancelled-order, missing-phone, missing-consent, invalid-line-item, and unavailable-substitute blocking.
- Shopify product/variant search by selected item, title, SKU, or barcode.
- Inventory and available-for-sale checks.
- Idempotency and duplicate-send protection.
- Persistent message history through Netlify Blobs, with memory fallback for local development/tests.
- Twilio status callback endpoint with signature validation.
- Shopify webhook endpoint with HMAC validation and delivery-ID deduplication.
- GSM-7/UCS-2 SMS segment estimation.

## Message Template

```text
Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.
```

The message remains editable, but it must start with `Welkom USA:`, include the order number, avoid unresolved placeholders, and stay within `MAX_SMS_LENGTH` currently set to 320 by default.

## Local Setup

```bash
npm ci
copy .env.example .env
npm run dev
```

For local safe testing:

```env
DRY_RUN=true
SMS_DRY_RUN=true
MESSAGE_STORAGE_PROVIDER=memory
```

Open [http://localhost:3000](http://localhost:3000) or the port shown by the dev server.

## Netlify Deployment

Connect this GitHub repository to Netlify, then use:

Netlify settings:

```text
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
```

`netlify.toml` already includes these settings and routes `/api/*` requests to the Netlify Function.

After every GitHub push, Netlify can build the latest committed version automatically if the site is connected to this repository.

## Required Environment Variables

Set these in Netlify environment variables, not in source code:

```env
DRY_RUN=true
SMS_DRY_RUN=true
MAX_SMS_LENGTH=320

SHOPIFY_SHOP_DOMAIN=welkom-usa.myshopify.com
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
SHOPIFY_WEBHOOK_SECRET=
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2025-10

TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_API_KEY_SID=
TWILIO_API_KEY_SECRET=
TWILIO_PHONE_NUMBER=
TWILIO_FROM_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
TWILIO_STATUS_CALLBACK_BASE_URL=
TWILIO_INBOUND_WEBHOOK_BASE_URL=
PUBLIC_APP_URL=https://your-netlify-site.netlify.app

MESSAGE_STORAGE_PROVIDER=netlify-blobs
BLOB_INIT_ENABLED=true
SUBSTITUTION_TOKEN_PEPPER=
RATE_LIMIT_KEY_PEPPER=
```

Staff passwords are **not** configured through environment variables anymore. Create staff users with `npm run create-admin` first, then create additional staff users from admin endpoints/tools. For new Shopify Dev Dashboard apps, set `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET`; the app automatically requests and refreshes the 24-hour Admin API token server-side. `SHOPIFY_ADMIN_ACCESS_TOKEN` is only a fallback for older apps where Shopify directly provided a token. `SHOPIFY_WEBHOOK_SECRET` is optional unless you configure Shopify webhooks; if omitted, webhook validation falls back to `SHOPIFY_CLIENT_SECRET`. Use either Twilio Auth Token auth or API Key auth. Use either a Twilio sender phone number/from number or a Messaging Service SID.
`PUBLIC_APP_URL` should be the deployed Netlify site URL so customer response links open the production app. `SUBSTITUTION_TOKEN_PEPPER` should be a random secret used only for hashing customer response tokens. `RATE_LIMIT_KEY_PEPPER` is optional but recommended so rate-limit hashes cannot be compared across environments.

## Production Secret Checklist

1. In Netlify, open the Welkom USA SMS site, then go to **Site configuration > Environment variables**.
2. Add `SUBSTITUTION_TOKEN_PEPPER` with a random value of at least 32 characters.
3. Create the first admin user. Do not use a default password.
4. Add Shopify values from the Shopify Dev Dashboard app:
   - `SHOPIFY_SHOP_DOMAIN=welkom-usa.myshopify.com`
   - `SHOPIFY_CLIENT_ID`
   - `SHOPIFY_CLIENT_SECRET`
   - `SHOPIFY_API_VERSION=2025-10`
5. Add Twilio values from the Twilio Console:
   - `TWILIO_ACCOUNT_SID`
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_PHONE_NUMBER` or `TWILIO_FROM_NUMBER`
   - optional `TWILIO_MESSAGING_SERVICE_SID` if sending through a messaging service
6. Set storage for production:
   - `MESSAGE_STORAGE_PROVIDER=netlify-blobs`
   - `BLOB_INIT_ENABLED=true` for the first authenticated initialization, then set it to `false`
7. Do not add `NETLIFY_SITE_ID`, `NETLIFY_AUTH_TOKEN`, `NETLIFY_BLOBS_SITE_ID`, or `NETLIFY_BLOBS_TOKEN` for normal deployed Functions. Netlify supplies credentials automatically to `getStore("store-name")`.
8. Keep both `DRY_RUN=true` and `SMS_DRY_RUN=true` for the first deployed test.
9. After the dry-run test passes, change both dry-run variables to `false` only when a manager approves one live test to a company-controlled phone.

No Cloudflare secret is required for this app unless you later choose to move hosting away from Netlify.

## Shopify Setup

Create a Shopify custom app for Welkom USA with Admin API access in the Shopify Dev Dashboard.

Required scopes:

```text
read_orders
read_products
read_inventory
read_customers
```

`read_customers` is required so the app can read Shopify's native customer SMS marketing consent state when it is available. A customer phone number by itself is not treated as SMS consent.

Do not grant write scopes for the current workflow. This app does not need `write_orders`, refund, fulfillment, product-write, customer-write, or payment scopes because staff manually review the customer's choice and update Shopify separately.

Shopify access is intentionally narrow:

- the frontend never calls the Shopify Admin API directly
- Netlify Functions make all Shopify Admin API requests server-side
- there is no generic Shopify GraphQL or REST proxy
- allowed actions are explicit: exact order search, server-side order read, active product/variant search, and variant availability checks
- browser order-search responses hide full customer phone numbers, raw email addresses, shipping/billing addresses, payment details, notes, and raw Shopify API responses

The checkout/cart must save this order custom attribute:

```text
SMS consent = Yes
```

The app only treats consent as granted when the key matches `SMS consent` case-insensitively and the value equals `Yes` case-insensitively. Accelerated checkout orders may not include this attribute; those are treated as no consent and sending is blocked.

After installing the app, copy the Client ID and Client secret from the Dev Dashboard app settings into Netlify:

```env
SHOPIFY_CLIENT_ID=
SHOPIFY_CLIENT_SECRET=
```

Do not paste these values into chat or commit them to GitHub. The app exchanges them at `https://welkom-usa.myshopify.com/admin/oauth/access_token` using Shopify's client credentials grant and caches the returned access token until it is close to expiry.

Optional Shopify webhook endpoint:

```text
https://your-netlify-site.netlify.app/api/shopify-webhook
```

Accepted webhook topics are currently:

```text
orders/updated
orders/cancelled
```

The webhook handler verifies the raw request body HMAC before processing, checks the shop domain, requires a delivery ID, deduplicates delivery IDs, and rejects unexpected topics. It does not write to Shopify or modify orders.

## Twilio Setup

Keep `DRY_RUN=true` and `SMS_DRY_RUN=true` until Shopify lookup, consent validation, duplicate protection, and a dry-run send are confirmed.

For real delivery-status updates, set:

```env
TWILIO_STATUS_CALLBACK_BASE_URL=https://your-netlify-site.netlify.app
TWILIO_INBOUND_WEBHOOK_BASE_URL=https://your-netlify-site.netlify.app
```

The app sends Twilio callbacks to:

```text
https://your-netlify-site.netlify.app/api/twilio-status
```

Set the Twilio number's inbound messaging webhook to:

```text
https://your-netlify-site.netlify.app/api/twilio-inbound
```

Both callbacks validate `X-Twilio-Signature` using `TWILIO_AUTH_TOKEN` before processing. Delivery status updates are accepted only for known Twilio statuses and are applied by `MessageSid`. Inbound STOP/HELP messages are recorded safely with masked phone numbers; STOP stores an opt-out marker so future non-essential SMS sends to that phone are blocked. Do not try to override Twilio's own opt-out enforcement.

## Netlify Blobs Storage

For production, set:

```env
MESSAGE_STORAGE_PROVIDER=netlify-blobs
BLOB_INIT_ENABLED=true
```

For local development and tests, use:

```env
MESSAGE_STORAGE_PROVIDER=memory
```

Memory storage is not persistent and should not be used for production.

The app uses these site-wide Netlify Blob stores:

```text
welkom-sms-history
welkom-sms-templates
welkom-sms-audit
welkom-sms-settings
welkom-sms-substitution-requests
welkom-sms-users
welkom-sms-sessions
welkom-sms-rate-limits
```

These stores are created automatically by Netlify after the first successful write. There is no separate Blob ID to create. In deployed Netlify Functions the app uses automatic credentials with `getStore("store-name")`.

Only safe operational data is stored in Blobs:

- redacted SMS and dry-run history
- template records
- audit records
- non-secret settings
- secure substitution request records with redacted customer details and hashed response tokens
- staff user records with scrypt password hashes
- session records with hashed session IDs only
- application rate-limit counters with hashed keys only

Never store Shopify access tokens, Twilio Auth Tokens, staff passwords, session secrets, cookies, authorization headers, complete customer addresses, or unredacted customer phone numbers in Blobs.

## Privacy, Logging And Retention

Server logs go through a safe logger that redacts secret-looking fields and masks phone numbers and email addresses. Do not log full Shopify or Twilio payloads, complete request headers, raw customer response tokens, or environment variables.

Audit records are written for login events, account lockouts, logout, request creation, SMS success/failure, link opens, customer responses, request revoke/complete actions, invalid Twilio/Shopify webhook signatures, rate-limit events, admin user changes, cleanup runs and backup exports. Audit entries must not contain raw secrets, raw tokens, full phone numbers or complete customer addresses.

Admins can run the protected cleanup action:

```bash
POST /api/admin/cleanup
```

It requires an authenticated admin session and CSRF token. The cleanup removes expired session records older than 7 days, removes expired rate-limit records, removes old Twilio webhook dedupe records, and archives old terminal substitution requests instead of deleting active customer workflow data.

Backup exports require admin authentication, use non-public download responses, record an audit event, and export only redacted message history, safe request summaries, templates, audit records and non-secret settings.

## Application Rate Limiting

The app includes free application-level rate limiting through the `welkom-sms-rate-limits` Blob store. It does not use paid Netlify rate-limiting features, Redis, or an external database.

Current limits:

- login: 5 failed attempts per username per 15 minutes
- login: 10 attempts per IP per 15 minutes
- customer response page: 30 reads per IP per 10 minutes
- customer submissions: 5 attempts per IP per 10 minutes
- customer submissions: 5 attempts per response token per 10 minutes
- order search: 30 requests per staff session per minute
- product/substitute search: 60 requests per staff session per minute
- SMS actions: 10 per staff user per 10 minutes
- substitution SMS sends: 3 per order per hour

Rate-limit records store hashed keys, counters, reset timestamps, and block timestamps only. They must not contain passwords, full phone numbers, SMS bodies, raw customer response tokens, cookies, authorization headers, or Shopify/Twilio secrets.

Blob-based rate limiting is best-effort in distributed serverless execution. Two simultaneous requests may occasionally pass before both function instances see the updated counter. The app also uses account lockout, idempotency keys, duplicate-send detection, customer one-time submission locks, Twilio signature validation, MessageSid deduplication, Shopify HMAC validation, and Shopify webhook delivery-ID deduplication as additional safeguards. Expired rate-limit records are cleaned up opportunistically during writes and by the cleanup helper.

## Staff Authentication Setup

This app does not use paid Netlify Identity or paid third-party authentication. Staff users are stored in the `welkom-sms-users` Netlify Blob store. Sessions are stored in `welkom-sms-sessions`; the browser receives only an HttpOnly cookie containing the raw session ID.

Create the first admin user from a trusted terminal:

```bash
npm run create-admin
```

The script prompts for username, display name and password. It hashes the password with Node.js `crypto.scrypt` and stores only the hash and unique salt.

For non-interactive setup, use temporary environment variables in your shell only:

```bash
ADMIN_USERNAME=manager ADMIN_DISPLAY_NAME="Manager" ADMIN_PASSWORD="use-a-long-random-password" npm run create-admin
```

Do not add `ADMIN_PASSWORD` to `.env`, GitHub, Netlify environment variables, screenshots, or chat.

For deployed Netlify setup, if you cannot run the local script against the deployed Blob store yet, use the temporary bootstrap login:

```text
ADMIN_BOOTSTRAP_ENABLED=true
ADMIN_BOOTSTRAP_USERNAME=manager
ADMIN_BOOTSTRAP_DISPLAY_NAME=Manager
ADMIN_BOOTSTRAP_PASSWORD=use-a-long-random-password
```

Redeploy, then log in once with that username and password. The app creates a real admin user in `welkom-sms-users` with a scrypt password hash. After the first successful login, remove these `ADMIN_BOOTSTRAP_*` variables or set `ADMIN_BOOTSTRAP_ENABLED=false`, then redeploy again. Do not leave bootstrap enabled permanently.

Login behavior:

- 30-minute idle timeout
- 8-hour absolute timeout
- 5 failed attempts locks the account for 15 minutes
- username/password failures return the same generic message
- passwords, password hashes and salts are never returned to the browser

## Secure Customer Response Links

Staff can create a customer substitution request instead of sending the older direct approval SMS. The app stores the unavailable order reference, approved item choices, status timestamps, and a hash of the response token. It does not store the raw link token. It then sends this SMS:

```text
Welkom USA: An item in order #[ORDER NUMBER] is unavailable. Choose a substitute or refund here: [SECURE LINK]. Reply HELP for help or STOP to opt out.
```

The customer link opens `/respond/:token`. The token is random, is never derived from an order number or phone number, and is hashed before storage. Customers can choose an approved substitute, refund, ask staff to choose, or ask staff to contact them. The public page never shows Shopify IDs, full phone numbers, email addresses, full addresses, internal staff notes, Twilio credentials, Shopify tokens, staff passwords, session data, Blob keys, token hashes, or raw order responses. Customer choices are saved for staff review only; the app does not modify Shopify orders.

Customer submissions are one-time. If a customer refreshes or clicks submit again, the app shows the already saved read-only confirmation instead of overwriting the choice. Links expire after the selected 24, 48, or 72 hour window, and staff can revoke a request so the link becomes unavailable.

## How Staff Use The App

### Standard Shopify substitution SMS

1. Log in with the staff password.
2. Open **Search Order**.
3. Search the exact Shopify order number, for example `1023` or `#1023`.
4. Confirm the customer details and SMS consent.
5. Select the unavailable order item.
6. Search for and select the substitute product.
7. Review or edit the SMS.
8. Send only after confirming the message is correct.

### Secure customer choice link

1. Search and load the Shopify order.
2. Select the unavailable item.
3. Search for approved substitute products.
4. Add up to three approved substitute choices to **Customer Substitution Request**.
5. Choose the expiry time, normally 48 hours.
6. Send the secure link SMS.
7. Open **Requests** later to see whether the customer opened or submitted their choices.
8. Review the customer's choice before manually updating the Shopify order.

If staff resend a request, the app creates a fresh secure link. Old response links stop working after the token is rotated, revoked, expired, or submitted.

### Manual physical-shop SMS

1. Use this only when the customer is not linked to a Shopify order.
2. Enter the phone number in international format, for example `+12125551234`.
3. Fill in the customer name, unavailable item, substitute item and reference.
4. Tick the permission checkbox only if the customer gave permission to receive the SMS.
5. Review and send the message.

### First Blob Write

After deploying with `MESSAGE_STORAGE_PROVIDER=netlify-blobs` and `BLOB_INIT_ENABLED=true`:

1. Log in to the app with the staff password.
2. In the browser console or an authenticated REST client, send:

```js
fetch("/api/admin/init-blobs", { method: "POST", credentials: "same-origin" }).then((r) => r.json())
```

3. Confirm the response includes the Blob store names.
4. Set `BLOB_INIT_ENABLED=false` in Netlify environment variables and redeploy.

The initialization endpoint is authenticated, idempotent, creates the default substitution template only when templates are empty, and does not overwrite existing data.

## Tests and Verification

```bash
npm ci
npm test
npm run build
npm audit --omit=dev
```

Credential scan before commit:

```bash
node scripts/credential-scan.js
```

For staff instructions, see [WAREHOUSE_MANUAL.md](WAREHOUSE_MANUAL.md).

Manual checks before real SMS:

1. Log in with the staff password.
2. Search an exact order number such as `1023` or `#1023`.
3. Confirm SMS consent badge is green.
4. Select an unavailable line item.
5. Confirm substitution suggestions load for that selected item.
6. Select a substitute with inventory.
7. Edit and copy the SMS.
8. Run a dry-run send.
9. Confirm duplicate warning appears on a repeated substitution.
10. Confirm message history records the dry run.

## Production Readiness Checklist

- `.env` is ignored by Git and real secrets are only in Netlify environment variables.
- `MESSAGE_STORAGE_PROVIDER=netlify-blobs` is set in Netlify.
- `BLOB_INIT_ENABLED=true` is used only for the first authenticated Blob initialization.
- `/api/admin/init-blobs` has been called once while logged in.
- `BLOB_INIT_ENABLED=false` is set after initialization.
- The Blob stores appear in Netlify after first writes.
- Dry-run sends persist in Sent Messages across redeploys.
- Duplicate-send protection works after a redeploy.
- `DRY_RUN` and `SMS_DRY_RUN` stay `true` until a manager approves one company-controlled live SMS test.

## Real SMS Rule

Do not activate real SMS sending until:

- Shopify order retrieval is tested.
- SMS consent validation is working.
- Duplicate prevention is working.
- Twilio verification is approved.
- A successful dry-run test is completed.
- One authorised test is sent only to a company-controlled phone number.
