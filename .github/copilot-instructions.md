# GitHub Copilot Instructions

## Project Overview

**Drawback** is a real-time collaborative drawing backend built with NestJS. Users can connect, send chat/draw requests, and collaborate on a shared canvas over WebSockets. The backend exposes REST endpoints for auth/users/chat and a Socket.io namespace (`/drawback`) for real-time drawing.

## Tech Stack

- **Runtime**: Node.js with TypeScript (strict mode)
- **Framework**: NestJS v11
- **Database**: MySQL 8 via TypeORM v0.3 (migrations only — `synchronize` is always `false`)
- **ORM**: TypeORM with repository pattern
- **Auth**: JWT (passport-jwt) + bcrypt password hashing
- **Real-time**: Socket.io with Redis adapter (`@socket.io/redis-adapter` + `ioredis`)
- **Email**: Nodemailer via `MailService`
- **Rate limiting**: `@nestjs/throttler`
- **Validation**: `class-validator` + `class-transformer` — always applied via `ValidationPipe({ whitelist: true, transform: true })`
- **Testing**: Jest with `@nestjs/testing`

## Project Structure

```
src/
  auth/          # JWT auth: register (email activation), login, guards, JWT strategy
  chat/          # Chat requests (send/accept/reject) and saved chats
  mail/          # Email sending via Nodemailer
  realtime/      # Socket.io DrawGateway + DTOs for real-time drawing events
  users/         # User profiles, user blocks, user mode (PUBLIC/PRIVATE)
  app.module.ts  # Root module — wires ConfigModule, TypeORM, Throttler, feature modules
  data-source.ts # TypeORM DataSource used by CLI for migrations
  main.ts        # Bootstrap
```

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

### Auth & Guards
- Protect routes with `@UseGuards(JwtAuthGuard)`.
- Access the authenticated user in controllers via `@CurrentUser()` (custom decorator at `src/auth/current-user.decorator.ts`).
- Never expose `passwordHash`, `activationToken`, or `socketId` in API responses — `@Exclude()` + `ClassSerializerInterceptor` handles this.

### Database / Migrations
- **Never** set `synchronize: true`. All schema changes require a TypeORM migration.
- Generate migrations: `npm run migration:generate src/migrations/<MigrationName>`
- Run migrations: `npm run migration:run`
- The TypeORM CLI uses `src/data-source.ts` as the data source.

### Real-time (WebSocket Gateway)
- The Socket.io namespace is `/drawback`.
- All gateway event handlers that accept a payload must have a corresponding DTO and use `@UsePipes(new ValidationPipe({ whitelist: true, transform: true }))`.
- Track connected users via the in-memory maps in `DrawGateway` (`userToSocket`, `socketToUser`, `socketToRoom`). Do not use the database for transient socket state.
- Redis adapter is optional (only enabled when `REDIS_URL` env var is set).

### Error Handling
- Throw NestJS built-in exceptions (`BadRequestException`, `ConflictException`, `NotFoundException`, `UnauthorizedException`, `ForbiddenException`) — never throw raw `Error`.
- Do not swallow exceptions; let the global exception filter handle HTTP responses.

### Environment Variables
- Access config via `ConfigService` (never `process.env` directly in services/controllers).
- Required env vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `JWT_SECRET`, `REDIS_URL` (optional), `MAIL_*` settings.

### Testing
- Unit tests live alongside source files (`*.spec.ts`).
- E2E tests live in `test/`.
- Use `@nestjs/testing` `Test.createTestingModule()` for unit and integration tests.
- Mock repositories and services with Jest mocks; do not connect to a real database in unit tests.

## Code Style

- **Formatting**: Prettier (run `npm run format`).
- **Linting**: ESLint (run `npm run lint`).
- **Imports**: Use path aliases if configured; otherwise use relative imports within the same module and absolute-style cross-module imports from `src/`.
- Use `readonly` for injected dependencies in constructors.
- Prefer `private readonly` for constructor-injected services.
