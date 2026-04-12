#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/var/www/bird-dog-app/current}"
BRANCH="${BRANCH:-main}"

echo "Deploying Bird Dog from branch: ${BRANCH}"
cd "${APP_DIR}"

git fetch origin "${BRANCH}"
git checkout "${BRANCH}"
git pull --ff-only origin "${BRANCH}"

npm ci
npm run build

pm2 startOrReload deploy/ec2/ecosystem.config.cjs --update-env
pm2 save

curl -fsS http://127.0.0.1:3000/api/health >/dev/null
echo "Deploy complete and health check passed."
