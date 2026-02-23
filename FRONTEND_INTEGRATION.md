# Drawback — Frontend Integration Guide

> Base URL: `http://localhost:3000` (configure per environment)  
> WebSocket namespace: `http://localhost:3000/drawback`  
> All request/response bodies are JSON.

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Users](#2-users)
3. [Chat Requests](#3-chat-requests)
4. [Saved Chats](#4-saved-chats)
5. [WebSocket — Real-time Layer](#5-websocket--real-time-layer)
6. [Error Handling](#6-error-handling)
7. [Integration Flows (step-by-step)](#7-integration-flows)

---

## General Conventions

### Authorization header
Every endpoint except `POST /auth/register`, `GET /auth/confirm/:token`, and `POST /auth/login` requires a Bearer token:

```
Authorization: Bearer <accessToken>
```

### User object (returned everywhere)
Sensitive fields (`passwordHash`, `activationToken`, `socketId`, `isActivated`) are **never** returned by the API.

```jsonc
{
  "id": "uuid",
  "email": "alice@example.com",
  "displayName": "@alice",
  "mode": "PUBLIC",          // "PUBLIC" | "PRIVATE"
  "createdAt": "2026-02-23T10:00:00.000Z",
  "updatedAt": "2026-02-23T10:00:00.000Z"
}
```

### Display names
- Always prefixed with `@` (e.g. `@alice`, `@bob_99`)
- 3–29 alphanumeric/underscore characters after the `@`
- Stored and compared case-insensitively — send whatever case you like

---

## 1. Authentication

### `POST /auth/register`

Register a new account. Sends a confirmation email — the user **cannot log in** until they click it.

**Request**
```json
{
  "email": "alice@example.com",
  "password": "supersecret123",
  "displayName": "@alice"
}
```

| Field | Rules |
|---|---|
| `email` | Valid email, max 254 chars |
| `password` | Min 8, max 72 chars |
| `displayName` | Must match `^@[a-zA-Z0-9_]{3,29}$` |

**Response `201`**
```json
{
  "message": "Registration successful. Please check your email to activate your account."
}
```

**Error cases**
| Status | Reason |
|---|---|
| `400` | Validation failure (bad email, short password, invalid displayName format) |
| `409` | Email or displayName already in use |

---

### `POST /auth/login`

**Request**
```json
{
  "email": "alice@example.com",
  "password": "supersecret123"
}
```

**Response `201`**
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

Store this token (memory or `localStorage`) and attach it to every subsequent request as `Authorization: Bearer <accessToken>`.

The token expires based on server config (`JWT_EXPIRES_IN`, default **7 days**). When it expires, the user must log in again — there is no refresh token endpoint.

**Error cases**
| Status | Reason |
|---|---|
| `401` | Wrong email or password |
| `401` | Account exists but email not yet confirmed |

---

## 2. Users

All endpoints below require `Authorization: Bearer <token>`.

---

### `GET /users/me`

Returns the currently authenticated user's profile.

**Response `200`** — [User object](#user-object-returned-everywhere)

---

### `PATCH /users/me`

Update your display name.

**Request**
```json
{
  "displayName": "@new_name"
}
```

**Response `200`** — updated [User object](#user-object-returned-everywhere)

**Error cases**
| Status | Reason |
|---|---|
| `400` | Invalid format |
| `409` | Display name already taken |

---

### `PATCH /users/me/mode`

Set your visibility. `PRIVATE` users do not appear in public listings or search, and cannot receive chat requests.

**Request**
```json
{
  "mode": "PUBLIC"
}
```

`mode` must be `"PUBLIC"` or `"PRIVATE"`.

**Response `200`** — updated [User object](#user-object-returned-everywhere)

---

### `DELETE /users/me`

Permanently deletes the account and all associated data (chat requests, blocks, saved chats). **Irreversible.**

**Response `204`** — no body

---

### `GET /users/public`

Returns all public users except yourself. Users who have blocked you, or whom you have blocked, are automatically excluded.

**Response `200`**
```json
[
  {
    "id": "uuid",
    "email": "bob@example.com",
    "displayName": "@bob",
    "mode": "PUBLIC",
    "createdAt": "...",
    "updatedAt": "..."
  }
]
```

---

### `GET /users/search?q=@alice`

Search public users by display name prefix. Blocked users are excluded in both directions.

**Query params**
| Param | Description |
|---|---|
| `q` | The prefix to search — e.g. `@ali` will match `@alice`, `@alibi`, etc. The `@` is optional. |

**Response `200`** — array of [User objects](#user-object-returned-everywhere), alphabetically sorted

---

### `GET /users/me/blocked`

List all users you have blocked.

**Response `200`** — array of [User objects](#user-object-returned-everywhere)

---

### `POST /users/:id/block`

Block a user by their UUID. Idempotent — blocking someone already blocked is a no-op.

**Response `204`** — no body

**Error cases**
| Status | Reason |
|---|---|
| `400` | Trying to block yourself |
| `404` | User not found |

---

### `DELETE /users/:id/block`

Unblock a user by their UUID. Idempotent — unblocking someone not blocked is a no-op.

**Response `204`** — no body

---

## 3. Chat Requests

All endpoints below require `Authorization: Bearer <token>`.

### Chat request object

```jsonc
{
  "id": "uuid",
  "fromUserId": "uuid",
  "toUserId": "uuid",
  "fromUser": { /* User object */ },
  "toUser": { /* User object */ },
  "status": "PENDING",   // "PENDING" | "ACCEPTED" | "REJECTED"
  "createdAt": "...",
  "updatedAt": "..."
}
```

---

### `POST /chat/requests`

Send a chat request to a public user by their display name. The target must be PUBLIC and must not have a block relationship with you.

**Request**
```json
{
  "toDisplayName": "@bob"
}
```

**Response `201`** — [Chat request object](#chat-request-object) with `status: "PENDING"`

The target user receives a **`chat.requested`** WebSocket event in real time (see [WebSocket section](#5-websocket--real-time-layer)).

**Error cases**
| Status | Reason |
|---|---|
| `400` | Trying to chat with yourself |
| `400` | You already have a pending request to this user |
| `403` | A block exists in either direction |
| `403` | Target user is PRIVATE |
| `404` | No user with that display name |

---

### `GET /chat/requests/sent`

All chat requests you have sent, newest first.

**Response `200`** — array of [Chat request objects](#chat-request-object)

---

### `GET /chat/requests/received`

All chat requests you have received, newest first.

**Response `200`** — array of [Chat request objects](#chat-request-object)

---

### `POST /chat/requests/:requestId/respond`

Accept or reject a chat request addressed to you.

**Request**
```json
{
  "accept": true
}
```

**Response `201`**
```json
{
  "request": { /* Chat request object with updated status */ },
  "roomId": "chat:uuid-of-request"   // null if rejected
}
```

Both participants receive a **`chat.response`** WebSocket event. If accepted, the `roomId` is included so both sides can immediately call `chat.join` on the socket.

**Error cases**
| Status | Reason |
|---|---|
| `400` | Request is already resolved |
| `403` | You are not the recipient |
| `404` | Request not found |

---

### `DELETE /chat/requests/:requestId`

Cancel a **pending** request you sent. Removes it entirely.

**Response `204`** — no body

**Error cases**
| Status | Reason |
|---|---|
| `400` | Request is no longer pending |
| `403` | You are not the sender |
| `404` | Request not found |

---

## 4. Saved Chats

All endpoints below require `Authorization: Bearer <token>`.

Saving a chat records *the fact that a conversation happened* — it does **not** save drawings. Drawings are ephemeral.

### Saved chat object

```jsonc
{
  "id": "uuid",
  "chatRequestId": "uuid",
  "savedByUserId": "uuid",
  "chatRequest": { /* Chat request object (includes fromUser/toUser) */ },
  "savedBy": { /* User object */ },
  "savedAt": "2026-02-23T12:00:00.000Z"
}
```

---

### `POST /chat/requests/:requestId/save`

Save an accepted chat. Only participants can save. Idempotent — saving twice returns the existing record.

**Response `201`** — [Saved chat object](#saved-chat-object)

**Error cases**
| Status | Reason |
|---|---|
| `400` | Chat request is not yet accepted |
| `403` | You are not a participant |
| `404` | Request not found |

---

### `GET /chat/saved`

All chats you have saved, newest first.

**Response `200`** — array of [Saved chat objects](#saved-chat-object)

---

### `DELETE /chat/saved/:savedChatId`

Delete a saved chat record (does **not** affect the underlying chat request).

**Response `204`** — no body

**Error cases**
| Status | Reason |
|---|---|
| `403` | You did not save this |
| `404` | Saved chat not found |

---

## 5. WebSocket — Real-time Layer

The drawing/chat session is entirely ephemeral over WebSockets. Drawings are **never** persisted.

### Connecting

Use **Socket.IO client v4**. Pass your JWT in the `auth` object:

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/drawback', {
  auth: { token: accessToken },  // <-- JWT here
});
```

The server verifies the token on connection. If it is missing or invalid the socket is disconnected immediately with an `error` event.

> **Alternative**: You can also pass the token as a query param `?token=<jwt>` or in the `Authorization` header, but `auth.token` is the recommended path.

---

### Lifecycle events (socket.io built-ins)

```js
socket.on('connect', () => {
  // connection established and JWT accepted
});

socket.on('disconnect', (reason) => {
  // handle reconnection UI here
});

socket.on('connect_error', (err) => {
  // JWT invalid/expired, or server unreachable
  console.error(err.message);
});
```

---

### Server → Client events

These are pushed by the server — you only need to listen.

---

#### `chat.requested`

Fired when another user sends you a chat request.

```jsonc
{
  "requestId": "uuid",
  "fromUser": {
    "id": "uuid",
    "displayName": "@alice"
  },
  "message": "@alice wants to chat. Accept?"
}
```

Use `requestId` to call `POST /chat/requests/:requestId/respond`.

---

#### `chat.response`

Fired on **both** participants after a request is responded to.

```jsonc
// To the original sender
{
  "requestId": "uuid",
  "accepted": true,
  "roomId": "chat:uuid",       // null if rejected
  "responderUserId": "uuid"
}

// To the responder
{
  "requestId": "uuid",
  "accepted": true,
  "roomId": "chat:uuid",       // null if rejected
  "requesterUserId": "uuid"
}
```

If `accepted` is `true`, both sides should immediately emit `chat.join` with the `requestId`.

---

#### `chat.joined`

Confirmation that **your** `chat.join` succeeded.

```jsonc
{
  "roomId": "chat:uuid",
  "requestId": "uuid"
}
```

---

#### `draw.peer.joined`

The other participant has joined the room. Use this to show a "peer connected" UI state.

```jsonc
{
  "userId": "uuid"
}
```

---

#### `draw.peer.left`

The other participant has left or disconnected.

```jsonc
{
  "userId": "uuid"
}
```

Show a "peer disconnected" indicator. They can rejoin by emitting `chat.join` again.

---

#### `draw.stroke`

A stroke from the other participant. Apply it to your canvas.

```jsonc
{
  "requestId": "uuid",
  "stroke": {
    // whatever your canvas stroke object looks like
    // the server passes it through without modification
  }
}
```

---

#### `draw.clear`

The other participant cleared their canvas.

```jsonc
{
  "requestId": "uuid"
}
```

---

#### `draw.left`

Confirmation that **your** `draw.leave` succeeded.

```jsonc
{}
```

---

#### `error`

Emitted when any server-side event handler fails.

```jsonc
{
  "message": "You are not part of this chat request",
  "status": 403
}
```

`status` mirrors HTTP status codes (`400`, `403`, `404`, `500`).

---

### Client → Server events

These are emitted by your client.

---

#### `chat.join`

Join a room after a request is accepted. Must be called by both participants.

```js
socket.emit('chat.join', { requestId: 'uuid' });
// listen for 'chat.joined' for confirmation
```

```jsonc
// payload
{
  "requestId": "uuid"   // UUID, required
}
```

If you were already in another room, the server leaves it automatically and notifies the previous peer.

---

#### `draw.leave`

Leave the current room cleanly. Notifies the peer.

```js
socket.emit('draw.leave', {});
// listen for 'draw.left' for confirmation
```

No payload needed.

---

#### `draw.stroke`

Broadcast a drawing stroke to the other participant. The `stroke` object is passed through as-is — define whatever shape your canvas needs.

```js
socket.emit('draw.stroke', {
  requestId: 'uuid',
  stroke: {
    tool: 'pen',
    color: '#ff0000',
    width: 3,
    points: [{ x: 10, y: 20 }, { x: 15, y: 25 }],
  },
});
```

```jsonc
// payload
{
  "requestId": "uuid",  // UUID, required
  "stroke": {}          // any object, required
}
```

---

#### `draw.clear`

Tell the other participant to clear their canvas.

```js
socket.emit('draw.clear', { requestId: 'uuid' });
```

```jsonc
// payload
{
  "requestId": "uuid"   // UUID, required
}
```

---

## 6. Error Handling

### HTTP errors

All error responses follow this shape:

```jsonc
{
  "statusCode": 403,
  "message": "You cannot send a chat request to this user",
  "error": "Forbidden"
}
```

Validation errors return an array:

```jsonc
{
  "statusCode": 400,
  "message": [
    "displayName must start with @ and contain 3–29 alphanumeric/underscore characters"
  ],
  "error": "Bad Request"
}
```

### WebSocket errors

Listen on the `error` event (see above). Never swallow it silently — surface `message` to the user where appropriate.

---

## 7. Integration Flows

### Full login flow

```
POST /auth/register          → user gets confirmation email
GET  /auth/confirm/:token    → account activated (can be a redirect URL)
POST /auth/login             → receive accessToken
GET  /users/me               → load profile into app state
```

### Finding and chatting with someone

```
PATCH /users/me/mode { mode: "PUBLIC" }   → make yourself discoverable
GET   /users/search?q=@bob                → find target
POST  /chat/requests { toDisplayName: "@bob" }
                                          → bob receives 'chat.requested' via WS

// Bob's side:
POST /chat/requests/:id/respond { accept: true }
                                          → both receive 'chat.response' via WS with roomId

// Both sides:
socket.emit('chat.join', { requestId })   → both receive 'chat.joined'
                                          → each receives 'draw.peer.joined'

// During session:
socket.emit('draw.stroke', { requestId, stroke: {...} })
socket.emit('draw.clear',  { requestId })

// Ending the session:
socket.emit('draw.leave')                 → peer receives 'draw.peer.left'

// Optionally save a record:
POST /chat/requests/:id/save
GET  /chat/saved
```

### Blocking a user

```
POST   /users/:id/block     → block
DELETE /users/:id/block     → unblock
GET    /users/me/blocked    → view block list
```

Blocked users disappear from `/users/public` and `/users/search` automatically. Existing pending requests to/from a newly blocked user should be handled on the client (call the cancel endpoint or just filter them from the UI).

---

## Quick Reference

### REST endpoints

| Method | Path | Auth | Description |
|---|---|---|---|
| `POST` | `/auth/register` | — | Register |
| `GET` | `/auth/confirm/:token` | — | Confirm email |
| `POST` | `/auth/login` | — | Login, get JWT |
| `GET` | `/users/me` | ✓ | Get own profile |
| `PATCH` | `/users/me` | ✓ | Update display name |
| `PATCH` | `/users/me/mode` | ✓ | Set PUBLIC / PRIVATE |
| `DELETE` | `/users/me` | ✓ | Delete account |
| `GET` | `/users/public` | ✓ | List public users |
| `GET` | `/users/search?q=` | ✓ | Search by @name |
| `GET` | `/users/me/blocked` | ✓ | List blocked users |
| `POST` | `/users/:id/block` | ✓ | Block a user |
| `DELETE` | `/users/:id/block` | ✓ | Unblock a user |
| `POST` | `/chat/requests` | ✓ | Send chat request |
| `GET` | `/chat/requests/sent` | ✓ | My sent requests |
| `GET` | `/chat/requests/received` | ✓ | My received requests |
| `POST` | `/chat/requests/:id/respond` | ✓ | Accept / reject |
| `DELETE` | `/chat/requests/:id` | ✓ | Cancel (sender) |
| `POST` | `/chat/requests/:id/save` | ✓ | Save accepted chat |
| `GET` | `/chat/saved` | ✓ | List saved chats |
| `DELETE` | `/chat/saved/:id` | ✓ | Delete saved chat |

### WebSocket events

| Direction | Event | When |
|---|---|---|
| ← server | `chat.requested` | Someone requested to chat with you |
| ← server | `chat.response` | A request you sent/received was responded to |
| ← server | `chat.joined` | Your `chat.join` was confirmed |
| ← server | `draw.peer.joined` | Other participant entered the room |
| ← server | `draw.peer.left` | Other participant left or disconnected |
| ← server | `draw.stroke` | Stroke from the other participant |
| ← server | `draw.clear` | Clear from the other participant |
| ← server | `draw.left` | Your `draw.leave` was confirmed |
| ← server | `error` | Handler error `{ message, status }` |
| → client | `chat.join` | Join a room by requestId |
| → client | `draw.leave` | Leave the current room |
| → client | `draw.stroke` | Send a stroke |
| → client | `draw.clear` | Send a clear |
