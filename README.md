# DrawkcaB Backend (NestJS)

Backend-only API + WebSocket server for DrawkcaB.

## Stack
- yarn
- NestJS 11
- MySQL via TypeORM
- Socket.IO for realtime chat notifications + drawing sync
- Optional Redis Socket.IO adapter for horizontal scaling

## Setup

1. Copy `.env.example` to `.env`.
2. Set MySQL config values.
3. Install dependencies:

```bash
yarn install
```

4. Start dev server:

```bash
yarn start:dev
```

## REST API

- `POST /users/register` body: `{ number, name? }`
- `PATCH /users/:id/mode` body: `{ mode: "PUBLIC" | "PRIVATE" }`
- `GET /users/public?excludeUserId=<uuid>`
- `GET /users/search?number=<phone>`
- `POST /chat/requests` body: `{ fromUserId, toNumber }`
- `POST /chat/requests/:requestId/respond` body: `{ responderUserId, accept }`

## WebSocket

- Namespace: `/drawback`
- Connect with `auth.userId` (or query `userId`)
- Events:
  - client → server: `chat.join` `{ requestId, userId }`
  - client → server: `draw.stroke` `{ requestId, userId, stroke }`
  - client → server: `draw.clear` `{ requestId, userId }`
  - server → client: `chat.requested`
  - server → client: `chat.response`
  - server → client: `draw.stroke`
  - server → client: `draw.clear`

## Redis and queue guidance

- Queue: not needed for current MVP.
- Redis: **Caching has been removed** from the application to simplify operations and eliminate cache invalidation bugs. The Socket.IO Redis adapter for horizontal scaling can still be enabled if needed by setting `REDIS_URL` (see [realtime.module.ts](src/realtime/realtime.module.ts)).
- The CacheModule and CacheService remain in the codebase but are not currently used. You can re-enable caching for specific hot endpoints if needed in the future.
