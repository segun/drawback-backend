# Drawback — Admin API Reference

> Base URL: `http://localhost:3000/api/admin`  
> All endpoints require admin authentication.

---

## Authentication

All admin endpoints require:
1. Valid JWT token with `role: "ADMIN"` in the payload
2. Authorization header: `Authorization: Bearer <adminToken>`

**Creating an admin user:**
```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com';
```

**Error responses for non-admin users:**
| Status | Reason |
|---|---|
| `401` | No token or invalid token |
| `403` | Token valid but user is not an admin |

**Rate limiting:** All admin endpoints are throttled at **100 requests per 60 seconds** per admin user.

---

## User Management

### `GET /admin/users`

List all users with pagination.

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (min: 1) |
| `limit` | number | 100 | Items per page (min: 1, max: 500) |

**Request**
```
GET /api/admin/users?page=1&limit=50
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "user@example.com",
      "displayName": "@username",
      "mode": "PUBLIC",
      "role": "USER",
      "isBlocked": false,
      "blockedAt": null,
      "blockedReason": null,
      "isActivated": true,
      "appearInSearches": true,
      "appearInDiscoveryGame": false,
      "hasDiscoveryAccess": false,
      "discoveryImageUrl": null,
      "createdAt": "2026-03-01T10:00:00.000Z",
      "updatedAt": "2026-03-01T10:00:00.000Z"
    }
  ],
  "total": 150,
  "page": 1,
  "limit": 50
}
```

> **Note:** Sensitive fields (`passwordHash`, `activationToken`, `resetToken`, etc.) are excluded from all responses.

---

### `GET /admin/users/filter`

Filter users by various criteria with pagination.

**Query Parameters**
| Param | Type | Optional | Description |
|-------|------|----------|-------------|
| `page` | number | yes | Page number (default: 1) |
| `limit` | number | yes | Items per page (default: 100, max: 500) |
| `mode` | string | yes | `PUBLIC` or `PRIVATE` |
| `appearInSearches` | boolean | yes | Filter by search visibility |
| `appearInDiscoveryGame` | boolean | yes | Filter by discovery game participation |
| `isBlocked` | boolean | yes | Filter by blocked status |
| `isActivated` | boolean | yes | Filter by activation status |

