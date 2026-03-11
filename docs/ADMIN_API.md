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

### `GET /admin/users/details/:userId`

Get detailed information about a specific user.

**URL Parameters**
| Param | Type | Description |
|-------|------|-------------|
| `userId` | UUID | User ID |

**Request**
```
GET /api/admin/users/details/a1b2c3d4-e5f6-7890-abcd-ef1234567890
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
| `GET` | `/admin/users/details/:userId` | Get single user details |
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

---

## Safety & Monitoring

### `GET /api/reports/admin`

List all abuse reports with optional filtering.

**Query Parameters**
| Param | Type | Optional | Description |
|-------|------|----------|-------------|
| `status` | string | yes | `PENDING`, `UNDER_REVIEW`, `RESOLVED`, `DISMISSED` |
| `reportType` | string | yes | `CSAE`, `HARASSMENT`, `INAPPROPRIATE_CONTENT`, `SPAM`, `IMPERSONATION`, `OTHER` |
| `reportedUserId` | UUID | yes | Filter by reported user |
| `reporterId` | UUID | yes | Filter by reporter |

**Request**
```
GET /api/reports/admin?status=PENDING&reportType=CSAE
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
[{
  "id": "uuid",
  "reporter": { "id": "uuid", "displayName": "@username", "email": "reporter@example.com" },
  "reportedUser": { "id": "uuid", "displayName": "@badactor", "email": "bad@example.com" },
  "reportType": "HARASSMENT",
  "description": "User sent threatening messages",
  "chatRequestId": "uuid",
  "sessionContext": "Session details...",
  "status": "PENDING",
  "adminNotes": "Investigating...",
  "resolvedBy": "admin-uuid",
  "resolvedAt": "2026-03-11T11:00:00.000Z",
  "createdAt": "2026-03-11T10:30:00.000Z",
  "updatedAt": "2026-03-11T11:00:00.000Z"
}]
```

---

### `GET /api/reports/admin/stats`

Get report statistics dashboard.

**Request**
```
GET /api/reports/admin/stats
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
{
  "total": 156,
  "pending": 12,
  "underReview": 8,
  "resolved": 130,
  "dismissed": 6
}
```

---

### `PATCH /api/reports/admin/:id`

Update report status and add admin notes.

**Request Body**
```json
{
  "status": "UNDER_REVIEW | RESOLVED | DISMISSED | PENDING",
  "adminNotes": "string (optional, max 2000 chars)"
}
```

**Request**
```
PATCH /api/reports/admin/abc123
Authorization: Bearer <adminToken>
Content-Type: application/json
```

**Response `200`**

Returns updated report (same structure as list endpoint).

**Note:** Setting `RESOLVED` or `DISMISSED` auto-sets `resolvedBy` to current admin and `resolvedAt` to now.

---

### `DELETE /api/reports/admin/:id`

Permanently delete a report.

**Request**
```
DELETE /api/reports/admin/abc123
Authorization: Bearer <adminToken>
```

**Response:** `204 No Content`

---

### `GET /api/admin/session-events`

Query historical connection and chat session events (30-day retention).

**Query Parameters**
| Param | Type | Optional | Description |
|-------|------|----------|-------------|
| `userId` | UUID | yes | Filter by user |
| `eventType` | string | yes | `CONNECT`, `DISCONNECT`, `CHAT_JOINED`, `CHAT_LEFT` |
| `startDate` | ISO date | yes | Filter from date |
| `endDate` | ISO date | yes | Filter to date |

**Request**
```
GET /api/admin/session-events?userId=abc123&startDate=2026-03-01
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
[{
  "id": "uuid",
  "userId": "uuid",
  "eventType": "CONNECT",
  "ipAddress": "192.168.1.1",
  "metadata": { 
    "socketId": "xyz", 
    "userAgent": "Mozilla/5.0...",
    "roomId": "room-uuid",
    "requestId": "request-uuid"
  },
  "createdAt": "2026-03-11T10:30:00.000Z"
}]
```

**Event Types:**
- `CONNECT` — WebSocket connection (captures IP + user agent)
- `DISCONNECT` — WebSocket disconnection
- `CHAT_JOINED` — Joined drawing room (captures IP + room ID + request ID)
- `CHAT_LEFT` — Left drawing room

**Retention:** Events auto-deleted after 30 days (daily at 3 AM).

**Use Cases:**
- Investigate abuse reports (verify users were in same room)
- Track IP addresses for NCMEC reports
- Detect bot patterns (multiple IPs, excessive connections)
- Audit user activity timeline

---

### `GET /api/admin/session-events/stats`

Get session event statistics.

**Request**
```
GET /api/admin/session-events/stats
Authorization: Bearer <adminToken>
```

**Response `200`**
```json
{
  "total": 5420,
  "last24Hours": 342,
  "last7Days": 1823,
  "byType": {
    "CONNECT": 1355,
    "DISCONNECT": 1348,
    "CHAT_JOINED": 1356,
    "CHAT_LEFT": 1361
  }
}
```

---

### Report Types Reference

| Type | Description | Priority |
|------|-------------|----------|
| `CSAE` | Child abuse/exploitation | **Highest** |
| `HARASSMENT` | Bullying, threats | High |
| `INAPPROPRIATE_CONTENT` | Offensive content | Medium |
| `SPAM` | Spam, bots | Medium |
| `IMPERSONATION` | Fake identity | Low |
| `OTHER` | Other violations | Low |

### Report Status Reference

| Status | Description |
|--------|-------------|
| `PENDING` | New report, awaiting review |
| `UNDER_REVIEW` | Being investigated |
| `RESOLVED` | Issue addressed |
| `DISMISSED` | Not actionable |

---

## Safety Monitoring Quick Reference

### All Safety Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/reports/admin` | List reports (with filters) |
| `GET` | `/api/reports/admin/stats` | Report statistics |
| `PATCH` | `/api/reports/admin/:id` | Update report status |
| `DELETE` | `/api/reports/admin/:id` | Delete report |
| `GET` | `/api/admin/session-events` | Query session history |
| `GET` | `/api/admin/session-events/stats` | Session statistics |

