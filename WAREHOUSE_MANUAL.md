# Welkom USA SMS App - Warehouse Worker Guide

This app helps staff send substitution SMS messages when an ordered item cannot be sent. It is for Welkom USA customer-service messages only.

## The Golden Rules

- Only send an SMS when the app shows consent, or when the customer gave permission in person for a manual physical-shop message.
- Always check the order number, customer name, unavailable item and substitute before sending.
- Keep the `Reply STOP to opt out` wording in the SMS.
- Do not use this app for marketing.
- Do not send test messages to real customers.

## Log In

1. Open the Welkom USA SMS app.
2. Enter your username.
3. Enter your password.
4. Click **Log In**.
5. Only tick **Remember me** on an approved warehouse computer.

If login fails, ask a manager to reset your password or check that your user is active.

## Main Menu

After login you will see the menu.

- **Send Substitution SMS**: search an order, choose items and send a replacement message.
- **View Replies**: read customer SMS replies that came back to Twilio.
- **Message History**: check dry-run and real SMS history.
- **Custom Message**: send an approved one-off SMS to a customer who gave permission.
- **Logout**: sign out when you are done.

Managers may also see admin options such as settings, users, templates and backup.

## Send a Shopify Order Substitution SMS

Use this for Shopify orders.

1. Click **Send Substitution SMS**.
2. In **Step 1**, enter the Shopify order number, for example `1023` or `#1023`.
3. Click **Search Order**.
4. Check the customer and order summary.
5. If the app says **No SMS consent**, do not send an SMS. Use email if an email address is shown.
6. Click **Continue to Items**.
7. In **Step 2**, tick each item that is unavailable.
8. For each selected item, search for the substitute by title, SKU or barcode.
9. Select the correct substitute, or type a custom substitute if Shopify does not show it.
10. If no substitute is available, tick **No substitute available**.
11. Click **Review Message**.
12. In **Step 3**, read the SMS carefully.
13. Edit only what is needed.
14. Click **Send SMS**.
15. Confirm the send popup.

Standard SMS example:

```text
Welkom USA: Hi Sarah, Cadbury Astros 40g in order #1023 is unavailable. We can substitute it with Cadbury Flake 32g. Reply SUBSTITUTE to approve or REFUND for a refund. Reply STOP to opt out.
```

## Manual Physical-Shop SMS

Use this when the customer is not linked to a Shopify order, for example a physical-shop customer.

1. Open **Send Substitution SMS**.
2. Choose **Manual physical-shop SMS**.
3. Enter the phone number in international format, for example `+12125551234`.
4. Add the customer's first name if you know it.
5. Add a reference, such as a till slip number.
6. Tick the permission checkbox only if the customer gave permission.
7. Add the unavailable item and substitute.
8. Review the message.
9. Send and confirm.

Never tick the permission box if the customer did not agree.

## View Replies

1. Click **View Replies**.
2. New replies appear at the top.
3. Open a reply to read the full customer message.
4. Mark it reviewed after staff have handled it.
5. If the customer replied `STOP`, do not send more non-essential SMS messages to that number.

## Message History

Use **Message History** to check if a message was:

- dry-run only
- sent
- failed
- blocked as a duplicate
- updated by Twilio delivery status

Phone numbers are masked for privacy.

## Custom Message

Use **Custom Message** only for simple approved customer-service texts.

1. Enter the approved phone number.
2. Add a reference.
3. Confirm the customer gave permission.
4. Type a clear Welkom USA message.
5. Send and confirm.

The app blocks blank messages, bad phone numbers, missing permission and repeated rapid sends.

## What Red Messages Mean

- **No SMS consent**: Do not send SMS from the order workflow. Email the customer if possible.
- **Missing phone number**: Ask a manager or use email.
- **Phone number invalid**: Use international format starting with `+`.
- **Message too long**: Shorten the SMS.
- **Duplicate warning**: Check history before sending again.
- **Dry run**: The app tested the flow but did not send a real SMS.
- **Request failed**: Refresh once. If it still fails, show the manager the exact error text.

## End of Shift

Click **Logout** when you are finished, especially on any shared computer.
