#!/usr/bin/env bash
# Installs CellarPOS as a systemd service. Run as root on the server. Needs Node.js 20+.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Run as root"; exit 1; }
command -v node >/dev/null || { echo "Install Node.js 20+ first"; exit 1; }
APP=/opt/cellarpos; DATA=/var/lib/cellarpos
SRC="$(cd "$(dirname "$0")/.." && pwd)"
id cellarpos >/dev/null 2>&1 || useradd --system --home "$DATA" --shell /usr/sbin/nologin cellarpos
mkdir -p "$APP" "$DATA/backups"
(cd "$SRC" && tar cf - --exclude=node_modules --exclude='*.db*' --exclude=backups .) | tar xf - -C "$APP"
(cd "$APP" && (npm ci --omit=dev || npm install --omit=dev))
if [ ! -f /etc/cellarpos.env ]; then
  cp "$APP/deploy/.env.example" /etc/cellarpos.env
  chown root:cellarpos /etc/cellarpos.env; chmod 640 /etc/cellarpos.env
  echo ">> Edit /etc/cellarpos.env (PUBLIC_URL, M-Pesa, printer) before going live."
fi
chown -R cellarpos:cellarpos "$DATA"
cp "$APP/deploy/cellarpos.service" /etc/systemd/system/cellarpos.service
systemctl daemon-reload; systemctl enable --now cellarpos
sleep 2; systemctl --no-pager --lines=5 status cellarpos || true
echo "Done. Next: install Caddy, use deploy/Caddyfile, then sign in and change the default PINs."