### Example: Investigate Harassment Report

```typescript
// 1. Get pending CSAE reports
const reports = await fetch(
  '/api/reports/admin?status=PENDING&reportType=CSAE',
  { headers }
).then(r => r.json());

const report = reports[0];

// 2. Get session events for reported user around report time
const reportDate = new Date(report.createdAt);
const startDate = new Date(reportDate.getTime() - 24*60*60*1000).toISOString();
const events = await fetch(
  `/api/admin/session-events?userId=${report.reportedUserId}&startDate=${startDate}`,
  { headers }
).then(r => r.json());

// 3. Check if users were in same room
const reporterEvents = await fetch(
  `/api/admin/session-events?userId=${report.reporterId}&startDate=${startDate}`,
  { headers }
).then(r => r.json());

const sharedRooms = events
  .filter(e => e.eventType === 'CHAT_JOINED')
  .filter(e => reporterEvents.some(re => 
    re.metadata?.roomId === e.metadata?.roomId
  ));

// 4. Update report status
await fetch(`/api/reports/admin/${report.id}`, {
  method: 'PATCH',
  headers,
  body: JSON.stringify({
    status: 'RESOLVED',
    adminNotes: `Verified incident. Users were in room ${sharedRooms[0].metadata.roomId}. IP: ${events[0].ipAddress}. User banned and NCMEC report filed.`
  })
});

// 5. Ban the user
await fetch('/api/admin/users/ban', {
  method: 'POST',
  headers,
  body: JSON.stringify({
    userIds: [report.reportedUserId],
    reason: `CSAE violation - Report #${report.id}`
  })
});
```
