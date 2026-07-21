# Welkom USA Substitution SMS Tool

This is a Netlify-ready internal tool for Welkom USA staff.

Staff can:

1. Search a Shopify order number.
2. View customer details and order items.
3. Select the unavailable item.
4. Select a suggested substitution product or search Shopify by title, SKU, or barcode.
5. Review or edit the substitution SMS.
6. Send the SMS through Twilio.

## Design Overview

The app uses a Welkom USA internal dashboard layout:

- Fixed desktop sidebar with Search Order, Dashboard, Sent Messages, Templates, Settings, Backup, and Logout.
- White header with the Substitution SMS title, Sent Messages shortcut, and Welkom USA user area.
- Two-column desktop workflow: order/customer details on the left and the editable SMS message on the right.
- Responsive tablet/mobile layout with a drawer sidebar and stacked cards.
- Live character count, estimated SMS segments, message preview, token insertion, copy action, send confirmation, duplicate-send warning, and local message history.

## Message Template

```text
Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.
```

## Local Setup

```bash
npm install
copy .env.example .env
npm run dev
```

The local dev server serves the static frontend and Netlify-style API routes.

For safe testing, keep:

```env
DRY_RUN=true
SMS_DRY_RUN=true
```

## Netlify Deployment

Connect this folder to Netlify:

```text
welkom-substitution-sms-tool
```

Netlify settings:

```text
Build command: npm run build
Publish directory: public
Functions directory: netlify/functions
```

The existing `netlify.toml` contains the same settings and redirects `/api/*` requests to the Netlify Function.

## Required Netlify Environment Variables

Add these in Netlify, not in source code:

```env
STAFF_PASSWORD=
DRY_RUN=true
SMS_DRY_RUN=true
SHOPIFY_SHOP_DOMAIN=welkom-usa.myshopify.com
SHOPIFY_ADMIN_ACCESS_TOKEN=
SHOPIFY_API_VERSION=2026-07
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
TWILIO_FROM_NUMBER=
TWILIO_MESSAGING_SERVICE_SID=
```

Use either `TWILIO_PHONE_NUMBER` / `TWILIO_FROM_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`.

## Shopify Custom App

Create a custom app in Welkom USA Shopify Admin.

Minimum Admin API scopes:

```text
read_orders
read_products
```

Possible additional scope if Shopify does not return phone/customer details:

```text
read_customers
```

Shopify may require protected customer data configuration before customer phone numbers are returned.

Product substitution search uses the Admin API server-side only. Staff can search by product title, SKU, or barcode from the dashboard; no Shopify token is exposed to the browser.

Steps:

1. Shopify Admin -> Settings.
2. Apps and sales channels.
3. Develop apps.
4. Create an app.
5. Name it `Welkom USA SMS Tool`.
6. Configure Admin API scopes above.
7. Install the app.
8. Copy the Admin API access token.
9. Add it to Netlify as `SHOPIFY_ADMIN_ACCESS_TOKEN`.

Do not paste the token into chat or commit it.

## Safe Twilio Test

First deploy with:

```env
DRY_RUN=true
SMS_DRY_RUN=true
```

Then:

1. Search a test order.
2. Select an unavailable item.
3. Select a substitute item.
4. Click Send SMS.
5. Confirm the app says dry-run successful.

Only after that, and only with your own/company phone number:

```env
DRY_RUN=false
SMS_DRY_RUN=false
```

Send one real test SMS.

For Twilio toll-free numbers, make sure the number is verified/approved before real sending. Keep the first real test to your own or company-approved phone number.

## Tests

```bash
npm test
npm run build
```

## Safety Notes

- Shopify and Twilio credentials stay server-side in Netlify environment variables.
- The frontend never receives API tokens.
- Dry-run is enabled by default.
- Phone numbers are redacted in API responses where practical.
- The app does not modify Shopify products, inventory, fulfilments, customers, orders, or themes.
