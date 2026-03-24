# Backend Push Notifications Integration Guide

## Objective
Implement server-side push delivery for incoming draw requests so users receive audible/vibration alerts when the app is backgrounded or terminated.

This guide is the backend contract for mobile clients using Firebase Cloud Messaging (FCM) on Android and iOS.

## Delivery Model
1. Existing real-time behavior stays unchanged: backend emits `chat.requested` over socket.
2. New behavior: for the same request event, backend also sends one FCM push to all active recipient device tokens.
3. Client dedupe prevents duplicate foreground alerts between socket and push.

## Mobile Contract
Current mobile implementation expects these token endpoints:
1. `POST /notifications/tokens`
2. `POST /notifications/tokens/deactivate`

If backend wants different paths, mobile must be updated in [lib/core/services/push_token_registration_api.dart](../lib/core/services/push_token_registration_api.dart).

### Register Token Endpoint
`POST /notifications/tokens`

Auth:
1. Required: `Authorization: Bearer <accessToken>`

Request body:
```json
{
  "provider": "fcm",
  "token": "<fcm-token>",
  "platform": "ios|android",
  "deviceId": "<stable-device-id>"
}
```

Response:
1. `2xx` with empty body is acceptable.
2. Non-2xx should include JSON `{ "message": "..." }`.

Idempotency:
1. Repeated register calls for same `(userId, token)` must be safe.
2. Upsert is preferred.

### Deactivate Token Endpoint
`POST /notifications/tokens/deactivate`

Auth:
1. Required: `Authorization: Bearer <accessToken>`

Request body:
```json
{
  "provider": "fcm",
  "token": "<fcm-token>"
}
```

Response:
1. `2xx` with empty body is acceptable.
2. Endpoint must be idempotent.

## Data Model
Suggested table: `push_tokens`

Required columns:
1. `id` (uuid)
2. `user_id` (uuid, indexed)
3. `provider` (enum/string, currently `fcm`)
4. `token` (text, unique or unique with provider)
5. `platform` (`ios` or `android`)
6. `device_id` (text)
7. `active` (boolean, default true)
8. `last_seen_at` (timestamp)
9. `created_at` (timestamp)
10. `updated_at` (timestamp)

Recommended indexes:
1. Unique index on `(provider, token)`
2. Index on `(user_id, active)`

Cardinality:
1. One user can have many active tokens.
2. One token belongs to one active user binding at a time.

## Push Trigger Pipeline
Trigger point:
1. At the same backend point where recipient socket emit `chat.requested` is produced.

Target selection:
1. Load all active tokens for the recipient user.
2. Send to all active tokens.

### FCM Transport and Authentication
Backend sends push messages to Firebase Cloud Messaging HTTP v1 API.

FCM endpoint:
1. `POST https://fcm.googleapis.com/v1/projects/<firebase-project-id>/messages:send`

Request wrapper shape:
1. Send your payload as the `message` object in the request body:

```json
{
  "message": {
    "token": "<device-token>",
    "notification": {
      "title": "New request",
      "body": "<senderName> sent you a draw request"
    },
    "data": {
      "schemaVersion": "1",
      "type": "request_received",
      "requestId": "<request-id>",
      "senderName": "<display-name>",
      "route": "pending_request",
      "messageId": "<stable-message-id>"
    },
    "android": {
      "priority": "high"
    },
    "apns": {
      "headers": {
        "apns-priority": "10"
      },
      "payload": {
        "aps": {
          "sound": "default",
          "content-available": 1
        }
      }
    }
  }
}
```

Auth header:
1. `Authorization: Bearer <google-oauth2-access-token>`
2. `Content-Type: application/json`

Required OAuth scope:
1. `https://www.googleapis.com/auth/firebase.messaging`

### Service Account: Where to Get It
You need Google service account credentials with permission to send FCM messages for the Firebase project.

