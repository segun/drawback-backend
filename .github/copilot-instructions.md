# GitHub Copilot Instructions

## Project Overview

**Drawback** is a real-time collaborative drawing backend built with NestJS. Users can connect, send chat/draw requests, and collaborate on a shared canvas over WebSockets. The backend exposes REST endpoints under the `/api` global prefix for auth/users/chat, and a Socket.io namespace (`/drawback`) for real-time drawing.

## Tech Stack

- **Runtime**: Node.js with TypeScript (strict mode)
- **Framework**: NestJS v11
- **Database**: MySQL 8 via TypeORM v0.3 (migrations only — `synchronize` is always `false`)
- **ORM**: TypeORM with repository pattern
- **Auth**: JWT (passport-jwt) + bcrypt v6 password hashing (cost factor 12)
- **Real-time**: Socket.io with optional Redis adapter (`@socket.io/redis-adapter` + `ioredis`)
- **Email**: Nodemailer v8 via `MailService`
- **Rate limiting**: `@nestjs/throttler` with named throttles (`short`, `auth`)
- **Validation**: `class-validator` + `class-transformer` — globally applied via `ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true })`
- **Testing**: Jest with `@nestjs/testing`
- **Package manager**: Yarn (use `yarn` for all commands, not `npm`)

## Project Structure

```
src/
  auth/          # JWT auth: register (email activation), login, resend-confirmation, guards, JWT strategy
  chat/          # Chat requests (send/accept/reject/cancel) and saved chats
  mail/          # Email sending via Nodemailer
  realtime/      # Socket.io DrawGateway + DTOs for real-time drawing events
  users/         # User profiles, search, user blocks, user mode (PUBLIC/PRIVATE), account deletion
  app.module.ts  # Root module — wires ConfigModule, TypeORM, Throttler, feature modules
  data-source.ts # TypeORM DataSource used by CLI for migrations
  main.ts        # Bootstrap — sets global prefix 'api', enables CORS, registers global pipes/interceptors
```

## REST API Surface

All routes are prefixed with `/api`.

### Auth (`/api/auth`)
| Method | Path | Description |
|--------|------|-------------|
| POST | `/auth/register` | Register; sends activation email |
| GET | `/auth/confirm/:token` | Confirm email — redirects to `FRONTEND_URL/confirm?status=…` |
| POST | `/auth/resend-confirmation` | Re-send activation email (generic response to prevent enumeration) |
| POST | `/auth/login` | Returns JWT access token |

Auth routes use `@Throttle({ auth: { ttl: 60000, limit: 5 } })`.

### Users (`/api/users`) — all require `JwtAuthGuard`
| Method | Path | Description |
|--------|------|-------------|
| GET | `/users/me` | Get current user profile |
| PATCH | `/users/me` | Update display name |
| PATCH | `/users/me/mode` | Set PUBLIC/PRIVATE mode |
| DELETE | `/users/me` | Delete own account (204) |
| GET | `/users/public` | List public users (excludes blocks) |
| GET | `/users/search?q=` | Search public users by display name prefix (excludes blocks) |
| GET | `/users/me/blocked` | List blocked users |
| POST | `/users/:id/block` | Block a user (204) |
| DELETE | `/users/:id/block` | Unblock a user (204) |

