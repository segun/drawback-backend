# Horizontal Scaling Quick Checklist

Use this during rollout. For full detail, see `docs/HORIZONTAL_SCALING_RUNBOOK.md`.

## Topology

- Machine 1: MySQL + Redis
- Machine 2: Load balancer
- Machine 3: App node A
- Machine 4: App node B

## Pre-Flight

1. Private network is configured for all machines.
2. Firewall rules are in place:
   - MySQL/Redis only from app nodes.
   - App port 3000 only from LB.
   - LB exposes 80/443 publicly.
3. Confirm DNS records point to LB.
4. Pick one migration leader node (Machine 3).

## Machine 1 (DB + Redis)

1. Start MySQL and Redis with `deploy/docker-compose.yml`.
2. Confirm health:
   - MySQL ping passes.
   - Redis ping passes.
3. Record MySQL max connections:

```sql
SHOW VARIABLES LIKE 'max_connections';
```

## Machines 3 and 4 (App Nodes)

1. Set env on both nodes:
   - `DB_HOST=<machine1_private_ip>`
   - `REDIS_HOST=<machine1_private_ip>`
   - `PORT=3000`
   - `ALLOWED_ORIGINS=<prod origins>`
2. Build and start with PM2.
3. Set fixed PM2 worker count (not `instances: 'max'` unless DB was sized for it).

## DB Pool Sizing (Required)

1. Compute workers:

```text
total_workers = workers_node_a + workers_node_b
```

2. Compute pool size:

```text
DB_POOL_SIZE = floor((max_connections - 30) / total_workers)
```

3. Set same `DB_POOL_SIZE` on both app nodes.
4. Restart PM2 on both app nodes.

## Load Balancer

1. Add both app nodes as backends on port 3000.
2. Health check: HTTP `GET /api` on port 3000.
3. Enable websocket support.
4. Enable sticky sessions.

## Required App Fixes Before Go-Live

1. Add proxy trust in `src/main.ts`:

```ts
app.set('trust proxy', 1);
```

2. Update websocket IP extraction in `src/realtime/draw.gateway.ts` to prefer `x-forwarded-for`.

## Release Sequence

1. Deploy code to Machine 3 and 4.
2. Run migrations on Machine 3 only:

```bash
AUTO_START_DOCKER_SERVICES=false yarn migration:run
```

3. Restart app on Machine 3, verify health.
4. Restart app on Machine 4, verify health.
5. Add both nodes to LB pool.

## Secrets Rotation (Required)

1. Move runtime env to machine-local file with strict permissions (`chmod 600`).
2. Rotate: `DB_PASSWORD`, `REDIS_PASSWORD`, `JWT_SECRET`, `SMTP_PASSWORD`, cloud keys.
3. Rotate node-by-node:
   - Update node A, restart, verify.
   - Update node B, restart, verify.
   - Revoke old credentials.
4. Plan maintenance window for `JWT_SECRET` rotation (forces re-login).

## Verification

1. `GET /api` works through LB.
2. Login and authenticated APIs work.
3. Socket connections stay stable.
4. Cross-node draw sync works.
5. DB connections stay within budget:

```sql
SHOW STATUS LIKE 'Threads_connected';
```

## Rollback

1. Remove failing node from LB.
2. Revert node to previous build and restart.
3. If schema issue: restore DB backup and deploy matching app version.
