# Bugs and Recommended Fixes

This document outlines bugs and issues identified in the Drawback backend codebase, along with recommended fixes.

---

## Critical Security Issues

### 1. Insecure Default JWT Secret ✅ FIXED

**Location:** [src/auth/jwt.strategy.ts](src/auth/jwt.strategy.ts#L24), [src/auth/auth.module.ts](src/auth/auth.module.ts#L20)

**Status:** Fixed — Application now fails fast if `JWT_SECRET` is not configured.

**Changes made:**
- Removed insecure default fallback `'changeme-secret'`
- JWT_SECRET validation now throws error on startup if not set
- JWT_EXPIRES_IN defaults to `'7d'` hardcoded in code
- REDIS_PORT defaults to `6379` hardcoded
- DB_POOL_SIZE defaults to `20` hardcoded

---

### 2. Activation Tokens Never Expire ✅ FIXED

**Location:** [src/auth/auth.service.ts](src/auth/auth.service.ts#L44-L57)

**Status:** Fixed — Activation tokens now expire after 24 hours.

**Changes made:**
1. Added `activationTokenExpiry` column to User entity
2. Created migration [1772200000000-AddActivationTokenExpiry.ts](src/migrations/1772200000000-AddActivationTokenExpiry.ts)
3. Set expiry in `register()` method (24 hours)
4. Check expiry in `confirmEmail()` method
5. Refresh expiry in `resendConfirmationEmail()` method

---

### 3. Overly Permissive CORS Configuration ✅ FIXED

**Location:** [src/main.ts](src/main.ts#L17-L95)

**Status:** Fixed — CORS now requires ALLOWED_ORIGINS to be set and validates all requests.

**Changes made:**
- Added `parseAllowedOrigins()` function that accepts origins from `ALLOWED_ORIGINS` env variable
- Supports both JSON array format (`["http://localhost:3001"]`) and comma-separated format
- **App exits with error if ALLOWED_ORIGINS is not set** — no insecure defaults
- Added custom middleware for server-side origin validation (applies to all requests, not just browsers)
- Handles preflight OPTIONS requests explicitly
- Returns 403 'ONA' (Origin Not Allowed) for disallowed origins
- Allows same-origin requests (no Origin header)
- Enabled `credentials: true` for cookie/auth header support

---

### 4. Missing MaxLength Validation on Password Reset ✅ FIXED

**Location:** [src/auth/dto/reset-password.dto.ts](src/auth/dto/reset-password.dto.ts#L9)

**Status:** Fixed — Password field now has MaxLength validation.

**Changes made:**
- Added `@MaxLength(72)` decorator to password field
- Imported `MaxLength` from class-validator
- Prevents DoS attacks from extremely long password inputs

---

## Functional Bugs

### 5. Multi-Worker Peer Discovery Failure in WebSocket ✅ FIXED

**Location:** [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L220-L237)

**Status:** Fixed — Peer discovery now works across multiple workers using Redis reverse mapping.

**Changes made:**
- Added `SOCKET_USER_KEY_PREFIX` constant for reverse `socketId → userId` mapping in Redis
- Updated `handleConnection` to store both `user → socket` and `socket → user` mappings
- Updated `handleDisconnect` to clean up both mappings
- Updated `joinChat` to check Redis reverse mapping for peers on other workers
- Uses local cache first (O(1)), falls back to Redis only if needed

**Implementation:** Instead of scanning the entire hash, peer discovery now:
1. Checks local `socketToUser` map first (for sockets on this worker)
2. If not found and Redis is available, does an O(1) lookup of `socket:${socketId}` → `userId`
3. This works seamlessly in both single-process and multi-worker deployments

---

### 6. Missing Rate Limiting on WebSocket draw.stroke Events ✅ FIXED

**Location:** [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L288-L308)

**Status:** Fixed — Stroke events are now rate-limited to 60 per second.

**Changes made:**
- Added `STROKE_RATE_LIMIT = 60` and `STROKE_RATE_WINDOW_MS = 1000` constants
- Created `strokeRateMap` to track per-socket stroke counts
- Implemented `isStrokeRateLimited()` helper method
- Added rate limit check in `drawStroke()` handler (silently drops excess strokes)
- Clean up `strokeRateMap` entries in `handleDisconnect()`

**Rationale for 60/sec limit:**
- Matches 60 FPS drawing smoothness
- Prevents flooding without impacting legitimate use
- Much more permissive than `draw.clear` (5 per 5 seconds) as strokes are non-destructive
- Can be adjusted if users report restrictions

---

### 7. Unbounded Stroke Payload Size ✅ FIXED

**Location:** [src/realtime/dto/draw-stroke.dto.ts](src/realtime/dto/draw-stroke.dto.ts#L7-L52)

**Status:** Fixed — Stroke payloads now have strict schema validation.

**Changes made:**
1. Created `PointDto` class with validated `x` and `y` number fields
2. Created `StrokeDataDto` class with strict validation:
   - `kind`: String with max 20 characters
   - `from`/`to`: Validated point coordinates
   - `color`: Hex color format (#000000 - #FFFFFF)
   - `width`: Number between 1-100
   - `style`: String with max 20 characters
3. Updated `DrawStrokeDto` to use `@ValidateNested()` with `StrokeDataDto`
4. All fields now validated using `class-validator` decorators

**Rationale:**
- Prevents memory exhaustion from arbitrarily large payloads
- Validates color format to prevent injection attacks
- Limits width to reasonable drawing values
- Maintains backward compatibility with existing stroke format

---

### 8. Cache Inconsistency on Redis Failure ✅ FIXED

**Location:** [src/cache/cache.service.ts](src/cache/cache.service.ts), [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts)

**Status:** Fixed — Redis is now required; all in-memory fallbacks removed.

**Changes made:**
1. **CacheService** now requires `REDIS_URL` environment variable
   - Application exits on startup if `REDIS_URL` is not set
   - Removed in-memory Map fallback completely
   - Redis errors are logged as warnings and treated as cache misses (not fallback to stale data)
   - All cache operations (get/set/del/delByPattern) use Redis exclusively

2. **DrawGateway** now requires `REDIS_HOST` environment variable
   - Application exits on startup if `REDIS_HOST` is not set
   - Removed all conditional checks for Redis availability
   - Changed `redisClient` from nullable to non-null (`Redis!`)
   - Removed DB-persisted socketId fallback in `emitToUser()`

3. **Impact:**
   - Redis is now mandatory for all deployments
   - No more cache inconsistency between instances
   - Cleaner code with no conditional Redis logic
   - Aligns with architectural requirement for multi-instance support

---

### 10. Incomplete Cache Invalidation on User Updates ✅ FIXED

**Location:** [src/users/users.service.ts](src/users/users.service.ts)

**Status:** Fixed — All user update methods now properly invalidate search-related caches.

**Changes made:**
1. **setAppearInSearches** (lines 194-207) — Added `public_users:*` pattern invalidation
   - When users toggle search visibility, all public user lists are cleared
   
2. **updateDisplayName** (lines 95-116) — Added `public_users:*` pattern invalidation
   - Display name changes affect search results, so all public user lists are cleared
   
3. **deleteAccount** (lines 131-139) — Added `public_users:*` pattern invalidation
   - Account deletion removes user from all public user lists

**Implementation pattern:**
All three methods now use `Promise.all()` to invalidate both individual user cache and the public users pattern:
```typescript
await Promise.all([
  this.cache.del(this.userKey(userId)),
  this.cache.delByPattern('public_users:*'),
]);
```

This matches the existing pattern used in `setMode()` and ensures cache consistency across all user update operations.

---

## Minor Issues / Code Quality

### 11. Unused socketId Field in User Entity ✅ FIXED

**Location:** [src/users/entities/user.entity.ts](src/users/entities/user.entity.ts)

**Status:** Fixed — socketId field removed from User entity as Redis is now mandatory.

**Changes made:**
1. Removed `socketId` column from User entity (lines 52-54)
2. Created migration [1772300000000-RemoveSocketId.ts](src/migrations/1772300000000-RemoveSocketId.ts)
   - `up()`: Drops the socketId column from users table
   - `down()`: Re-adds the column if rollback is needed

**Rationale:**
- Since Redis is now mandatory (fix #8), socket tracking is always done via Redis `USER_SOCKET_KEY` hash
- The database `socketId` field was only used as a fallback when Redis was unavailable
- Removing this field simplifies the schema and eliminates confusion
- Aligns with architectural decision to require Redis for all deployments

---

### 12. Inconsistent Error Message in JWT Strategy ✅ FIXED

**Location:** [src/auth/jwt.strategy.ts](src/auth/jwt.strategy.ts#L35-L36)

**Status:** Fixed — UnauthorizedException now includes descriptive error message.

**Issue:** When a user is not found or not activated, a generic `UnauthorizedException` is thrown without a message:
```typescript
if (!user || !user.isActivated) {
  throw new UnauthorizedException();
}
```

**Recommendation:** Provide a message for debugging (but keep it generic for security):
```typescript
throw new UnauthorizedException('Invalid or expired token');
```

---

### 13. Duplicate Display Name Check Logic ✅ FIXED

**Location:** [src/auth/auth.service.ts](src/auth/auth.service.ts#L114-L120) and [src/users/users.service.ts](src/users/users.service.ts#L77-L85)

**Status:** Fixed — AuthService now delegates to UsersService, eliminating code duplication.

**Issue:** The `isDisplayNameAvailable` logic was duplicated in both services with slightly different signatures.

**Changes made:**
1. **AuthModule** — Added `forwardRef(() => UsersModule)` to imports
2. **UsersModule** — Added `forwardRef(() => AuthModule)` to imports (bidirectional circular dependency)
3. **AuthService** — Injected `UsersService` using `@Inject(forwardRef(() => UsersService))`
4. **AuthService.isDisplayNameAvailable** — Now delegates to `UsersService.isDisplayNameAvailable()`
5. Removed duplicate implementation from AuthService

**Rationale:**
- UsersService implementation is more complete (handles currentUserId parameter for self-checks)
- Eliminates code duplication and maintenance burden
- Single source of truth for display name availability checks
- `forwardRef` on both sides properly handles the circular dependency between modules

---

### 14. Missing Emoji Validation in DrawEmoteDto ✅ FIXED

**Location:** [src/realtime/dto/draw-emote.dto.ts](src/realtime/dto/draw-emote.dto.ts#L8-L10)

**Status:** Fixed — Emoji field now validates against a whitelist of allowed emojis.

**Issue:** The `emoji` field only validated that it's a non-empty string, but didn't validate it's actually an allowed emoji:
```typescript
@IsString()
@IsNotEmpty()
emoji!: string;
```

**Changes made:**
1. Defined `ALLOWED_EMOJIS` constant containing the 60 emojis available in the frontend
2. Replaced `@IsString()` and `@IsNotEmpty()` with `@IsIn(ALLOWED_EMOJIS)`
3. Added descriptive error message for invalid emojis

**Rationale:**
- Whitelist validation is more secure than regex matching
- Ensures backend and frontend are in sync on allowed emojis
- Prevents users from sending arbitrary emojis not shown in the UI
- More maintainable than regex patterns

---

### 15. Potential Memory Leak in clearRateMap ✅ FIXED

**Location:** [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L66-L70)

**Status:** Fixed — Periodic cleanup now prevents memory leaks from abnormal disconnections.

**Issue:** The `clearRateMap` and `strokeRateMap` entries were only cleaned up in `handleDisconnect`. If sockets disconnected abnormally (e.g., server crash, network issues) without triggering the disconnect handler, entries could accumulate.

**Changes made:**
1. Added periodic cleanup interval in `afterInit()` lifecycle hook
2. Runs every 60 seconds (1 minute)
3. Removes entries from `clearRateMap` older than 2× `CLEAR_RATE_WINDOW_MS` (10 seconds)
4. Removes entries from `strokeRateMap` older than 2× `STROKE_RATE_WINDOW_MS` (2 seconds)
5. Logs debug message when stale entries are cleaned up

**Rationale:**
- Prevents memory leaks from abnormal disconnections
- 2× window threshold is conservative (allows for clock skew and edge cases)
- Cleanup runs every minute (low overhead)
- Handles both rate limit maps (clear and stroke)
- Debug logging provides visibility into cleanup activity

---

## Summary

| Priority | Count | Fixed | Description |
|----------|-------|-------|-------------|
| Critical | 4 | 4 | Security vulnerabilities requiring immediate attention |
| High | 6 | 5 | Functional bugs affecting correctness |
| Medium | 5 | 4 | Code quality and minor issues |

**Immediate Actions Required:**
1. ✅ ~~Remove default JWT secret fallbacks~~
2. ✅ ~~Add activation token expiry~~
3. ✅ ~~Configure CORS properly~~
4. ✅ ~~Add MaxLength to password reset DTO~~
5. ✅ ~~Fix multi-worker peer discovery~~
6. ✅ ~~Add rate limiting to draw.stroke~~
7. ✅ ~~Add strict stroke schema validation~~
8. ✅ ~~Fix cache inconsistency on Redis failure~~
9. ✅ ~~Fix incomplete cache invalidation on user updates~~
