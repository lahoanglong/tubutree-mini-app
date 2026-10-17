#!/usr/bin/env bash
# Backup Postgres TRƯỚC khi deploy: gọi tools/backup/backup-db.sh với nhãn predeploy, giữ 10 bản mới nhất.
# File: /var/backups/tubutree/tubutree_<giờ>_predeploy.sql.gz (vẫn khớp mẫu tubutree_*.sql.gz của runbook).
#
# Không ping HEALTHCHECK_URL của cron 6 giờ: bản này chạy lúc có người deploy, ping nó sẽ che việc cron ngừng chạy.
# Muốn được báo riêng thì đặt PREDEPLOY_HEALTHCHECK_URL (một check khác trên healthchecks.io).
# Biến còn lại (COMPOSE_FILE, POSTGRES_USER, POSTGRES_DB, RCLONE_REMOTE, BACKUP_DIR) đọc như backup-db.sh.
#
#   cd /opt/tubutree && bash ops/backup-predeploy.sh
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export BACKUP_LABEL=predeploy
export BACKUP_KEEP_COUNT="${PREDEPLOY_KEEP_COUNT:-10}"
export HEALTHCHECK_URL="${PREDEPLOY_HEALTHCHECK_URL:-}"
export HEALTHCHECK_OPTIONAL=1

exec bash "$SCRIPT_DIR/../tools/backup/backup-db.sh" "$@"
