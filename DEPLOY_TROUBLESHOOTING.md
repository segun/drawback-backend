# Deployment Troubleshooting

## Build Hanging on Server

If `yarn build` hangs during deployment, it's usually due to low memory. TypeScript compilation can be memory-intensive.

### Immediate Fix (On Server)

```bash
# 1. Kill the hanging process
pkill -f "nest build" || pkill -f "tsc"

# 2. Build with increased memory limit
NODE_OPTIONS="--max-old-space-size=2048" yarn build
```

### If Still Hanging

Try reducing the memory limit or using direct TypeScript compilation:

```bash
# Lower memory limit (for 1GB servers)
NODE_OPTIONS="--max-old-space-size=1024" yarn build

# Or use direct tsc (faster, less overhead)
npx tsc -p tsconfig.build.json
```

### Check Dependencies

If you just pulled new code, ensure all dependencies are installed:

```bash
cd /opt/drawback/backend
rm -rf node_modules
yarn install --frozen-lockfile
NODE_OPTIONS="--max-old-space-size=2048" yarn build
```

### Memory Requirements

- **Minimum**: 1GB RAM (use `--max-old-space-size=1024`)
- **Recommended**: 2GB RAM (use `--max-old-space-size=2048`)
- **Ideal**: 4GB+ RAM (default Node.js limits work fine)

### Check Server Memory

```bash
# Check available memory
free -h

# Check if swap is enabled (helps during builds)
swapon --show

# If no swap, consider adding a swap file:
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
```

## Build Errors

### Missing Dependencies

```bash
# Error: Cannot find module '@google-cloud/pubsub'
yarn add @google-cloud/pubsub

# Error: Cannot find module 'googleapis'  
yarn add googleapis

# Reinstall all dependencies
rm -rf node_modules yarn.lock
yarn install
```

### TypeScript Errors

```bash
# Check for errors without building
npx tsc --noEmit

# If errors appear, fix them before deploying
```

## PM2 Issues

### App Won't Start

```bash
# Check PM2 logs
pm2 logs drawback-backend --lines 50

# Check if port is in use
sudo netstat -tuln | grep 3000
# Or with lsof
sudo lsof -i :3000

# Restart PM2
pm2 restart drawback-backend

# If ecosystem config changed, delete and recreate
pm2 delete drawback-backend
pm2 start ecosystem.config.js --env production
pm2 save
```

### PM2 Not Saving State

```bash
# Save current PM2 state
pm2 save

# Setup PM2 to start on boot
pm2 startup
# Run the command it outputs
```

## Database Issues

### Migration Errors

```bash
# Check database connection
yarn migration:show

# If migrations are stuck
yarn migration:revert
yarn migration:run

# For fresh start (CAUTION: drops all data)
yarn db:reset
yarn migration:run
```

### MySQL Not Ready

```bash
# Check MySQL container
docker ps | grep mysql

# Check MySQL logs
docker logs drawback_mysql

# Restart MySQL
docker restart drawback_mysql

# Connect to MySQL manually
docker exec -it drawback_mysql mysql -uroot -p
```

## Quick Deploy Checklist

Before deploying, ensure:

- [ ] `.env` file exists and is complete
- [ ] MySQL is running (`docker ps`)
- [ ] Dependencies are installed (`yarn install`)
- [ ] Build succeeds locally (`yarn build`)
- [ ] Tests pass (`yarn test:e2e`)
- [ ] Server has at least 1GB free memory (`free -h`)

## Common Error Messages

### "Cannot connect to MySQL"
- Check `.env` has correct `DB_*` values
- Ensure MySQL container is running: `docker ps`
- Check MySQL is accepting connections: `docker exec drawback_mysql mysqladmin ping`

### "Port 3000 already in use"
- Another process is using port 3000
- Check: `sudo lsof -i :3000`
- Kill the process or change port in `.env`

### "JavaScript heap out of memory"
- Build requires more memory
- Solution: `NODE_OPTIONS="--max-old-space-size=2048" yarn build`
- Or add swap space (see above)

### "ENOSPC: System limit for number of file watchers reached"
- Increase inotify limits:
  ```bash
  echo fs.inotify.max_user_watches=524288 | sudo tee -a /etc/sysctl.conf
  sudo sysctl -p
  ```

## Getting Help

If issues persist:

1. Check PM2 logs: `pm2 logs drawback-backend --lines 100`
2. Check system logs: `sudo journalctl -u docker -n 50`
3. Check disk space: `df -h`
4. Check memory: `free -h`
5. Review `.env` configuration

## Updated Deploy Script

The deploy script (`deploy/deploy.sh`) has been updated to handle low-memory servers automatically. To use:

```bash
cd /opt/drawback/backend
./deploy/deploy.sh
```

The script now includes:
- Automatic memory limit for builds (`--max-old-space-size=2048`)
- Better error messages
- Automatic retry hints
