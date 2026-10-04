#!/usr/bin/env bash
# Copies the newest backups off the server. Needs rclone configured (rclone config). Cron: 0 2 * * * /opt/cellarpos/deploy/offsite-backup.sh
set -euo pipefail
command -v rclone >/dev/null || { echo "Install and configure rclone first"; exit 1; }
rclone copy /var/lib/cellarpos/backups "${OFFSITE_REMOTE:-remote:cellarpos-backups}" --max-age 3d
