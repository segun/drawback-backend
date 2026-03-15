# Throw-On-Missing Audit and Refactor Plan

## Context

Current pattern used across the codebase:

1. Query DB for an entity.
2. If missing, throw an exception.
3. Return non-null type from the method.

This creates hidden control flow and breaks call sites that try to handle null explicitly (for example [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L197)).

## Scope

This audit covers application code in `src/` (not migration files), and identifies:

1. Methods that throw when a lookup misses.
2. Callers coupled to this throw contract instead of explicit null checks.
3. Proposed fixes to migrate to nullable contracts.

## Todo

- [x] Refactor `UsersService.findById` and `UsersService.findOneWithSubscription` to nullable returns.
- [x] Update immediate callers in `DrawGateway`, `UsersController`, `UsersService`, and `ChatService`.
- [x] Refactor `ReportsService.findReportById` and `AdminService.getUserDetails` to nullable returns.
- [x] Refactor `ChatService` missing-request and missing-saved-chat flows to explicit null handling.
- [x] Refactor `AuthService` missing-user and missing-credential flows to explicit null handling.
- [x] Update unit tests that currently assert throw-on-missing behavior.
- [x] Run focused validation and fix any regressions.

## High-Impact Mismatch (Already Buggy)

1. [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L197) calls [src/users/users.service.ts](src/users/users.service.ts#L36) and then checks `if (!user)`, but `findById` throws before that branch. Result: `client.emit('error', { message: 'User not found' })` is unreachable.
2. [src/users/users.controller.ts](src/users/users.controller.ts#L39) calls [src/users/users.service.ts](src/users/users.service.ts#L44) and uses optional chaining (`userWithSub?.`), but `findOneWithSubscription` currently throws on missing user.

## Throwing Lookup Methods and Coupled Callers

### 1) UsersService

Throwing methods:

1. [src/users/users.service.ts](src/users/users.service.ts#L36) `findById(id): Promise<User>` throws on missing user.
2. [src/users/users.service.ts](src/users/users.service.ts#L44) `findOneWithSubscription(id): Promise<User>` throws on missing user.

Coupled callers of `findById`:

1. [src/users/users.service.ts](src/users/users.service.ts#L79)
2. [src/users/users.service.ts](src/users/users.service.ts#L94)
3. [src/users/users.service.ts](src/users/users.service.ts#L100)
4. [src/users/users.service.ts](src/users/users.service.ts#L165)
5. [src/users/users.service.ts](src/users/users.service.ts#L175)
6. [src/users/users.service.ts](src/users/users.service.ts#L244)
7. [src/chat/chat.service.ts](src/chat/chat.service.ts#L37)
8. [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L197)
9. [src/users/users.service.spec.ts](src/users/users.service.spec.ts#L104) (test currently asserts throw)

Coupled callers of `findOneWithSubscription`:

1. [src/users/users.controller.ts](src/users/users.controller.ts#L39)

### 2) ChatService (inline throwing lookups)

Throw sites:

1. [src/chat/chat.service.ts](src/chat/chat.service.ts#L41) `toUser` missing -> `NotFoundException`.
2. [src/chat/chat.service.ts](src/chat/chat.service.ts#L116) `request` missing -> `NotFoundException`.
3. [src/chat/chat.service.ts](src/chat/chat.service.ts#L169) `request` missing -> `NotFoundException`.
4. [src/chat/chat.service.ts](src/chat/chat.service.ts#L192) `request` missing -> `NotFoundException`.
5. [src/chat/chat.service.ts](src/chat/chat.service.ts#L247) `request` missing -> `NotFoundException`.
6. [src/chat/chat.service.ts](src/chat/chat.service.ts#L285) `saved` missing -> `NotFoundException`.
7. [src/chat/chat.service.ts](src/chat/chat.service.ts#L301) `request` missing -> `NotFoundException`.

Coupled callers:

1. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L29) `createRequest`
2. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L48) `respondToRequest`
3. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L57) `cancelRequest`
4. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L66) `removeAcceptedChat`
5. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L76) `saveChat`
6. [src/chat/chat.controller.ts](src/chat/chat.controller.ts#L90) `deleteSavedChat`
7. [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L364) `getAcceptedRoomForUser` (currently relies on throw -> caught by gateway `try/catch`)

### 3) ReportsService

Throwing method:

1. [src/reports/reports.service.ts](src/reports/reports.service.ts#L100) `findReportById(reportId): Promise<Report>` throws on missing report.

Coupled callers:

1. [src/reports/reports.service.ts](src/reports/reports.service.ts#L118)
2. [src/reports/reports.service.ts](src/reports/reports.service.ts#L142)
3. [src/reports/reports.controller.ts](src/reports/reports.controller.ts#L52)
4. [src/reports/reports.service.spec.ts](src/reports/reports.service.spec.ts#L162) (test asserts throw)

### 4) AdminService

Throwing method:

1. [src/admin/admin.service.ts](src/admin/admin.service.ts#L103) `getUserDetails(userId): Promise<User>` throws on missing user.

Coupled caller:

1. [src/admin/admin.controller.ts](src/admin/admin.controller.ts#L69)

### 5) BackupService

Throwing lookup method:

1. [src/backup/backup.service.ts](src/backup/backup.service.ts#L135) `resolveRestoreTarget(...)` throws on missing backup candidates.

Throw sites:

1. [src/backup/backup.service.ts](src/backup/backup.service.ts#L142)
2. [src/backup/backup.service.ts](src/backup/backup.service.ts#L152)
3. [src/backup/backup.service.ts](src/backup/backup.service.ts#L161)

Coupled callers:

1. [src/backup/backup.service.ts](src/backup/backup.service.ts#L66)
2. [src/backup/cli.ts](src/backup/cli.ts#L132)

### 6) AuthService (not-found represented as Unauthorized/BadRequest)

Throw sites with missing DB records:

1. [src/auth/auth.service.ts](src/auth/auth.service.ts#L274) user lookup miss in `login` -> `UnauthorizedException('Invalid credentials')`
2. [src/auth/auth.service.ts](src/auth/auth.service.ts#L348) user lookup miss in `loginAndDelete` -> `UnauthorizedException('Invalid credentials')`
3. [src/auth/auth.service.ts](src/auth/auth.service.ts#L320) user lookup miss -> `UnauthorizedException('User not found')`
4. [src/auth/auth.service.ts](src/auth/auth.service.ts#L431) user lookup miss -> `UnauthorizedException('User not found')`
5. [src/auth/auth.service.ts](src/auth/auth.service.ts#L482) user lookup miss -> `UnauthorizedException('User not found')`
6. [src/auth/auth.service.ts](src/auth/auth.service.ts#L654) credential lookup miss -> `UnauthorizedException('Invalid passkey')`
7. [src/auth/auth.service.ts](src/auth/auth.service.ts#L783) credential lookup miss -> `BadRequestException('Passkey not found')`

Coupled callers:

1. [src/users/users.controller.ts](src/users/users.controller.ts#L96) `requestAccountDeletion`
2. [src/auth/auth.service.ts](src/auth/auth.service.ts#L358) `loginAndDelete` chaining into `requestAccountDeletion`
3. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L159) `startPasskeyRegistration`
4. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L169) `finishPasskeyRegistration`
5. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L181) `finishPasskeyLogin`
6. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L200) `deleteCredential`
7. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L106) `login`
8. [src/auth/auth.controller.ts](src/auth/auth.controller.ts#L113) `loginAndDelete`

### 7) PurchasesService

Throw site:

1. [src/purchases/purchases.service.ts](src/purchases/purchases.service.ts#L36) user lookup miss -> raw `Error('User not found')`.

Coupled callers:

1. No active call sites found for `unlockDiscoveryAccess` (method appears unused).

## Exception-Coupled Tests (Must Change in Migration)

1. Users service throw assertions:
   - [src/users/users.service.spec.ts](src/users/users.service.spec.ts#L104)
   - [src/users/users.service.spec.ts](src/users/users.service.spec.ts#L262)
2. Reports service throw assertions:
   - [src/reports/reports.service.spec.ts](src/reports/reports.service.spec.ts#L162)
   - [src/reports/reports.service.spec.ts](src/reports/reports.service.spec.ts#L165)
   - [src/reports/reports.service.spec.ts](src/reports/reports.service.spec.ts#L246)
3. Chat service throw assertions:
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L134)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L142)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L150)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L164)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L185)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L266)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L279)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L325)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L335)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L370)
   - [src/chat/chat.service.spec.ts](src/chat/chat.service.spec.ts#L398)
4. Auth service throw assertions:
   - [src/auth/auth.service.spec.ts](src/auth/auth.service.spec.ts#L207)
   - [src/auth/auth.service.passkey.spec.ts](src/auth/auth.service.passkey.spec.ts#L204)
   - [src/auth/auth.service.passkey.spec.ts](src/auth/auth.service.passkey.spec.ts#L286)
   - [src/auth/auth.service.passkey.spec.ts](src/auth/auth.service.passkey.spec.ts#L414)
   - [src/auth/auth.service.passkey.spec.ts](src/auth/auth.service.passkey.spec.ts#L510)

## Proposed Refactor Strategy

Note: this refactor focuses on lookup misses. Invariant-protection throws (for example backup metadata consistency checks in [src/backup/mongo-backup.repository.ts](src/backup/mongo-backup.repository.ts#L93) and [src/backup/mongo-backup.repository.ts](src/backup/mongo-backup.repository.ts#L292)) should remain exceptions.

### Phase 1: Introduce nullable lookup contracts

1. Convert lookup helpers to return `T | null`:
   - `UsersService.findById` -> `Promise<User | null>`
   - `UsersService.findOneWithSubscription` -> `Promise<User | null>`
   - `ReportsService.findReportById` -> `Promise<Report | null>`
   - `AdminService.getUserDetails` -> `Promise<User | null>`
   - `BackupService.resolveRestoreTarget` -> `Promise<BackupRecord | null>`
2. For service methods where lookup+throw is inlined (not helper-based), either:
   - extract private nullable helpers, or
   - keep inline query and return null-result objects, not exceptions.

### Phase 2: Move decision to the boundary

1. Gateway boundaries (`draw.gateway`) should always explicitly handle null and emit socket messages.
2. REST controllers should translate null to HTTP exceptions where desired (404/401/400) instead of inner services auto-throwing.
3. Internal service-to-service calls should branch on null with explicit behavior (early return, no-op, or domain-specific response object).

### Phase 3: Update all coupled callers

1. Replace implicit throw dependence in every caller listed above with explicit null checks.
2. Remove dead null branches that were previously unreachable due to thrown exceptions.
3. Align method return types, controller response behavior, and gateway emit behavior.

### Phase 4: Test migration

1. Update tests that currently assert `rejects.toThrow` for lookup misses.
2. Add tests for explicit null-handling behavior at boundaries:
   - Socket error emit behavior (especially [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L197)).
   - Controller mapping from null -> HTTP status.

## Recommended First Cut (Minimal-Risk)

1. Start with `UsersService.findById` and `DrawGateway.handleConnection` because this is an active bug.
2. Next, migrate `findOneWithSubscription` and [src/users/users.controller.ts](src/users/users.controller.ts#L39) to consistent nullable behavior.
3. Then migrate `ReportsService.findReportById` and `AdminService.getUserDetails` (small, contained surfaces).
4. Finally migrate chat/auth paths in one PR focused on API contract changes and test updates.
