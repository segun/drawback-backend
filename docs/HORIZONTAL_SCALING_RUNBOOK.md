# Horizontal Scaling Runbook (4 Machines)

## Target Topology

- Machine 1: MySQL + Redis
- Machine 2: Load balancer (DigitalOcean LB or Nginx)
- Machine 3: Backend app node A
- Machine 4: Backend app node B

## Scope

This runbook scales the current backend to multiple app machines with one shared MySQL and Redis.

## 1) Pre-Checks

1. Create a private network/VPC for all 4 machines.
2. Confirm app can reach MySQL and Redis over private IP.
3. Open firewall ports:
   - Machine 1: MySQL (`DB_PORT`) and Redis (`REDIS_PORT`) from Machine 3 and 4 only.
   - Machine 2: 80/443 from internet.
   - Machine 3/4: 3000 from Machine 2 only.
4. Decide one release leader machine (use Machine 3) to run migrations.

## 2) Machine 1 (MySQL + Redis)

1. Copy `deploy/docker-compose.yml` and `deploy/mysql-init/*` to Machine 1.
2. Create env file (example: `/opt/drawback/.env`) with DB and Redis values.
3. Start services:

```bash
docker compose --env-file /opt/drawback/.env -f /opt/drawback/deploy/docker-compose.yml up -d
```

4. Verify services:

```bash
docker ps
docker exec drawback_mysql mysqladmin ping -h 127.0.0.1 --silent
docker exec drawback_redis redis-cli -a "$REDIS_PASSWORD" ping
```

5. Verify MySQL max connections (used later for pool sizing):

```sql
SHOW VARIABLES LIKE 'max_connections';
```

## 3) Machine 3 and 4 (App Nodes)

1. Deploy the backend code on both machines.
2. Create app env file on both machines with shared database/redis hosts:
   - `DB_HOST=<machine1_private_ip>`
   - `REDIS_HOST=<machine1_private_ip>`
   - `PORT=3000`
   - `ALLOWED_ORIGINS=<your frontend origins>`
3. Build:

```bash
yarn install --frozen-lockfile
yarn build
```

4. Start/restart with PM2:

```bash
pm2 start ecosystem.config.js --env production || pm2 restart drawback-backend
pm2 save
```

## 4) Prevent DB Connection Exhaustion (Required)

`DB_POOL_SIZE` is per PM2 worker, not per machine.

1. Set fixed PM2 worker count per machine in `ecosystem.config.js` (do not use `instances: 'max'` in multi-node unless you have already sized DB for it).
2. Compute total workers:

```text
total_workers = workers_machine3 + workers_machine4
```

3. Compute pool size:

```text
DB_POOL_SIZE = floor((max_connections - reserve) / total_workers)
reserve = 30
```

4. Example:
   - `max_connections=151`
   - `workers_machine3=2`, `workers_machine4=2` => `total_workers=4`
   - `DB_POOL_SIZE=floor((151-30)/4)=30`
5. Set `DB_POOL_SIZE=30` in app env on Machine 3 and 4.
6. Restart PM2 on both nodes.
7. Validate live DB usage:

```sql
SHOW STATUS LIKE 'Threads_connected';
```

If usage is too high, reduce PM2 workers or reduce `DB_POOL_SIZE`.

## 5) Migration Execution Rule (Required)

Run migrations once per release, on one machine only.

1. On Machine 3 only:

```bash
AUTO_START_DOCKER_SERVICES=false yarn migration:run
```

2. On Machine 4: do not run migrations.

## 6) Load Balancer Setup

### Option A: DigitalOcean Managed Load Balancer (recommended)

1. Add Machine 3 and 4 as backend targets on port `3000`.
2. Health check:
   - Protocol: HTTP
   - Path: `/api`
   - Port: `3000`
3. Enable WebSocket support.
4. Enable sticky sessions (cookie-based).
5. Point DNS (`drawback.chat`, `www.drawback.chat`) to LB.

### Option B: Nginx on Machine 2

Use upstream balancing with stickiness (`ip_hash`) and websocket headers:

```nginx
upstream drawback_backend {
    ip_hash;
    server 10.0.0.3:3000 max_fails=3 fail_timeout=30s;
    server 10.0.0.4:3000 max_fails=3 fail_timeout=30s;
    keepalive 64;
}

location /api/ {
    proxy_pass http://drawback_backend/api/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}

location /socket.io/ {
    proxy_pass http://drawback_backend/socket.io/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_read_timeout 86400s;
    proxy_send_timeout 86400s;
    proxy_buffering off;
}
```

## 7) WebSocket Stickiness Practical Rule

Use one of these strategies:

1. Preferred: keep sticky sessions enabled on the LB.
2. Alternative: force websocket-only transport in clients (`transports: ['websocket']`) if you want to remove stickiness dependency.

If you keep polling fallback, sticky sessions should remain enabled.

## 8) Real Client IP Behind LB (Required for accurate audit logs)

1. In `src/main.ts`, enable proxy trust:

```ts
app.set('trust proxy', 1);
```

2. In websocket IP extraction (`src/realtime/draw.gateway.ts`), prefer `x-forwarded-for` first, then fallback:

```ts
const xff = client.handshake.headers['x-forwarded-for'];
const forwarded = Array.isArray(xff) ? xff[0] : xff;
const ipAddress =
  (forwarded?.split(',')[0]?.trim() || client.handshake.address || 'unknown')
    .replace(/^::ffff:/, '');
```

3. Redeploy both app nodes.

## 9) Secrets and Rotation (Required)

Current env files should not contain long-lived plaintext secrets in repo history.

1. Move runtime env to machine-local path, example:
   - `/etc/drawback/backend.env` (chmod `600`, owner root/app user)
2. Rotate at minimum:
   - `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `SMTP_PASSWORD`, cloud keys.
3. Rotation order:
   - Create new infra credentials first (DB/Redis/SMTP/cloud).
   - Update Machine 3 env, reload PM2, verify.
   - Update Machine 4 env, reload PM2, verify.
   - Remove old credentials after both nodes are healthy.
4. JWT secret note:
   - Rotating `JWT_SECRET` invalidates existing tokens.
   - Execute during maintenance window or accept forced re-login.

## 10) Verification Checklist

1. `GET /api` returns healthy through the LB.
2. Logins succeed on both app nodes.
3. WebSocket connections are stable through LB.
4. Draw events propagate between users connected via different app nodes.
5. MySQL `Threads_connected` remains below planned limit under load.
6. Redis remains reachable from both app nodes.

## 11) Rollback

1. Remove unhealthy app node from LB target pool.
2. Redeploy previous app build to affected node.
3. If migration caused issue, restore DB from backup and redeploy matching app version.
