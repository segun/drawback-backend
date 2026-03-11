# Drawback — Admin API Reference

> Base URL: `http://localhost:3000/api/admin`  
> All endpoints require admin authentication.

---

## Authentication

All admin endpoints require:
1. Valid JWT token with `role: "ADMIN"` in the payload
2. Authorization header: `Authorization: Bearer <adminToken>`

### How the Frontend Detects Admin Status

The frontend can determine if a user is an admin using **two methods**:

#### Method 1: Decode the JWT Token (Client-Side)

The JWT token received from `/api/auth/login` contains the `role` field in its payload. Since JWTs are base64-encoded (not encrypted), you can decode them client-side:

```typescript
// After successful login
const { accessToken } = await loginResponse.json();

// Decode JWT (only splits and decodes, doesn't verify signature)
function decodeJWT(token: string) {
  const base64Url = token.split('.')[1];
  const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split('')
      .map(c => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
      .join('')
  );
  return JSON.parse(jsonPayload);
}

const payload = decodeJWT(accessToken);
const isAdmin = payload.role === 'ADMIN';

// Or use a library like jwt-decode
import jwtDecode from 'jwt-decode';
const payload = jwtDecode<{ sub: string; email: string; role: string }>(accessToken);
const isAdmin = payload.role === 'ADMIN';
```

**JWT Payload Structure:**
```json
{
  "sub": "user-uuid",
  "email": "admin@example.com",
  "displayName": "@admin",
  "role": "ADMIN",
  "iat": 1709971200,
  "exp": 1709974800
}
```

#### Method 2: Call GET /api/users/me

The current user endpoint returns the full user profile including the `role` field:

```typescript
const response = await fetch('/api/users/me', {
  headers: { 'Authorization': `Bearer ${accessToken}` }
});
const user = await response.json();
const isAdmin = user.role === 'ADMIN';
```

**Response from /api/users/me:**
```json
{
  "id": "uuid",
  "email": "admin@example.com",
  "displayName": "@admin",
  "role": "ADMIN",
  "mode": "PUBLIC",
  "isActivated": true,
  "isBlocked": false,
  "appearInSearches": true,
  "appearInDiscoveryGame": false,
  "hasDiscoveryAccess": false,
  "createdAt": "2026-03-01T10:00:00.000Z",
  "updatedAt": "2026-03-01T10:00:00.000Z"
}
```

**Recommendation:** Use **Method 1** (decode JWT) for immediate admin detection without an extra API call. Use **Method 2** if you need to refresh user data or don't want to handle JWT decoding.

---

### Creating an Admin User

You can create admin users using **two methods**:

#### Method 1: Using the CLI Script (Recommended)

Add admin credentials to your `.env` file:

```bash
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=your-secure-password
```

Then run:

```bash
yarn add:admin
```

**What the script does:**
- Reads `ADMIN_EMAIL` and `ADMIN_PASSWORD` from `.env`
- Creates a new user with `role: ADMIN` if the email doesn't exist
- Or updates an existing user's role to `ADMIN` if they already exist
- Automatically activates the account
- Displays success message with user details

**Output example:**
```
🔌 Connecting to database...
👤 User not found. Creating new admin user...
✅ Admin user created successfully
   Email: admin@example.com
   Display Name: admin
   Role: ADMIN

✨ Done! You can now log in with admin credentials.
```

#### Method 2: Manual Database Update

Update an existing user via SQL:

```sql
UPDATE users SET role = 'ADMIN' WHERE email = 'admin@example.com';
```

The user must log out and log back in for the new role to be included in their JWT.

---

### Error Responses for Non-Admin Users

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
| `appearInSearches` | boolean | yes | Filter by search visibility (`true` or `false`) |
| `appearInDiscoveryGame` | boolean | yes | Filter by discovery game participation (`true` or `false`) |
| `isBlocked` | boolean | yes | Filter by blocked status (`true` or `false`) |
| `isActivated` | boolean | yes | Filter by activation status (`true` or `false`) |

> **Note:** Boolean parameters must be passed as string values `true` or `false` in the URL.

