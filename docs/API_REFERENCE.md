# API Reference - Subscription Endpoints

Quick reference for request/response formats for Android and iOS subscription flows.

---

## POST /purchases/verify

Verify a store receipt/token and activate or update user subscription.

### Request from Flutter (Android)

```json
{
  "platform": "android",
  "receipt": "abcdefghijklmnop.AO-J1OxYZ123...",
  "productId": "discovery_unlock_forever"
}
```

### Request from Flutter (iOS)

```json
{
  "platform": "ios",
  "receipt": "MIIUVQYJKoZIhvcNAQcCoIIURjCCFEICAQEx...",
  "productId": "monthly"
}
```

### Field details

- `platform`: `android` or `ios`
- `receipt`:
  - Android: Google purchase token from `serverVerificationData`
  - iOS: **Either** App Store receipt (PKCS#7, starts with `MII`) **or** StoreKit 2 JWS transaction (starts with `eyJ`) from `serverVerificationData`
- `productId`:
  - Android: `discovery_unlock_forever`
  - iOS: `monthly`, `quarterly`, or `yearly`

**iOS Receipt Formats (Both Supported):**
- **Legacy**: App Store receipt (base64-encoded PKCS#7, ~3000+ chars, starts with `MII`) — uses Apple's `verifyReceipt` API
- **Modern**: StoreKit 2 JWS transaction signature (JWT format, starts with `eyJ`) — uses Apple's signature verification library

The backend auto-detects which format was sent and routes to the appropriate verification flow.

### Success response

```json
{
  "success": true,
  "subscription": {
    "tier": "monthly",
    "platform": "ios",
    "startDate": "2026-03-14T10:30:00.000Z",
    "endDate": "2026-04-14T10:30:00.000Z",
    "autoRenew": true
  }
}
```

### Failure response

```json
{
  "success": false,
  "error": "Verification failed",
  "details": "Invalid or expired receipt"
}
```

---

## GET /users/me

Get current user profile and effective subscription access.

### Response example

```json
{
  "id": "user123",
  "email": "user@example.com",
  "displayName": "John Doe",
  "hasDiscoveryAccess": true,
  "subscription": {
    "tier": "monthly",
    "platform": "ios",
    "endDate": "2026-04-14T10:30:00.000Z",
    "autoRenew": true
  }
}
```

### Access computation

```javascript
hasDiscoveryAccess =
  (now < subscription_end_date) &&
  (subscription_status === 'active');
```

Access is platform-independent. A user subscribed on Android should still have access when logged in on iOS, and vice versa.

---

## POST /purchases/mock-unlock

Development-only endpoint to simulate access.

### Response

```json
{
  "success": true
}
```

Only available when running in development mode.

---

## Android Notification Payload (Google RTDN)

Delivered via Pub/Sub.

```json
{
  "version": "1.0",
  "packageName": "chat.drawback.flutter",
  "eventTimeMillis": "1710412200000",
  "subscriptionNotification": {
    "version": "1.0",
    "notificationType": 2,
    "purchaseToken": "abcdefghijklmnop.AO-J1OxYZ123...",
    "subscriptionId": "discovery_unlock_forever"
  }
}
```

Common `notificationType` values:

| Code | Meaning | Typical backend action |
|---|---|---|
| 2 | SUBSCRIPTION_RENEWED | update `subscription_end_date`, status `active` |
| 3 | SUBSCRIPTION_CANCELED | set `subscription_auto_renew = false`, status `cancelled` |
| 6 | SUBSCRIPTION_IN_GRACE_PERIOD | status `grace_period` |
| 12 | SUBSCRIPTION_REVOKED | status `revoked`, remove access |
| 13 | SUBSCRIPTION_EXPIRED | status `expired` |

---

## iOS Notification Payload (App Store Server Notifications V2)

Delivered via HTTPS webhook as signed JWS payload.

### Top-level example

```json
{
  "signedPayload": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

After decoding/validating `signedPayload`, payload contains fields like:

```json
{
  "notificationType": "DID_RENEW",
  "subtype": "",
  "data": {
    "bundleId": "chat.drawback.flutter",
    "environment": "Sandbox",
    "signedTransactionInfo": "...",
    "signedRenewalInfo": "..."
  }
}
```

### How to decode the iOS notification payload (debug only)

You can inspect a JWS payload without verifying it for local debugging:

```ts
function decodeJwsPayloadUnsafe(signedJws: string): unknown {
  const parts = signedJws.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWS format');
  }
  return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
}
```

Do not trust this decoded data for entitlement decisions until signature verification succeeds.

### How to verify and decode in production (required)

Use Apple App Store Server Library to verify:

1. Verify and decode top-level `signedPayload`.
2. Verify and decode nested `data.signedTransactionInfo` (if present).
3. Verify and decode nested `data.signedRenewalInfo` (if present).
4. Deduplicate by `notificationUUID` before applying updates.

```ts
import fs from 'node:fs';
import express from 'express';
import {
  Environment,
  SignedDataVerifier,
} from '@apple/app-store-server-library';

const app = express();
app.use(express.json());

const appleRootCAs: Buffer[] = [
  fs.readFileSync('./certs/AppleRootCA-G3.cer'),
];

const environment = process.env.APPLE_ENV === 'production'
  ? Environment.PRODUCTION
  : Environment.SANDBOX;

const verifier = new SignedDataVerifier(
  appleRootCAs,
  true,
  environment,
  process.env.APPLE_BUNDLE_ID!,
  process.env.APPLE_APP_ID ? Number(process.env.APPLE_APP_ID) : undefined,
);

app.post('/webhooks/apple/subscriptions', async (req, res) => {
  try {
    const signedPayload = req.body?.signedPayload;
    if (!signedPayload) {
      return res.status(400).json({ error: 'Missing signedPayload' });
    }

    const notification = await verifier.verifyAndDecodeNotification(signedPayload);
    const transaction = notification.data?.signedTransactionInfo
      ? await verifier.verifyAndDecodeTransaction(notification.data.signedTransactionInfo)
      : undefined;
    const renewal = notification.data?.signedRenewalInfo
      ? await verifier.verifyAndDecodeRenewalInfo(notification.data.signedRenewalInfo)
      : undefined;

    // Idempotency: store notificationUUID and ignore duplicates.
    // Apply state transition based on notificationType + subtype.
    // Use transaction/renewal fields to set expiry, product, auto-renew, etc.

    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(400).json({ error: 'Invalid signed payload' });
  }
});
```

### ABC123 processing order for backend handlers

- A: Authenticate payload (signature + bundle id + environment checks).
- B: Build normalized event from notification + decoded transaction/renewal data.
- C: Commit atomically with idempotency key = `notificationUUID`.
- 1: Update status (`active`, `grace_period`, `expired`, `revoked`, etc.).
- 2: Update dates and renewal flags (`subscription_end_date`, `subscription_auto_renew`).
- 3: Return HTTP `200` quickly after durable write.

### Full `notificationType` list (App Store Server Notifications V2)

| notificationType | Description | Suggested backend action |
|---|---|---|
| SUBSCRIBED | New or returning auto-renewable subscriber | Set `active`, store tier/product, set expiry |
| DID_CHANGE_RENEWAL_PREF | User changed plan preference in same subscription group | Update planned tier change metadata |
| DID_CHANGE_RENEWAL_STATUS | Auto-renew toggled on/off | Update `subscription_auto_renew` |
| OFFER_REDEEMED | Offer redeemed for active subscription | Record offer usage and effective product |
| DID_RENEW | Subscription renewed successfully | Extend `subscription_end_date`, set `active` |
| EXPIRED | Subscription expired | Set `expired` and remove paid access |
| DID_FAIL_TO_RENEW | Renewal failed and entered billing retry | Set `billing_retry` or `grace_period` |
| GRACE_PERIOD_EXPIRED | Grace period ended without recovery | Remove access unless recovered later |
| PRICE_INCREASE | Price increase notification/consent state | Store consent state for support/audit |
| REFUND | Refund granted | Set `revoked` and revoke entitlement |
| REFUND_DECLINED | Refund request declined | Keep entitlement unchanged |
| CONSUMPTION_REQUEST | Apple requests consumption data for refund flow | Send consumption data if supported |
| RENEWAL_EXTENDED | A specific subscription renewal date was extended | Update expiry from transaction data |
| RENEWAL_EXTENSION | Bulk renewal extension progress/result | Handle `SUMMARY` or `FAILURE` payload |
| REVOKE | Family Sharing entitlement revoked | Recompute entitlement and revoke if needed |
| TEST | Test notification from App Store Connect | Log and return `200` |
| REFUND_REVERSED | Previously granted refund reversed | Reinstate entitlement if applicable |
| EXTERNAL_PURCHASE_TOKEN | External Purchase token lifecycle event | Store/report token state (if used) |
| ONE_TIME_CHARGE | Non-subscription purchase event | Ignore for subscription entitlement, or route to one-time handler |
| RESCIND_CONSENT | Child account consent rescinded | Restrict access according to policy |
| METADATA_UPDATE | Advanced Commerce metadata update event | Sync metadata if using Advanced Commerce API |
| MIGRATION | Advanced Commerce migration event | Handle migration reconciliation |
| PRICE_CHANGE | Advanced Commerce price change event | Sync price change metadata |

### Full `subtype` list and where each applies

| subtype | Applies to notificationType | Meaning |
|---|---|---|
| INITIAL_BUY | SUBSCRIBED | First-time subscription purchase/family access |
| RESUBSCRIBE | SUBSCRIBED | User subscribed again after expiration |
| DOWNGRADE | DID_CHANGE_RENEWAL_PREF, OFFER_REDEEMED | Changed to lower plan/effective next renewal |
| UPGRADE | DID_CHANGE_RENEWAL_PREF, OFFER_REDEEMED | Changed to higher plan/effective immediately |
| AUTO_RENEW_ENABLED | DID_CHANGE_RENEWAL_STATUS | Auto-renew turned on |
| AUTO_RENEW_DISABLED | DID_CHANGE_RENEWAL_STATUS | Auto-renew turned off |
| VOLUNTARY | EXPIRED | Expired because user disabled auto-renew |
| BILLING_RETRY | EXPIRED | Expired after billing retry window ended |
| PRICE_INCREASE | EXPIRED | Expired due to required price consent not granted |
| GRACE_PERIOD | DID_FAIL_TO_RENEW | Renewal failed, but grace period is active |
| PENDING | PRICE_INCREASE | Price consent required, user has not responded |
| ACCEPTED | PRICE_INCREASE | User accepted price increase (or consent not required) |
| BILLING_RECOVERY | DID_RENEW | Recovered from previous billing failure |
| PRODUCT_NOT_FOR_SALE | EXPIRED | Product unavailable during renewal |
| SUMMARY | RENEWAL_EXTENSION | Bulk extension completed summary payload |
| FAILURE | RENEWAL_EXTENSION | Bulk extension failed for a subscription |
| CREATED | EXTERNAL_PURCHASE_TOKEN | External purchase token created |
| ACTIVE_TOKEN_REMINDER | EXTERNAL_PURCHASE_TOKEN | Token still active reminder |
| UNREPORTED | EXTERNAL_PURCHASE_TOKEN | Token created but not yet reported |

Many notifications may also arrive with an empty subtype.

---

## Apple verifyReceipt Response (iOS)

If you use the verifyReceipt API, backend posts receipt data to Apple and parses:

```json
{
  "status": 0,
  "environment": "Sandbox",
  "latest_receipt_info": [
    {
      "product_id": "monthly",
      "original_transaction_id": "1000001234567890",
      "transaction_id": "1000001234567999",
      "expires_date_ms": "1713004200000"
    }
  ],
  "pending_renewal_info": [
    {
      "product_id": "monthly",
      "auto_renew_status": "1"
    }
  ]
}
```

Key status codes:

| Status | Meaning |
|---|---|
| 0 | Valid receipt |
| 21007 | Sandbox receipt sent to production endpoint |
| 21008 | Production receipt sent to sandbox endpoint |

---

## Google Play Subscription API Response (Android)

`androidPublisher.purchases.subscriptions.get()` returns fields similar to:

```json
{
  "startTimeMillis": "1710412200000",
  "expiryTimeMillis": "1713004200000",
  "autoRenewing": true,
  "paymentState": 1,
  "orderId": "GPA.1234-5678-9012-34567"
}
```

Useful fields:

- `expiryTimeMillis` -> `subscription_end_date`
- `autoRenewing` -> `subscription_auto_renew`
- `orderId` -> `original_transaction_id`

---

## ID Mapping Reference

| Context | Android value | iOS value |
|---|---|---|
| Store product IDs in Flutter | `discovery_unlock_forever` | `monthly`, `quarterly`, `yearly` |
| `productId` sent to `/purchases/verify` | `discovery_unlock_forever` | one of tier IDs |
| Database `subscription_tier` | backend-defined tier mapping | `monthly`/`quarterly`/`yearly` |
| Database `original_transaction_id` | Google `orderId` | Apple `original_transaction_id` |

---

## Environment Variables

```bash
# Google Play
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
GOOGLE_PACKAGE_NAME=chat.drawback.flutter
GOOGLE_SUBSCRIPTION_ID=discovery_unlock_forever
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_PUBSUB_SUBSCRIPTION=play-subscriptions-pull

# Apple App Store
APPLE_BUNDLE_ID=chat.drawback.flutter
APPLE_SHARED_SECRET=your-app-specific-shared-secret
# Required for webhook handling and API re-verification:
APPLE_ISSUER_ID=your-issuer-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY_PATH=/path/to/SubscriptionKey_KEYID.p8
```

`APPLE_PRIVATE_KEY_PATH` should use your `SubscriptionKey` key. All three JWT auth credentials are required for production webhook handling — the backend re-verifies renewal events with Apple's API (matching Android's resilience pattern) rather than trusting webhook data alone.

---

## Database Schema

```sql
subscription_platform        VARCHAR(20)   -- android, ios, mock
subscription_tier            VARCHAR(20)   -- monthly, quarterly, yearly, etc.
subscription_status          VARCHAR(20)   -- active, cancelled, expired, grace_period, revoked
subscription_start_date      TIMESTAMP
subscription_end_date        TIMESTAMP
subscription_auto_renew      BOOLEAN
original_transaction_id      VARCHAR(255)  -- Google orderId or Apple original_transaction_id
purchase_token               TEXT          -- Google token or raw receipt reference
```

---

## Common Error Responses

### 401 Unauthorized

```json
{
  "error": "No authentication token provided"
}
```

### 400 Bad Request

```json
{
  "error": "Missing required field: receipt"
}
```

### 403 Forbidden

```json
{
  "error": "DISCOVERY_LOCKED",
  "message": "Active subscription required for discovery access",
  "code": "SUBSCRIPTION_REQUIRED"
}
```

### 500 Internal Server Error

```json
{
  "success": false,
  "error": "Verification failed",
  "details": "Unable to verify purchase with store provider"
}
```
