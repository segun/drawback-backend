#!/bin/bash
#
# Drawback Backend Deployment Script
# Run this script to deploy backend updates
#
# Usage: ./deploy/deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info()  { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

AUTO_START_DOCKER_SERVICES="${AUTO_START_DOCKER_SERVICES:-true}"

is_true() {
    case "${1:-}" in
        true|TRUE|True|1|yes|YES|Yes|y|Y) return 0 ;;
        *) return 1 ;;
    esac
}

has_non_empty_env_value() {
    local key="$1"
    local env_file="$2"
    grep -Eq "^${key}=.+" "$env_file"
}

# Resolve docker compose command: prefer plugin (v2), fall back to standalone (v1)
docker_compose() {
    if docker compose version &>/dev/null 2>&1; then
        docker compose "$@"
    elif command -v docker-compose &>/dev/null; then
        docker-compose "$@"
    else
        log_error "Neither 'docker compose' (v2 plugin) nor 'docker-compose' (v1) is available."
        log_error "Install the Compose plugin: https://docs.docker.com/compose/install/"
        exit 1
    fi
}

ensure_git_upstream() {
    local branch
    branch=$(git rev-parse --abbrev-ref HEAD)
    if ! git rev-parse --abbrev-ref --symbolic-full-name @{u} &>/dev/null; then
        log_warn "No upstream set for $branch. Setting to origin/$branch"
        git branch --set-upstream-to="origin/$branch" "$branch"
    fi
}

log_info "=== Drawback Backend Deployment ==="
echo ""

cd "$REPO_ROOT"

# Check required runtimes
if ! command -v node &>/dev/null; then
    log_error "Node.js is not installed"
    log_error "Install via NVM: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.4/install.sh | bash"
    exit 1
fi

if ! command -v yarn &>/dev/null; then
    log_error "Yarn is not installed"
    log_error "Install via: npm install -g yarn"
    exit 1
fi

log_info "Node: $(node --version)"
log_info "Yarn: $(yarn --version)"
echo ""

# Check / install PM2
if ! command -v pm2 &>/dev/null; then
    log_warn "PM2 is not installed — installing globally..."
    npm install -g pm2
fi
log_info "PM2: $(pm2 --version)"
echo ""

log_info "=== Deploying Backend ==="

# Pull latest code
log_info "Pulling latest backend code from repository..."
ensure_git_upstream
git pull --ff-only origin "$(git rev-parse --abbrev-ref HEAD)"

# Install dependencies
log_info "Installing backend dependencies..."
if [ -f package-lock.json ]; then
    rm -f package-lock.json
fi
yarn install

# Build application
log_info "Building backend application..."
yarn build

# Start infrastructure services
if is_true "$AUTO_START_DOCKER_SERVICES"; then
    if ! command -v docker &>/dev/null; then
        log_warn "Docker is not installed; skipping docker compose service startup"
    elif [ ! -f "$REPO_ROOT/.env" ]; then
        log_warn ".env not found in project root; skipping docker compose service startup"
    else
        log_info "Ensuring required docker services are running..."

        if [ -f "$DEPLOY_DIR/docker-compose.yml" ]; then
            docker_compose --env-file "$REPO_ROOT/.env" -f "$DEPLOY_DIR/docker-compose.yml" up -d --remove-orphans

            log_info "Waiting for MySQL to be ready..."
            timeout=60
            elapsed=0
            until docker exec drawback_mysql mysqladmin ping -h 127.0.0.1 --silent &>/dev/null; do
                if [ "$elapsed" -ge "$timeout" ]; then
                    log_error "MySQL did not become ready within ${timeout}s. Aborting."
                    exit 1
                fi
                sleep 2
                elapsed=$((elapsed + 2))
            done
            log_info "MySQL is ready."
        fi
    fi
fi

# Run migrations
log_info "Running database migrations..."
yarn migration:run

# Restart application with PM2
log_info "Restarting backend with PM2..."
pm2 restart drawback-backend \
    || pm2 start "$REPO_ROOT/ecosystem.config.js" --env production

pm2 save

# Update nginx config
if [ -f "$DEPLOY_DIR/nginx/default" ]; then
    log_info "Updating nginx config..."
    sudo cp "$DEPLOY_DIR/nginx/default" /etc/nginx/sites-available/default
    sudo nginx -t && sudo systemctl reload nginx
    log_info "nginx reloaded."
else
    log_warn "deploy/nginx/default not found — skipping nginx update."
fi

log_info "Backend deployment complete"
echo ""
echo "Backend status:"
pm2 status
echo ""
echo "Recent backend logs:"
pm2 logs drawback-backend --lines 15 --nostream
echo ""

log_info "=== Deployment Complete ==="