Option A (recommended for servers in GCP): Workload Identity / default credentials
1. Create a service account in Google Cloud for your backend workload.
2. Grant role `Firebase Cloud Messaging API Admin` on the Firebase project.
3. Run backend with Application Default Credentials attached to that service account.
4. Do not store a JSON key file in source control.

Option B (non-GCP or local backend): Service account JSON key
1. Open Google Cloud Console for the Firebase project.
2. Go to IAM & Admin, then Service Accounts.
3. Create or select a service account dedicated to push sending.
4. Grant role `Firebase Cloud Messaging API Admin`.
5. Create key, choose JSON, and download once.
6. Store this JSON in your secret manager (not in repo), then load it at runtime.

Token minting flow:
1. Use Google Auth library in your backend language.
2. Request an access token for scope `https://www.googleapis.com/auth/firebase.messaging`.
3. Refresh token automatically before expiry and reuse across send calls.

Pre-flight checklist:
1. Firebase project id used in URL matches app's Firebase project.
2. FCM API is enabled in Google Cloud project.
3. Service account role is sufficient and bound to correct project.
4. Backend clock is synchronized (OAuth tokens are time-sensitive).

Payload contract (message object):
```json
{
  "token": "<device-token>",
  "notification": {
    "title": "New request",
    "body": "<senderName> sent you a draw request"
  },
  "data": {
    "schemaVersion": "1",
    "type": "request_received",
    "requestId": "<request-id>",
    "senderName": "<display-name>",
    "route": "pending_request",
    "messageId": "<stable-message-id>"
  },
  "android": {
    "priority": "high"
  },
  "apns": {
    "headers": {
      "apns-priority": "10"
    },
    "payload": {
      "aps": {
        "sound": "default",
        "content-available": 1
      }
    }
  }
}
```

## Dedupe Contract
1. Backend must generate stable `messageId` per request notification.
2. Mobile dedupe order:
3. Use `messageId` if present.
4. Fallback to `requestId`.
5. Apply short TTL cache (client-side).

## Error Handling and Retries
Send failures:
1. Retry transient provider/network errors with bounded exponential backoff.
2. Do not block the primary request flow if push fails.

Token invalidation:
1. On invalid/unregistered token responses, mark token inactive immediately.
2. Keep audit trail for token deactivation reason.

## Security Requirements
1. Token endpoints require user auth.
2. Backend must bind tokens to authenticated user from JWT, not from body-supplied user id.
3. Validate platform enum and provider value.
4. Rate limit token registration endpoints.
5. Never log full token values at info level.

## Observability
Minimum logs:
1. Token register/deactivate success/failure with redacted token prefix.
2. Push send attempt result with `requestId`, `messageId`, `recipientUserId`.

Metrics:
1. `push.send.attempt`
2. `push.send.success`
3. `push.send.failure`
4. `push.token.invalidated`
5. `push.send.latency_ms`

Alerts:
1. Sustained failure rate above agreed threshold.
2. Token invalidation spikes.

## Rollout and Operations
Rollout:
1. Deploy backend token endpoints first.
2. Deploy push send path behind feature flag.
3. Enable for staging users.
4. Validate end-to-end on Android+iOS physical devices.
5. Gradually increase production cohort.

Rollback:
1. Disable push-send feature flag.
2. Keep token ingestion endpoints enabled.

Runbook ownership:
1. Backend owns FCM server auth and send pipeline.
2. Mobile owns token ingestion client and payload parsing.
3. DevOps/SRE owns alerts and incident response.

## Test Checklist
1. Register token after login and after restored session.
2. Token refresh updates backend record.
3. Deactivate call on logout is accepted and idempotent.
4. Recipient gets push in foreground/background/terminated states.
5. Push tap opens app context for pending request.
6. Socket + push for same request does not produce duplicate user alert.

## Acceptance Criteria
Backend implementation is complete when:
1. Token register/deactivate endpoints are live and documented.
2. Push is sent for each `chat.requested` event to active recipient tokens.
3. Invalid tokens are pruned automatically.
4. Observability and alerting are in place.
5. Mobile integration requires no additional backend contract clarification.