**Request Examples**
```
GET /api/admin/users/filter?mode=PRIVATE&page=1&limit=20
GET /api/admin/users/filter?isBlocked=true
GET /api/admin/users/filter?appearInDiscoveryGame=true&isActivated=true
GET /api/admin/users/filter?mode=PRIVATE&appearInSearches=false
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

## Socket Monitoring

### `GET /admin/sockets`

View all active WebSocket connections with user and connection details.

**Query Parameters**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number (min: 1) |
| `limit` | number | 100 | Items per page (min: 1, max: 500) |

**Request**
```
GET /api/admin/sockets?page=1&limit=50
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
{
  "data": [
    {
      "userId": "uuid",
      "userEmail": "user@example.com",
      "userDisplayName": "@username",
      "socketId": "socket-id-xyz",
      "connectedAt": "2026-03-10T14:30:00.000Z",
      "currentRoom": "room-uuid",
      "ipAddress": "192.168.1.100",
      "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)..."
    }
  ],
  "total": 23,
  "page": 1,
  "limit": 50
}
```

**Field Descriptions:**
- `userId` — User ID of the connected client
- `userEmail` — Email address of the user
- `userDisplayName` — Display name of the user
- `socketId` — Unique Socket.IO connection ID
- `connectedAt` — ISO 8601 timestamp of when the socket connected
- `currentRoom` — Chat room ID if user is currently in a drawing session, or `null`
- `ipAddress` — Client IP address (IPv6 prefix `::ffff:` stripped)
- `userAgent` — Browser/client user agent string

**Use Cases:**
- Monitor active connections in real-time
- Investigate connection issues for specific users
- Verify user presence in rooms
- Track concurrent connection counts

> **Note:** Sockets are automatically removed when users disconnect. This endpoint returns only currently active connections.

---

## Data Export

### `GET /admin/users/export`

Export filtered user data as CSV file.

**Query Parameters**

Same filtering options as `/admin/users/filter` (without pagination):

| Param | Type | Optional | Description |
|-------|------|----------|-------------|
| `mode` | string | yes | `PUBLIC` or `PRIVATE` |
| `appearInSearches` | boolean | yes | Filter by search visibility |
| `appearInDiscoveryGame` | boolean | yes | Filter by discovery game participation |
| `isBlocked` | boolean | yes | Filter by blocked status |
| `isActivated` | boolean | yes | Filter by activation status |

**Request Examples**
```
GET /api/admin/users/export
GET /api/admin/users/export?mode=PRIVATE
GET /api/admin/users/export?isBlocked=true
GET /api/admin/users/export?appearInDiscoveryGame=true&isActivated=true
```

**Response `200`**

Returns a CSV file with automatic download:

```
Content-Type: text/csv
Content-Disposition: attachment; filename=users-export-2026-03-10T14-30-00-000Z.csv

id,email,displayName,mode,role,isActivated,isBlocked,blockedAt,blockedReason,appearInSearches,appearInDiscoveryGame,hasDiscoveryAccess,createdAt,updatedAt
a1b2c3d4-e5f6-7890-abcd-ef1234567890,user@example.com,@username,PUBLIC,USER,true,false,,,true,false,false,2026-03-01T10:00:00.000Z,2026-03-01T10:00:00.000Z
...
```

**CSV Columns:**
- `id` — User UUID
- `email` — Email address
- `displayName` — Display name
- `mode` — PUBLIC or PRIVATE
- `role` — USER or ADMIN
- `isActivated` — Account activation status
- `isBlocked` — Ban status
- `blockedAt` — Ban timestamp (empty if not blocked)
- `blockedReason` — Ban reason (empty if not blocked)
- `appearInSearches` — Search visibility flag
- `appearInDiscoveryGame` — Discovery game participation flag
- `hasDiscoveryAccess` — Discovery game access flag
- `createdAt` — Account creation timestamp
- `updatedAt` — Last update timestamp

**Use Cases:**
- Bulk export for data analysis
- Compliance and data audit reports
- Backup of user data
- Import into spreadsheet tools

> **Note:** CSV fields containing commas, quotes, or newlines are properly escaped per RFC 4180.

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
| `GET` | `/admin/users/export` | Export users as CSV file |
| `POST` | `/admin/users/ban` | Ban users (batch) |
| `POST` | `/admin/users/unban` | Unban users (batch) |
| `POST` | `/admin/users/reset-passwords` | Reset passwords (batch) |
| `GET` | `/admin/sockets` | View active WebSocket connections |

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

// View active sockets
const socketsResponse = await fetch('/api/admin/sockets?page=1&limit=50', {
  headers
});
const { data: activeSockets } = await socketsResponse.json();

// Export users as CSV
const exportUrl = '/api/admin/users/export?mode=PRIVATE&isBlocked=true';
const csvBlob = await fetch(exportUrl, { headers }).then(r => r.blob());
const downloadUrl = window.URL.createObjectURL(csvBlob);
const a = document.createElement('a');
a.href = downloadUrl;
a.download = `users-export-${Date.now()}.csv`;
a.click();
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
