# Group Chat — Frontend Integration Guide

## Overview

Group chats are persistent rooms that any member can join over WebSocket and broadcast drawing/messaging events to everyone simultaneously. The flow is:

1. **Create** a group via REST
2. **Add members** via REST (owner only)
3. **Join the room** via WebSocket — all drawing events then reach every connected member automatically
4. **Leave** with `draw.leave` (same as 1-to-1 chats)

---

## Authentication

All REST calls require the JWT in the `Authorization: Bearer <token>` header.

All WebSocket connections require the JWT at handshake time, supplied as **one** of:
- `auth: { token: '<jwt>' }` (Socket.io client option — preferred)
- `Authorization: Bearer <token>` header
- `?token=<jwt>` query parameter

---

## REST API

All endpoints are under the global prefix `/api` and require a valid JWT.

### Data shapes

**GroupChat object** (returned by most endpoints)
```json
{
  "id": "uuid",
  "name": "My Group",
  "createdByUserId": "uuid",
  "createdBy": { "id": "uuid", "displayName": "alice" },
  "members": [
    {
      "id": "uuid",
      "groupChatId": "uuid",
      "userId": "uuid",
      "role": "OWNER",
      "joinedAt": "2026-03-30T10:00:00.000Z",
      "user": { "id": "uuid", "displayName": "alice" }
    },
    {
      "id": "uuid",
      "groupChatId": "uuid",
      "userId": "uuid",
      "role": "MEMBER",
      "joinedAt": "2026-03-30T10:05:00.000Z",
      "user": { "id": "uuid", "displayName": "bob" }
    }
  ],
  "createdAt": "2026-03-30T10:00:00.000Z",
  "updatedAt": "2026-03-30T10:00:00.000Z"
}
```

`role` is either `"OWNER"` or `"MEMBER"`. Use `createdByUserId` to determine the owner UI.

---

### `POST /api/chat/groups` — Create a group

The authenticated user becomes the owner and is automatically added as the first member.

**Request body**
```json
{ "name": "Weekend painters" }
```
`name` — required string, 1–100 characters.

**Response `200`** — the new GroupChat object.

---

### `GET /api/chat/groups` — List the current user's groups

Returns every group the authenticated user belongs to (as owner or member), sorted newest-first.

**Response `200`** — array of GroupChat objects.

---

### `GET /api/chat/groups/:groupId` — Get a single group

Only accessible if the authenticated user is a member. Returns `404` for both missing groups and groups the user is not in (to avoid leaking existence).

**Response `200`** — GroupChat object.

---

### `POST /api/chat/groups/:groupId/members` — Add a member

**Owner only.** Looks up the target user by their `displayName`.

**Request body**
```json
{ "displayName": "bob" }
```

**Response `200`** — updated GroupChat object (with the new member included).

**Error cases**

| Status | Reason |
|--------|--------|
| `403` | Caller is not a member, or is not the owner |
| `400` | Target is already a member |
| `404` | Group not found, or target user not found |
| `403` | Block exists between caller and target |

---

### `DELETE /api/chat/groups/:groupId/members/:userId` — Remove a member / Leave

- **Owner** can remove any `userId`.
- **Regular member** can only call this with their **own** `userId` (i.e. leaving the group).
- The owner cannot be removed through this endpoint.

**Response `204 No Content`**

**Error cases**

| Status | Reason |
|--------|--------|
| `403` | Non-owner trying to remove someone else |
| `400` | Attempting to remove the owner |
| `404` | Group or member not found |

When a user is removed, if they are currently connected to the room they will receive a `group.removed` WebSocket event and be kicked out of the room automatically.

---

### `DELETE /api/chat/groups/:groupId` — Delete the group

**Owner only.** Forces all currently-connected members out of the room (they receive `draw.room.closed`), then deletes the group and all memberships.

**Response `204 No Content`**

---

## WebSocket API

Connect to the `/drawback` namespace. One socket connection handles all rooms (1-to-1 and groups).

### Joining a group room

**Emit: `group.join`**
```json
{ "groupId": "<uuid>" }
```

The server validates that the authenticated user is a member of the group. If not, an `error` event is emitted back.

A socket can only be in **one room at a time**. Calling `group.join` while already in another room will silently leave the previous room first (the other room receives `draw.peer.left`).

---

### Events received after joining

**`group.joined`** — confirmation sent only to the joining socket
```json
{
  "roomId": "group:<groupId>",
  "groupId": "<uuid>",
  "peers": ["<userId>", "<userId>"]
}
```
`peers` is the list of user IDs **already in the room** at the time of joining. Use this to populate an initial presence indicator.

**`group.member.joined`** — broadcast to everyone **else** in the room
```json
{ "userId": "<uuid>" }
```

---

### Drawing events (same as 1-to-1)

Once inside a group room, use the exact same events as a 1-to-1 chat. They broadcast to every member currently in the room.

| Emit | Payload | Effect |
|------|---------|--------|
| `draw.stroke` | `DrawStrokeDto` | Relayed to all room members as `draw.stroke` + `userId` |
| `draw.clear` | `DrawClearDto` | Relayed to all room members as `draw.clear` + `userId` |
| `draw.emote` | `DrawEmoteDto` | Relayed to all room members as `draw.emote` + `userId` |
| `draw.leave` | _(no payload)_ | Leave the room; others receive `draw.peer.left` |

---

### Events to handle from the server

| Event | When | Payload |
|-------|------|---------|
| `group.member.joined` | Another member joined the room | `{ userId }` |
| `group.member.left` | A member was removed (by owner) while in the room, or left | `{ userId }` |
| `group.removed` | **You** were removed from the group while connected | `{ roomId, reason }` — leave the room UI and show the reason |
| `draw.room.closed` | The group was deleted by the owner | `{ reason }` — tear down the entire room UI |
| `draw.peer.left` | A member used `draw.leave` to leave voluntarily | `{ userId }` |
| `draw.stroke` | A peer drew a stroke | `{ ...strokeData, userId }` |
| `draw.clear` | A peer cleared the canvas | `{ ...clearData, userId }` |
| `draw.emote` | A peer sent an emote | `{ ...emoteData, userId }` |
| `error` | Validation or auth failure in a handler | `{ message, status }` |

---

## Recommended UI flow

```
User opens group list
  → GET /api/chat/groups

User taps a group
  → GET /api/chat/groups/:groupId  (refresh member list)
  → socket.emit('group.join', { groupId })
  → on 'group.joined': set canvas ready, mark peers as online

While in room
  → stroke/clear/emote events flow both ways

User presses "Leave"
  → socket.emit('draw.leave')
  → on 'draw.left': navigate back to group list

Owner adds a member in settings
  → POST /api/chat/groups/:groupId/members  { displayName }
  → update local member list with returned GroupChat

Owner removes a member
  → DELETE /api/chat/groups/:groupId/members/:userId
  → update local member list

Non-owner leaves
  → DELETE /api/chat/groups/:groupId/members/<ownUserId>
  → remove group from local list

On 'group.removed' (server-initiated kick)
  → navigate away from room, show toast with reason

On 'draw.room.closed' (group deleted)
  → navigate away from room, show "This group was deleted"
```

---

## Notes

- `displayName` values are stored lowercase; normalise before display if needed.
- A user is limited to **one active socket** — connecting a second device disconnects the first. Handle reconnection accordingly.
- Group rooms survive server restarts because membership is persisted in the database and room state is managed via the Redis adapter.
