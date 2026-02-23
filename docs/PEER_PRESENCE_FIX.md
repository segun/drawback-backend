# Peer Presence Fix — `chat.joined` now includes `peers`

## The problem

When two users joined a draw room, the second person to join never received a `draw.peer.joined` event for the user who was already there. `draw.peer.joined` only fires for participants who were **already in the room** — not for the person who just joined. So:

- **A joins first** → `chat.joined` ✓, no peers yet (correct)
- **B joins second** → `chat.joined` ✓, but never told A is already there ✗
- A receives `draw.peer.joined` for B ✓

B's peer-presence badge would stay in limbo until A left and rejoined.

---

## The fix

The `chat.joined` payload now includes a `peers` array — the user IDs of everyone already in the room at the moment you joined.

### New `chat.joined` payload

```jsonc
{
  "roomId": "chat:b3d2a1...",
  "requestId": "b3d2a1...",
  "peers": ["a1b2c3..."]   // user IDs already present; empty [] if you joined first
}
```

`peers` is always present. It is an empty array when you are the first to join.

---

## What to do on the frontend

Replace any workaround that relied on re-emitting `chat.join` or waiting for a reflected `draw.peer.joined`. The rule is now simple:

```js
socket.on('chat.joined', ({ roomId, requestId, peers }) => {
  // You're in the room.
  if (peers.length > 0) {
    // Peer is already here — show "partner connected" immediately.
    setPeerPresent(true);
  }
});

socket.on('draw.peer.joined', ({ userId }) => {
  // Peer joined AFTER you — show "partner connected".
  setPeerPresent(true);
});

socket.on('draw.peer.left', ({ userId }) => {
  setPeerPresent(false);
});
```

That's all. No re-joins, no pings, no special-casing join order.

---

## Event summary

| Event | Who receives it | Peer-presence signal? |
|---|---|---|
| `chat.joined` | You (the joiner) | Yes — check `peers[]` |
| `draw.peer.joined` | You, if peer joined **after** you | Yes |
| `draw.peer.left` | You, when peer leaves/disconnects | Yes (gone) |