**Request Examples**
```
GET /api/admin/users/filter?mode=PRIVATE&page=1&limit=20
GET /api/admin/users/filter?isBlocked=true
GET /api/admin/users/filter?appearInDiscoveryGame=true&isActivated=true
```

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "private-user@example.com",
      "displayName": "@privateuser",
      "mode": "PRIVATE",
      "isBlocked": false,
      "isActivated": true,
      "createdAt": "2026-03-01T10:00:00.000Z",
      "updatedAt": "2026-03-01T10:00:00.000Z"
    }
  ],
  "total": 45,
  "page": 1,
  "limit": 20
}
```

---

### `GET /admin/users/search`

Search users by email or display name.

**Query Parameters**
| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `q` | string | yes | Search query (min: 1 character) |
| `searchField` | string | yes | `email` or `displayName` |
| `page` | number | no | Page number (default: 1) |
| `limit` | number | no | Items per page (default: 100) |

**Request Examples**
```
GET /api/admin/users/search?q=john&searchField=displayName
GET /api/admin/users/search?q=@example.com&searchField=email&page=1&limit=50
```

**Response `200`**
```json
{
  "data": [
    {
      "id": "uuid",
      "email": "john.doe@example.com",
      "displayName": "@johndoe",
      "mode": "PUBLIC",
      "isBlocked": false,
      "createdAt": "2026-02-15T10:00:00.000Z",
      "updatedAt": "2026-02-15T10:00:00.000Z"
    }
  ],
  "total": 3,
  "page": 1,
  "limit": 100
}
```

**Search behavior:**
- **displayName**: Prefix match, case-insensitive (e.g., `john` matches `@johndoe`, `@johnny`)
- **email**: Contains match, case-insensitive (e.g., `example.com` matches any email with that domain)

---

### `GET /admin/users/:userId`

Get detailed information about a specific user.

**URL Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `userId` | UUID | User ID |

**Request**
```
GET /api/admin/users/a1b2c3d4-e5f6-7890-abcd-ef1234567890
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
{
  "id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "email": "user@example.com",
  "displayName": "@username",
  "mode": "PUBLIC",
  "role": "USER",
  "isBlocked": false,
  "blockedAt": null,
  "blockedReason": null,
  "isActivated": true,
  "activationTokenExpiry": null,
  "resetTokenExpiry": null,
  "deleteTokenExpiry": null,
  "appearInSearches": true,
  "appearInDiscoveryGame": false,
  "hasDiscoveryAccess": false,
  "discoveryImageUrl": null,
  "createdAt": "2026-03-01T10:00:00.000Z",
  "updatedAt": "2026-03-01T10:00:00.000Z"
}
```

> **Admin view includes:** `isActivated`, token expiry timestamps, `blockedAt`, `blockedReason`. Actual tokens are still excluded.

**Error Cases**
| Status | Reason |
|---|---|
| `400` | Invalid UUID format |
| `404` | User not found |

---

## User Ban Management

### `POST /admin/users/ban`

Ban one or more users. Banned users cannot log in or connect to WebSocket.

**Request Body**
```json
{
  "userIds": [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  ],
  "reason": "Spam violation"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userIds` | string[] | yes | Array of user UUIDs (min: 1) |
| `reason` | string | no | Ban reason (max: 500 characters) |

**Response `200`**
```json
{
  "banned": 2
}
```

**What happens on ban:**
1. User's `isBlocked` set to `true`
2. `blockedAt` timestamp recorded
3. `blockedReason` stored (if provided)
4. Active WebSocket connections disconnected immediately
5. Audit log entry created
6. Cache invalidated

**Subsequent login/websocket attempts:**
- HTTP login: `403 Forbidden` with message `"Account has been blocked"`
- WebSocket: Disconnected with error event `{ message: "Account has been blocked" }`

**Error Cases**
| Status | Reason |
|---|---|
| `400` | Invalid UUID format or empty array |

---

### `POST /admin/users/unban`

Unban one or more users.

**Request Body**
```json
{
  "userIds": [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userIds` | string[] | yes | Array of user UUIDs (min: 1) |

**Response `200`**
```json
{
  "unbanned": 1
}
```

**What happens on unban:**
1. User's `isBlocked` set to `false`
2. `blockedAt` cleared (set to `null`)
3. `blockedReason` cleared (set to `null`)
4. Audit log entry created
5. Cache invalidated

Users can immediately log in and connect to WebSocket after unban.

---

## Password Management

### `POST /admin/users/reset-passwords`

Trigger password reset for one or more users. Sends password reset emails as if users requested them.

**Request Body**
```json
{
  "userIds": [
    "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "b2c3d4e5-f6a7-8901-bcde-f12345678901"
  ]
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `userIds` | string[] | yes | Array of user UUIDs (min: 1) |

**Response `200`**
```json
{
  "emailsSent": 2,
  "failed": []
}
```

or (if some emails failed):

```json
{
  "emailsSent": 1,
  "failed": ["b2c3d4e5-f6a7-8901-bcde-f12345678901"]
}
```

**What happens:**
1. For each user:
   - Generate new reset token (UUID)
   - Set expiry to 1 hour from now
   - Send password reset email
2. Audit log entry created (includes failed user IDs if any)

**Email sent:** Same template as user-initiated password reset (`/api/auth/forgot-password`)

**Error Cases**
| Status | Reason |
|---|---|
| `400` | Invalid UUID format or empty array |

> **Note:** Individual email failures are returned in `failed` array, not thrown as errors.

---

## Error Handling

### Standard Error Response

All errors follow this format:

```json
{
  "statusCode": 403,
  "message": "Admin access required",
  "error": "Forbidden"
}
```

### Validation Errors

```json
{
  "statusCode": 400,
  "message": [
    "userIds must be an array",
    "each value in userIds must be a UUID"
  ],
  "error": "Bad Request"
}
```

### Common Status Codes

| Status | Meaning |
|--------|---------|
| `200` | Success |
| `400` | Bad Request (validation failed) |
| `401` | Unauthorized (no token or invalid token) |
| `403` | Forbidden (not an admin or account blocked) |
| `404` | Not Found (resource doesn't exist) |
| `429` | Too Many Requests (rate limit exceeded: 100/min) |
| `500` | Internal Server Error |

---

## Quick Reference

### All Admin Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/admin/users` | List all users (paginated) |
| `GET` | `/admin/users/filter` | Filter users by criteria |
| `GET` | `/admin/users/search` | Search users by email/displayName |
| `GET` | `/admin/users/:userId` | Get single user details |
| `POST` | `/admin/users/ban` | Ban users (batch) |
| `POST` | `/admin/users/unban` | Unban users (batch) |
| `POST` | `/admin/users/reset-passwords` | Reset passwords (batch) |

### Example Frontend Usage

```typescript
// Admin login
const loginResponse = await fetch('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'admin@example.com',
    password: 'admin-password'
  })
});
const { accessToken } = await loginResponse.json();

// Use token for admin requests
const headers = {
  'Authorization': `Bearer ${accessToken}`,
  'Content-Type': 'application/json'
};

// List users
const users = await fetch('/api/admin/users?page=1&limit=50', { headers });

// Search by email
const searchResults = await fetch(
  '/api/admin/users/search?q=john&searchField=displayName',
  { headers }
);

// Ban a user
const banResponse = await fetch('/api/admin/users/ban', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    userIds: ['user-uuid'],
    reason: 'Terms of service violation'
  })
});

// Unban a user
const unbanResponse = await fetch('/api/admin/users/unban', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    userIds: ['user-uuid']
  })
});

// Reset password
const resetResponse = await fetch('/api/admin/users/reset-passwords', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    userIds: ['user-uuid-1', 'user-uuid-2']
  })
});
```

---

## Audit Trail

All admin actions (ban, unban, password reset) are logged in the `admin_audit_logs` table:

```sql
SELECT * FROM admin_audit_logs 
WHERE adminId = 'admin-user-uuid' 
ORDER BY createdAt DESC;
```

**Audit log fields:**
- `id` — UUID
- `adminId` — UUID of admin who performed the action
- `action` — `BAN_USER`, `UNBAN_USER`, `RESET_PASSWORD`, or `UPDATE_ROLE`
- `targetUserIds` — JSON array of affected user UUIDs
- `metadata` — JSON object with additional context (e.g., `{ "reason": "spam" }`)
- `createdAt` — Timestamp

This provides full accountability for all administrative actions.
