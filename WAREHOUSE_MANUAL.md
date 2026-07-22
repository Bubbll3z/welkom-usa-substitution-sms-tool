# Welkom USA SMS App - Warehouse Worker Guide

This app helps staff send a safe substitution SMS when a customer ordered an item that cannot be sent.

## Before You Start

Use this app only for Welkom USA customer messages.

Only send an SMS when:

- The customer has a valid phone number.
- The app shows SMS consent, or you are using Manual physical-shop SMS and the customer gave permission.
- You have checked the unavailable item and selected the correct substitute.
- The message still says `Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.`

Do not use this app for marketing messages.

## Log In

1. Open the Welkom USA SMS app link.
2. Enter the staff password.
3. Click **Log in**.

If login fails, ask a manager to check the staff password in Netlify.

## Send a Shopify Order Substitution SMS

1. Click **Search Order**.
2. Type the Shopify order number, for example `1023` or `#1023`.
3. Click **Search**.
4. Check the customer details.
5. Make sure the app does not show a red SMS consent warning.
6. Under **Unavailable Item**, select the product that cannot be sent.
7. Under **Substitution Options**, search for the replacement product.
8. Select the correct substitute.
9. Read the SMS on the right side carefully.
10. Edit the message only if needed.
11. Click **Send SMS**.

The normal message format is:

```text
Welkom USA: Hi [FIRST NAME], [UNAVAILABLE ITEM] in order #[ORDER NUMBER] is unavailable. We can substitute it with [SUBSTITUTE ITEM]. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.
```

## Manual Physical-Shop SMS

Use Manual physical-shop SMS when the customer is not linked to a Shopify order, for example someone who bought in the physical shop.

1. Go to **Search Order**.
2. Open **Manual physical-shop SMS** in the substitution message area.
3. Enter the customer phone number in international format, for example `+12125551234`.
4. Add the customer first name if you know it.
5. Add the unavailable item.
6. Add the substitute item.
7. Add a short reference, such as a till slip number or staff note.
8. Tick the permission checkbox only if the customer gave permission to receive the SMS.
9. Read the message.
10. Click **Send Manual SMS**.

Never tick the permission checkbox if the customer did not agree to receive the message.

## If the App Blocks Sending

The app may block sending for safety. This is normal.

Common reasons:

- **No SMS Consent**: Do not send an SMS. If the customer has an email address, email them instead.
- **Missing phone number**: Use email or contact a manager.
- **Phone number must start with +**: The number must be in international format.
- **Message too long**: Shorten the message.
- **Duplicate warning**: A similar message may already have been sent recently. Check **Sent Messages** before sending again.
- **Dry run mode**: The app is testing only and did not send a real SMS.

## Check Sent Messages

1. Click **Sent Messages**.
2. Search by order number, staff name, status, or message text.
3. Check whether the message was dry-run, sent, failed, or updated by Twilio.

Phone numbers are partly hidden for customer privacy.

## Templates

Managers can use **Templates** to keep the standard substitution message ready.

Warehouse staff should normally use the default template and only make small edits when needed.

## Settings

Use **Settings** to check whether the app is ready.

Green means configured or working.
Red means something needs attention.

Important statuses:

- **Dry run mode**: If this says Dry run, real SMS messages are not being sent.
- **Production sending**: If this says Blocked, real SMS sending is off.
- **Storage health**: If this says Needs init, ask a manager to initialize Blob storage.
- **Twilio sender**: If this is not configured, SMS sending will not work.
- **Shopify store**: If this is not configured, order search will not work.

## Safety Rules

- Do not send test messages to customers.
- Do not change the STOP wording.
- Do not send the same substitution twice unless a manager confirms it.
- Do not copy customer phone numbers into other tools.
- Ask a manager before sending a real SMS if anything looks wrong.

