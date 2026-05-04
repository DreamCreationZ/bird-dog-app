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

# Legacy chunk recovery:
# Some users can retain an old runtime that requests a removed bird-dog chunk.
# Provide a tiny compatibility shim so the old request triggers a hard refresh
# to the latest app instead of showing a fatal chunk-load error screen.
LEGACY_BIRD_DOG_CHUNK=".next/static/chunks/app/bird-dog/page-3da0868d4720a619.js"
mkdir -p "$(dirname "$LEGACY_BIRD_DOG_CHUNK")"
cat > "$LEGACY_BIRD_DOG_CHUNK" <<'EOF'
try {
  window.location.replace("/login?_chunkRecover=" + Date.now());
} catch (_) {}
(self.webpackChunk_N_E = self.webpackChunk_N_E || []).push([[935], {}]);
EOF

set -a
source /etc/bird-dog/.env.production
set +a

PM2_RUNNER="${PM2_RUNNER:-ec2-user}"
if id "$PM2_RUNNER" >/dev/null 2>&1; then
  sudo -u "$PM2_RUNNER" pm2 startOrReload deploy/ec2/ecosystem.config.cjs --update-env
  sudo -u "$PM2_RUNNER" pm2 save
else
  pm2 startOrReload deploy/ec2/ecosystem.config.cjs --update-env
  pm2 save
fi

curl -fsS http://127.0.0.1:3000/api/health >/dev/null
echo "Deploy complete and health check passed."
