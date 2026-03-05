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

### 11. Unused socketId Field in User Entity

**Location:** [src/users/entities/user.entity.ts](src/users/entities/user.entity.ts#L47-L48)

**Issue:** The `socketId` field exists in the User entity but with Redis, socket tracking is done via the `USER_SOCKET_KEY` hash. This field is only used as a fallback when Redis is not configured.

**Recommendation:** Consider removing this field if Redis is required in production, or document its purpose clearly.

---

### 12. Inconsistent Error Message in JWT Strategy

**Location:** [src/auth/jwt.strategy.ts](src/auth/jwt.strategy.ts#L35-L36)

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

### 13. Duplicate Display Name Check Logic

**Location:** [src/auth/auth.service.ts](src/auth/auth.service.ts#L114-L120) and [src/users/users.service.ts](src/users/users.service.ts#L77-L85)

**Issue:** The `isDisplayNameAvailable` logic is duplicated in both services with slightly different signatures.

**Recommendation:** Keep only one implementation in `UsersService` and have `AuthService` delegate to it.

---

### 14. Missing Emoji Validation in DrawEmoteDto

**Location:** [src/realtime/dto/draw-emote.dto.ts](src/realtime/dto/draw-emote.dto.ts#L8-L10)

**Issue:** The `emoji` field only validates that it's a non-empty string, but doesn't validate it's actually an emoji or limit its length:
```typescript
@IsString()
@IsNotEmpty()
emoji!: string;
```

**Recommended Fix:**
```typescript
@IsString()
@MaxLength(10)  // Emoji sequences can be multiple code points
@Matches(/^[\p{Emoji}]+$/u, { message: 'Must be a valid emoji' })
emoji!: string;
```

---

### 15. Potential Memory Leak in clearRateMap

**Location:** [src/realtime/draw.gateway.ts](src/realtime/draw.gateway.ts#L66-L70)

**Issue:** The `clearRateMap` entries are only cleaned up in `handleDisconnect`. If sockets disconnect abnormally (e.g., server crash, network issues) without triggering the disconnect handler, entries could accumulate.

**Recommendation:** Add periodic cleanup of stale entries:
```typescript
// Add a cleanup interval in afterInit
setInterval(() => {
  const now = Date.now();
  for (const [socketId, entry] of this.clearRateMap) {
    if (now - entry.windowStart > CLEAR_RATE_WINDOW_MS * 2) {
      this.clearRateMap.delete(socketId);
    }
  }
}, 60_000); // Every minute
```

---

## Summary

| Priority | Count | Fixed | Description |
|----------|-------|-------|-------------|
| Critical | 4 | 4 | Security vulnerabilities requiring immediate attention |
| High | 6 | 5 | Functional bugs affecting correctness |
| Medium | 5 | 0 | Code quality and minor issues |

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
