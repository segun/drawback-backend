# Subscription Implementation Guide

Complete guide for implementing Android and iOS subscriptions with backend verification.

---

## Table of Contents

1. [Cross-Platform Subscription Behavior](#cross-platform-subscription-behavior)
2. [Product IDs Used in This App](#product-ids-used-in-this-app)
3. [Google Play Setup (Android)](#google-play-setup-android)
4. [App Store Connect Setup (iOS)](#app-store-connect-setup-ios)
5. [Backend Implementation](#backend-implementation)
6. [Flutter Integration Notes](#flutter-integration-notes)
7. [Testing](#testing)
8. [Production Checklist](#production-checklist)
9. [Common Issues](#common-issues)
10. [Support Links](#support-links)

---

## Cross-Platform Subscription Behavior

Subscriptions in this app are account-based, not device-based:

- User subscribes on Android -> has access on iOS, web, and other logged-in devices.
- User subscribes on iOS -> has access on Android, web, and other logged-in devices.
- Revenue belongs to the platform where the purchase happened.

Users still manage billing in the original store:

| Purchased On | Managed In |
|---|---|
| Android | Google Play |
| iOS | App Store |

Backend access should always be computed from subscription dates/status, not current platform:

```javascript
const hasDiscoveryAccess =
  user.subscription_end_date &&
  now < user.subscription_end_date &&
  user.subscription_status === 'active';
```

---

## Product IDs Used in This App

These values must match your store console setup and your backend validation logic.

From Flutter code in `lib/core/services/purchase_service.dart`:

- Android subscription product ID: `discovery_unlock_forever`
- iOS monthly product ID: `monthly`
- iOS quarterly product ID: `quarterly`
- iOS yearly product ID: `yearly`

### Important platform difference

- Android currently uses one subscription product ID in the client: `discovery_unlock_forever`
- iOS uses per-tier product IDs: `monthly`, `quarterly`, `yearly`

Use this mapping when receiving `/purchases/verify` requests:

| Platform | `productId` sent by Flutter | Typical meaning |
|---|---|---|
| Android | `discovery_unlock_forever` | Subscription product |
| iOS | `monthly` / `quarterly` / `yearly` | Purchased tier |

---

## Google Play Setup (Android)

### 1. Create or open app in Play Console

- Package name should match Android app id: `chat.drawback.flutter`

### 2. Upload build before configuring billing

Google requires an uploaded release before subscription products are fully usable.

```bash
flutter build appbundle --release
```

Upload to Play Console -> Internal testing.

### 3. Create subscription product

In Play Console -> Monetize -> Subscriptions:

- Subscription/Product ID: `discovery_unlock_forever`
- Name: Discovery Access
- Billing period(s): configure as needed
- Activate product

### 4. Service account and API access

1. Enable Google Play Android Developer API in Google Cloud.
2. Create service account key (JSON).
3. Grant service account Play Console permissions for subscriptions/orders.

### 5. Real-time Developer Notifications (RTDN)

Configure Pub/Sub topic + subscription and link it in Play Console Monetization setup.

---

## App Store Connect Setup (iOS)

### 1. Confirm app identifiers

- Bundle ID: `chat.drawback.flutter`
- Team ID: `QLNTY3GVPQ`

### 2. Create auto-renewable subscriptions

In App Store Connect -> Your App -> Monetization -> Subscriptions:

1. Create a subscription group (for example: `Discovery Access`).
2. Create products with IDs that match Flutter exactly:
   - `monthly`
   - `quarterly`
   - `yearly`
3. Configure pricing, duration, and localizations.
4. Submit required metadata for review.

### 3. Configure paid apps and agreements

- Complete Agreements, Tax, and Banking in App Store Connect.
- Ensure In-App Purchases capability is enabled for the iOS target.

### 4. Generate shared secret (if using verifyReceipt)

In App Store Connect -> App Information (or Users and Access -> Shared Secret):

- Create app-specific shared secret.
- Store as `APPLE_SHARED_SECRET` on backend.

### 5. Configure App Store Server Notifications V2

1. Add a secure backend endpoint, for example `POST /webhooks/apple/subscriptions`.
2. In App Store Connect -> App -> App Store Server Notifications:
   - Enter production URL.
   - Enter sandbox URL.
3. Validate notifications are signed and processed.

Decode and process in this order:

1. Verify and decode top-level `signedPayload`.
2. Verify nested `signedTransactionInfo` and `signedRenewalInfo` when present.
3. Use `notificationUUID` as idempotency key.
4. Apply state transitions in one transaction.

For the full list of iOS notification types, subtypes, and exact handling rules, see `docs/API_REFERENCE.md` in the section "iOS Notification Payload (App Store Server Notifications V2)".

---

## Backend Implementation

### Required environment variables

```bash
# Google Play
GOOGLE_APPLICATION_CREDENTIALS=/path/to/google-service-account.json
GOOGLE_PACKAGE_NAME=chat.drawback.flutter
GOOGLE_SUBSCRIPTION_ID=discovery_unlock_forever
GOOGLE_CLOUD_PROJECT_ID=your-project-id
GOOGLE_PUBSUB_SUBSCRIPTION=play-subscriptions-pull

# Apple App Store
APPLE_BUNDLE_ID=chat.drawback.flutter
APPLE_SHARED_SECRET=your-app-specific-shared-secret
# Required for App Store Server API JWT auth (webhook handling + re-verification):
APPLE_ISSUER_ID=your-issuer-id
APPLE_KEY_ID=your-key-id
APPLE_PRIVATE_KEY_PATH=/path/to/SubscriptionKey_KEYID.p8
```

Note:

- `APPLE_PRIVATE_KEY_PATH` is used for App Store Server API JWT authentication.
- It should point to your `SubscriptionKey` key, not `AuthKey`.
- All three JWT credentials are **required** for production webhook handling — the backend re-verifies renewal events with Apple's API (matching Android's resilience pattern) rather than trusting webhook data alone.
- Webhook signature verification uses Apple Root CA certificates (bundled) and does not require these credentials.

### Database fields

```sql
ALTER TABLE users ADD COLUMN subscription_platform VARCHAR(20);
ALTER TABLE users ADD COLUMN subscription_tier VARCHAR(20);
ALTER TABLE users ADD COLUMN subscription_status VARCHAR(20);
ALTER TABLE users ADD COLUMN subscription_start_date TIMESTAMP;
ALTER TABLE users ADD COLUMN subscription_end_date TIMESTAMP;
ALTER TABLE users ADD COLUMN subscription_auto_renew BOOLEAN;
ALTER TABLE users ADD COLUMN original_transaction_id VARCHAR(255);
ALTER TABLE users ADD COLUMN purchase_token TEXT;

CREATE INDEX idx_users_subscription_end ON users(subscription_end_date);
```

### Endpoint: `POST /purchases/verify`

Use a unified endpoint with platform switch.

```javascript
app.post('/purchases/verify', authenticateUser, async (req, res) => {
  const { platform, receipt, productId } = req.body;
  const userId = req.user.id;

  if (!platform || !receipt || !productId) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (platform === 'android') {
    // receipt = purchase token
    // productId from client is currently discovery_unlock_forever
    // verify via Google Play Developer API
    // update user subscription fields
  } else if (platform === 'ios') {
    // receipt = base64 app receipt
    // verify via Apple verifyReceipt endpoint or App Store Server API
    // use productId (monthly/quarterly/yearly) as tier
    // update user subscription fields
  } else {
    return res.status(400).json({ error: 'Unsupported platform' });
  }

  return res.json({ success: true });
});
```

### iOS receipt verification (verifyReceipt flow)

```javascript
async function verifyAppleReceipt(receiptData) {
  const body = {
    'receipt-data': receiptData,
    password: process.env.APPLE_SHARED_SECRET,
    'exclude-old-transactions': true,
  };

  // 1) Try production first
  let response = await fetch('https://buy.itunes.apple.com/verifyReceipt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

  // 2) If sandbox receipt sent to production, retry sandbox
  if (response.status === 21007) {
    response = await fetch('https://sandbox.itunes.apple.com/verifyReceipt', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => r.json());
  }

  if (response.status !== 0) {
    throw new Error(`Apple receipt invalid: status=${response.status}`);
  }

  return response;
}
```

Use fields from the latest transaction to update:

- `subscription_platform = 'ios'`
- `subscription_tier = productId` (`monthly|quarterly|yearly`)
- `original_transaction_id = original_transaction_id`
- `subscription_end_date = expires_date_ms`

### Webhook listeners

Run both listeners in production:

- Google RTDN (Pub/Sub)
- Apple App Store Server Notifications V2 (HTTPS)

Both should update the same subscription columns for consistency.

---

## Flutter Integration Notes

Current Flutter behavior in `lib/core/services/purchase_service.dart`:

- Android purchase queries one product ID: `discovery_unlock_forever`
- iOS purchase queries tier IDs: `monthly`, `quarterly`, `yearly`
- Receipt payload sent to backend:
  - `platform`: `android` or `ios`
  - `receipt`: `purchase.verificationData.serverVerificationData`
  - `productId`: selected store product ID

Keep backend parsing aligned with this exact contract.

### iOS Receipt Formats (Both Supported)

The backend now supports **both** legacy and modern iOS receipt verification:

✅ **Option 1: App Store Receipt (Legacy/PKCS#7)** — Recommended for now
```dart
final receipt = purchaseDetails.verificationData.serverVerificationData;
```
- Base64-encoded PKCS#7 container, typically 3000+ chars, starts with `MII`
- Uses Apple's `verifyReceipt` API
- Works with all StoreKit versions

✅ **Option 2: StoreKit 2 JWS Transaction (Modern)**
```dart
final receipt = transaction.jwsRepresentation; // StoreKit 2 only
```
- JWT/JWS token, starts with `eyJ`, contains dots (`.`)
- Uses Apple's App Store Server Library for signature verification
- More efficient (~5KB vs ~30KB), but requires StoreKit 2

**Migration Path:**
- Short term: Use Option 1 (App Store receipt) — it's well-tested
- Long term: Migrate to Option 2 (StoreKit 2 JWS) as you adopt StoreKit 2 in Flutter

The backend will auto-detect which format was sent and route accordingly.

### Restore purchases

- `restorePurchases()` is platform-native.
- Always refresh user profile after restore and trust backend `hasDiscoveryAccess`.

---

## Testing

### Android (Play Internal Testing)

1. Upload release AAB to Internal testing.
2. Add license testers.
3. Install from Play internal test link.
4. Purchase and verify:
   - app calls `/purchases/verify`
   - backend updates subscription fields
   - `/users/me` returns `hasDiscoveryAccess: true`
5. Verify RTDN renewal/cancel behavior.

### iOS (Sandbox / TestFlight)

1. Create sandbox tester account in App Store Connect.
2. Install TestFlight build.
3. Sign in with sandbox account when prompted during purchase.
4. Test each iOS product ID (`monthly`, `quarterly`, `yearly`).
5. Verify backend Apple receipt validation and DB updates.
6. Validate App Store Server Notifications handling for renew/expire.

### Cross-platform checks

- Subscribe on Android -> sign in on iOS -> access is enabled.
- Subscribe on iOS -> sign in on Android -> access is enabled.
- Subscription management links point to original purchase platform.

---

## Production Checklist

- [ ] Android Play product `discovery_unlock_forever` is active.
- [ ] iOS products `monthly`, `quarterly`, `yearly` are approved.
- [ ] Backend supports both `platform=android` and `platform=ios`.
- [ ] Apple shared secret configured securely.
- [ ] Google service account + API permissions verified.
- [ ] Google RTDN worker is running.
- [ ] Apple Server Notifications endpoint is running.
- [ ] `hasDiscoveryAccess` computed from expiry/status only.
- [ ] Purchase and restore flows tested on real store distributions.
- [ ] Monitoring/alerts for verification and webhook failures in place.

---

## Common Issues

### iOS receipt fails with `21007`

Cause: Sandbox receipt sent to production endpoint.

Fix: Retry on sandbox verifyReceipt endpoint.

### iOS products not found

Cause: Product IDs in App Store Connect do not match Flutter constants.

Fix: Ensure exact IDs: `monthly`, `quarterly`, `yearly`.

### Android product not found

Cause: App installed locally instead of Play internal testing build.

Fix: Install using Play testing track link.

### Restore succeeds in store but app still locked

Cause: Backend verification or profile refresh did not complete.

Fix: Re-run `/purchases/verify`, then refresh `/users/me`.

---

## Support Links

- Google Play subscriptions: https://developer.android.com/google/play/billing/subscriptions
- Google Play Developer API: https://developers.google.com/android-publisher/api-ref/rest/v3/purchases.subscriptions
- Google RTDN reference: https://developer.android.com/google/play/billing/rtdn-reference
- App Store subscriptions: https://developer.apple.com/app-store/subscriptions/
- Apple verifyReceipt: https://developer.apple.com/documentation/appstorereceipts/verifyreceipt
- App Store Server Notifications V2: https://developer.apple.com/documentation/appstoreservernotifications