### Chat (`/api/chat`) — all require `JwtAuthGuard`
| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat/requests` | Send a chat request |
| GET | `/chat/requests/sent` | List sent requests |
| GET | `/chat/requests/received` | List received requests |
| POST | `/chat/requests/:requestId/respond` | Accept or reject a request |
| DELETE | `/chat/requests/:requestId` | Cancel a sent request (204) |
| POST | `/chat/requests/:requestId/save` | Save a drawing session |
| GET | `/chat/saved` | List saved chats |
| DELETE | `/chat/saved/:savedChatId` | Delete a saved chat (204) |

## WebSocket Events (`/drawback` namespace)

Authentication is via a JWT token supplied as `auth.token`, `Authorization: Bearer <token>` header, or `?token=` query param at handshake time.

### Server → Client events
| Event | Payload | Description |
|-------|---------|-------------|
| `chat.requested` | `{ requestId, fromUserId, … }` | Pushed to recipient when a chat request arrives |
| `chat.response` | `{ requestId, status, … }` | Pushed to sender when their request is accepted/rejected |
| `chat.joined` | `{ roomId, requestId }` | Confirmed to the joining socket |
| `draw.peer.joined` | `{ userId }` | Pushed to room when a peer joins |
| `draw.peer.left` | `{ userId }` | Pushed to room when a peer disconnects or leaves |
| `draw.stroke` | `DrawStrokeDto` | Relay of peer's stroke |
| `draw.clear` | `DrawClearDto` | Relay of canvas clear |
| `draw.left` | `{}` | Confirmed to socket that called `draw.leave` |
| `error` | `{ message, status }` | Emitted on validation/auth failures inside handlers |

### Client → Server events
| Event | Payload DTO | Description |
|-------|------------|-------------|
| `chat.join` | `JoinChatDto` | Join the draw room for an accepted chat request |
| `draw.leave` | _(none)_ | Leave the current draw room |
| `draw.stroke` | `DrawStrokeDto` | Broadcast a stroke to the room |
| `draw.clear` | `DrawClearDto` | Broadcast a canvas clear to the room |

## Conventions & Patterns

### General
- All source files live under `src/`. Follow the existing module structure.
- Use **async/await** throughout; never use raw `.then()` chains.
- Prefer **explicit types** over `any`. Do not suppress TypeScript errors with casts unless unavoidable; add a comment explaining why.
- Non-null assertions (`!`) are acceptable on entity fields that TypeORM always fills.

### NestJS Modules
- Each feature lives in its own module directory containing: `*.module.ts`, `*.service.ts`, `*.controller.ts`, `dto/`, `entities/`, `enums/`.
- Register new entities in both the feature module (`TypeOrmModule.forFeature`) and ensure migrations handle schema changes.
- Use `forwardRef()` only when circular dependencies are unavoidable (see `DrawGateway` ↔ `ChatService`).

### Entities
- Primary keys: always `@PrimaryGeneratedColumn('uuid')`.
- Include `@CreateDateColumn()` and `@UpdateDateColumn()` on every entity.
- Sensitive fields (passwords, tokens, socketId) must be decorated with `@Exclude()` from `class-transformer`.
- Use TypeORM `enum` columns backed by TypeScript enums (see `UserMode`, `ChatRequestStatus`).

### DTOs
- Every incoming request body must have a DTO using `class-validator` decorators.
- DTOs should be in `dto/` subdirectory of the relevant module.
- Always apply `@IsString()`, `@IsEmail()`, `@IsEnum()`, `@IsUUID()`, etc. — do not leave fields unvalidated.

### Business Rules
- `displayName` is always stored and searched as **lowercase**. Normalise in the service layer before saving or querying.
- Block checks are bidirectional — both `blockerId → blockedId` and `blockedId → blockerId` directions are excluded from public listing and search results.
- `emitToUser` in `DrawGateway` uses the in-memory `userToSocket` map first; on a miss it falls back to the `socketId` persisted in the DB, so notifications survive server restarts.

### Auth & Guards
- Protect routes with `@UseGuards(JwtAuthGuard)`.
- Access the authenticated user in controllers via `@CurrentUser()` (custom decorator at `src/auth/current-user.decorator.ts`).
- Never expose `passwordHash`, `activationToken`, or `socketId` in API responses — `@Exclude()` + `ClassSerializerInterceptor` handles this globally.
- Apply `@Throttle({ auth: { ttl: 60000, limit: 5 } })` to all auth mutation endpoints (register, login, resend-confirmation).

### Database / Migrations
- **Never** set `synchronize: true`. All schema changes require a TypeORM migration.
- Generate migrations: `yarn migration:generate src/migrations/<MigrationName>`
- Run migrations: `yarn migration:run`
- Revert migrations: `yarn migration:revert`
- Drop schema (dev only): `yarn db:reset`
- The TypeORM CLI uses `src/data-source.ts` as the data source.

### Real-time (WebSocket Gateway)
- The Socket.io namespace is `/drawback`.
- `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))` is applied at the **class level** on `DrawGateway` — individual `@SubscribeMessage` handlers do not need to repeat it.
- Track connected users via the in-memory maps in `DrawGateway` (`userToSocket`, `socketToUser`, `socketToRoom`). Do not use the database for transient socket state.
- Redis adapter is **optional** — enabled only when `REDIS_HOST` is set. Configured via `REDIS_HOST`, `REDIS_PORT` (default 6379), and optionally `REDIS_PASSWORD`.

### Error Handling
- Throw NestJS built-in exceptions (`BadRequestException`, `ConflictException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`) — never throw raw `Error`.
- Do not swallow exceptions; let the global exception filter handle HTTP responses.
- Inside WebSocket handlers, catch errors and call the private `emitError(client, err)` helper instead of letting them propagate uncaught.

### Environment Variables
- Access config via `ConfigService` (never `process.env` directly in services/controllers).
- Required env vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `FRONTEND_URL`, `MAIL_*` settings.
- Optional env vars: `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `PORT` (default 3000).

### Testing
- Unit tests live alongside source files (`*.spec.ts`).
- E2E tests live in `test/`.
- Use `@nestjs/testing` `Test.createTestingModule()` for unit and integration tests.
- Mock repositories and services with Jest mocks; do not connect to a real database in unit tests.

## Code Style

- **Formatting**: Prettier (run `yarn format`).
- **Linting**: ESLint (run `yarn lint`).
- **Imports**: Use relative imports within the same module and relative cross-module imports from `src/`.
- Use `readonly` for injected dependencies in constructors.
- Prefer `private readonly` for constructor-injected services.
