# Drawback — WebSocket Reference

> Namespace: `/drawback`  
> Protocol: Socket.IO v4  
> Auth: JWT passed in the `auth` handshake object

---

## Contents

1. [Connecting](#1-connecting)
2. [Lifecycle](#2-lifecycle)
3. [Server → Client events](#3-server--client-events)
4. [Client → Server events](#4-client--server-events)
5. [Complete flow walkthroughs](#5-complete-flow-walkthroughs)
6. [Common pitfalls (read this if things are broken)](#6-common-pitfalls)
7. [Quick reference table](#7-quick-reference-table)

---

## 1. Connecting

```js
import { io } from 'socket.io-client';

const socket = io('http://localhost:3000/drawback', {
  auth: { token: accessToken }, // ← required, JWT from POST /auth/login
});
```

**The socket MUST be created as soon as the user logs in and kept alive for the entire session.**  
If the user is not connected, they will not receive `chat.requested` or `chat.response` events in real time.

The server verifies the token on connection. An invalid or missing token immediately disconnects the socket with an `error` event.

---

## 2. Lifecycle

```js
socket.on('connect', () => {
  console.log('Connected:', socket.id);
  // Safe to emit events from here
});

socket.on('disconnect', (reason) => {
  // 'io server disconnect' — server kicked you (bad token, account deleted)
  // 'transport close'     — network issue, Socket.IO will auto-reconnect
  console.warn('Disconnected:', reason);
});

socket.on('connect_error', (err) => {
  // JWT invalid or expired → redirect to login
  console.error('Connection error:', err.message);
});
```

---

## 3. Server → Client events

Listen for these with `socket.on(event, handler)`. Register handlers **before** or **immediately after** connecting — not in a later callback.

---

### `chat.requested`

**Who receives it:** The user that another user is trying to chat with.  
**When:** Immediately after the sender calls `POST /chat/requests`.

```js
socket.on('chat.requested', (data) => {
  // Show an incoming request notification
  console.log(`${data.fromUser.displayName} wants to chat`);
});
```

**Payload**

```jsonc
{
  "requestId": "b3d2a1...",     // UUID — use this to respond
  "fromUser": {
    "id": "a1b2c3...",
    "displayName": "@alice"
  },
  "message": "@alice wants to chat. Accept?"
}
```

**What to do:** Display a prompt. On the user's answer call `POST /chat/requests/:requestId/respond`.

---

### `chat.response`

**Who receives it:** BOTH the original sender AND the responder.  
**When:** Immediately after either party calls `POST /chat/requests/:id/respond`.

```js
socket.on('chat.response', (data) => {
  if (data.accepted) {
    // Accepted — join the room right away
    socket.emit('chat.join', { requestId: data.requestId });
  } else {
    // Rejected — close the pending-request UI
    console.log('Request was declined');
  }
});
```

**Payload — to the original sender**

```jsonc
{
  "requestId": "b3d2a1...",
  "accepted": true,
  "roomId": "chat:b3d2a1...",   // null when rejected
  "responderUserId": "c4d5e6..."
}
```

**Payload — to the responder (person who accepted/rejected)**

```jsonc
{
  "requestId": "b3d2a1...",
  "accepted": true,
  "roomId": "chat:b3d2a1...",   // null when rejected
  "requesterUserId": "a1b2c3..."
}
```

> Both payloads indicate the same event; the only difference is which "other user" field is included.

---

### `chat.joined`

**Who receives it:** The socket that emitted `chat.join`.  
**When:** The server confirms you have successfully joined the room.

```js
socket.on('chat.joined', (data) => {
  console.log('Joined room', data.roomId);
  // Enable the drawing canvas
});
```

**Payload**

```jsonc
{
  "roomId": "chat:b3d2a1...",
  "requestId": "b3d2a1..."
}
```

---

### `draw.peer.joined`

**Who receives it:** The other participant(s) already in the room.  
**When:** Someone else successfully joins via `chat.join`.

```js
socket.on('draw.peer.joined', (data) => {
  console.log('Peer connected:', data.userId);
  // Show "partner connected" indicator
});
```

**Payload**

```jsonc
{
  "userId": "a1b2c3..."
}
```

---

### `draw.peer.left`

**Who receives it:** Remaining participants in the room.  
**When:** A peer emits `draw.leave` OR disconnects.

```js
socket.on('draw.peer.left', (data) => {
  console.log('Peer left:', data.userId);
  // Show "partner disconnected — waiting for them to rejoin" state
  // DO NOT destroy the room; they can rejoin with chat.join
});
```

**Payload**

```jsonc
{
  "userId": "a1b2c3..."
}
```

---

### `draw.stroke`

**Who receives it:** The other participant in the room (not the emitter).  
**When:** Your partner draws something.

```js
socket.on('draw.stroke', (data) => {
  applyStrokeToCanvas(data.stroke);
});
```

**Payload**

```jsonc
{
  "requestId": "b3d2a1...",
  "stroke": { /* whatever shape you sent — passed through unchanged */ }
}
```

---

### `draw.clear`

**Who receives it:** The other participant in the room (not the emitter).  
**When:** Your partner clears the canvas.

```js
socket.on('draw.clear', (data) => {
  clearCanvas();
});
```

**Payload**

```jsonc
{
  "requestId": "b3d2a1..."
}
```

---

### `draw.left`

**Who receives it:** The socket that emitted `draw.leave`.  
**When:** The server confirms you have left the room.

```js
socket.on('draw.left', () => {
  // Navigate away or show "session ended" screen
});
```

**Payload:** `{}` (empty)

---

### `error`

**Who receives it:** The socket whose event handler caused an error.  
**When:** Any server-side handler throws (auth failure, wrong room, bad state, etc.).

```js
socket.on('error', (err) => {
  console.error(`[WS ${err.status}] ${err.message}`);
  // status mirrors HTTP codes: 400 bad request, 403 forbidden, 404 not found, 500 server error
});
```

**Payload**

```jsonc
{
  "message": "You are not part of this chat request",
  "status": 403
}
```

---

## 4. Client → Server events

Emit these with `socket.emit(event, payload)`.

---

### `chat.join`

Join the draw room for an accepted chat request. **Both participants must emit this independently.**

```js
socket.emit('chat.join', { requestId: 'b3d2a1...' });
```

**Payload**

| Field | Type | Required | Notes |
|---|---|---|---|
| `requestId` | UUID string | ✓ | Must be an accepted request you are a party to |

**Server responses:** `chat.joined` (to you), `draw.peer.joined` (to the other person).

If you were already in a different room, the server leaves it and notifies that room's peer automatically.

---

### `draw.leave`

Leave your current room cleanly. Notifies the peer with `draw.peer.left`.

```js
socket.emit('draw.leave');
```

**Payload:** none required.

**Server response:** `draw.left` (to you), `draw.peer.left` (to the room).

---

### `draw.stroke`

Send a drawing stroke to your partner. The `stroke` object is passed through exactly as-is — define whatever shape your canvas needs.

```js
socket.emit('draw.stroke', {
  requestId: 'b3d2a1...',
  stroke: {
    tool: 'pen',
    color: '#ff0000',
    width: 3,
    points: [{ x: 10, y: 20 }, { x: 15, y: 25 }],
  },
});
```

**Payload**

| Field | Type | Required | Notes |
|---|---|---|---|
| `requestId` | UUID string | ✓ | Must be an accepted request you are in a room for |
| `stroke` | any object | ✓ | Passed to partner unchanged |

**Server response:** `draw.stroke` emitted to the other participant only.

---

### `draw.clear`

Tell your partner to clear their canvas.

```js
socket.emit('draw.clear', { requestId: 'b3d2a1...' });
```

**Payload**

| Field | Type | Required | Notes |
|---|---|---|---|
| `requestId` | UUID string | ✓ | Must be an accepted request you are in a room for |

**Server response:** `draw.clear` emitted to the other participant only.

---

## 5. Complete flow walkthroughs

### A — Alice sends a chat request to Bob

```
Alice (client)                   Server                        Bob (client)
─────────────────────────────────────────────────────────────────────────────
                                 ← both connected to /drawback with JWT

POST /chat/requests              → validate, save to DB
  { toDisplayName: "@bob" }      → emit 'chat.requested' to Bob's socket
                                                               ← chat.requested
                                                               shows notification UI
                                                               user clicks "Accept"
                            POST /chat/requests/:id/respond
                              { accept: true }
                                 → update DB status = ACCEPTED
                                 → emit 'chat.response' to Alice's socket
← chat.response                  → emit 'chat.response' to Bob's socket
  { accepted: true, roomId }                                   ← chat.response
                                                                  { accepted: true, roomId }
socket.emit('chat.join',                                       socket.emit('chat.join',
  { requestId })                                                 { requestId })
                                 ← join room (Alice)
← chat.joined                    ← join room (Bob)
                                                               ← chat.joined
← draw.peer.joined               (Bob joined, notify Alice)
                                 (Alice joined, notify Bob)    ← draw.peer.joined

// --- Now both are in the room ---

socket.emit('draw.stroke', …)
                                 → forward to Bob only
                                                               ← draw.stroke

                                                               socket.emit('draw.clear', …)
                                 → forward to Alice only
← draw.clear

// --- Alice leaves ---

socket.emit('draw.leave')
                                 → remove from room
← draw.left                      → notify room
                                                               ← draw.peer.left
                                                               // Bob can rejoin later
                                                               // with another chat.join
```

---

### B — Bob rejects a request

```
                            POST /chat/requests/:id/respond
                              { accept: false }
                                 → update DB status = REJECTED
                                 → emit 'chat.response' to Alice
← chat.response
  { accepted: false, roomId: null }
// Close the pending UI, no room to join
```

---

## 6. Common pitfalls

### Not connected = no real-time events

The socket **must** be connected before any event can be received. If a user is not connected when a `chat.requested` is fired, they will only see the request after the next time they fetch `GET /chat/requests/received` (i.e., on page refresh).

**Fix:** Connect the socket immediately after a successful login and keep it alive throughout the session.

```js
// ✅ Right — connect on login
async function onLoginSuccess(accessToken) {
  saveToken(accessToken);
  connectSocket(accessToken); // connect immediately
  await loadUserProfile();
}

// ❌ Wrong — connecting only when the user navigates to a specific screen
function onDrawScreenOpen() {
  connectSocket(token); // too late, already missed events
}
```

---

### Registering handlers too late

Socket.IO buffers reconnection attempts but does **not** buffer missed in-session events. Register your `socket.on(...)` handlers right after you create the socket, not inside callbacks.

```js
// ✅ Right
const socket = io(URL, { auth: { token } });
socket.on('chat.requested', handleChatRequest);
socket.on('chat.response', handleChatResponse);

// ❌ Wrong — handler registered too late
socket.on('connect', () => {
  socket.on('chat.requested', handleChatRequest); // may have already fired
});
```

---

### Not joining the room after acceptance

After receiving `chat.response` with `accepted: true`, **both** sides must emit `chat.join`. Failing to do so means `draw.stroke` events won't reach you (the room check will throw a 403).

```js
// ✅ Both sides do this immediately on chat.response
socket.on('chat.response', ({ accepted, requestId }) => {
  if (accepted) {
    socket.emit('chat.join', { requestId });
  }
});
```

---

### Token expiry

JWTs expire (default 7 days). A reconnect attempt with an expired token will fail with `connect_error`. Redirect to login and create a fresh socket with the new token.

```js
socket.on('connect_error', (err) => {
  if (err.message === 'Unauthorized') {
    redirectToLogin();
  }
});
```

---

### Sending draw events before `chat.joined`

Emit `draw.stroke` / `draw.clear` only after receiving `chat.joined`. The server rejects events from sockets that haven't joined the room.

---

## 7. Quick reference table

### Server → Client

| Event | Recipient | Trigger |
|---|---|---|
| `chat.requested` | Recipient of a request | `POST /chat/requests` |
| `chat.response` | Both sender & responder | `POST /chat/requests/:id/respond` |
| `chat.joined` | The socket that emitted `chat.join` | `chat.join` |
| `draw.peer.joined` | All others in room | `chat.join` by someone else |
| `draw.peer.left` | All others in room | `draw.leave` or disconnect |
| `draw.stroke` | All others in room | `draw.stroke` |
| `draw.clear` | All others in room | `draw.clear` |
| `draw.left` | The socket that emitted `draw.leave` | `draw.leave` |
| `error` | The socket that caused the error | Any handler failure |

### Client → Server

| Event | Payload | Purpose |
|---|---|---|
| `chat.join` | `{ requestId }` | Enter a draw room |
| `draw.leave` | _(none)_ | Exit the current room |
| `draw.stroke` | `{ requestId, stroke }` | Send a drawing stroke |
| `draw.clear` | `{ requestId }` | Tell partner to clear canvas |
