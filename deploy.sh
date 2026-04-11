#!/usr/bin/env bash
# deploy.sh — pull latest, build frontend, restart via PM2.
# Called by: GitHub webhook handler, or run manually.
#
# Usage:  bash deploy.sh

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOGFILE="/home/ubuntu/.pm2/logs/deploy.log"

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*" | tee -a "$LOGFILE"; }

log "=== Deploy started ==="
cd "$APP_DIR"

log "Pulling from GitHub…"
git pull origin main

log "Installing dependencies…"
npm install

log "Building frontend…"
npm run build

log "Restarting PM2…"
pm2 restart ecosystem.config.js --update-env

log "=== Deploy complete ==="
