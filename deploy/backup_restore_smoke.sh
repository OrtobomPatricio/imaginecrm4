#!/usr/bin/env bash
set -euo pipefail

# Enterprise backup/restore smoke test for MySQL.
# Required env vars: DATABASE_URL, MYSQL_USER, MYSQL_PASSWORD, MYSQL_HOST, MYSQL_PORT, MYSQL_DATABASE

: "${MYSQL_USER:?MYSQL_USER is required}"
: "${MYSQL_PASSWORD:?MYSQL_PASSWORD is required}"
: "${MYSQL_HOST:?MYSQL_HOST is required}"
: "${MYSQL_PORT:=3306}"
: "${MYSQL_DATABASE:?MYSQL_DATABASE is required}"

TS="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="/tmp/${MYSQL_DATABASE}_${TS}.sql.gz"
RESTORE_DB="${MYSQL_DATABASE}_restore_smoke_${TS}"

echo "[backup-smoke] creating compressed backup: ${BACKUP_FILE}"
mysqldump -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" --single-transaction "$MYSQL_DATABASE" | gzip > "$BACKUP_FILE"

echo "[backup-smoke] creating restore database: ${RESTORE_DB}"
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "CREATE DATABASE \`${RESTORE_DB}\`;"

echo "[backup-smoke] restoring backup into ${RESTORE_DB}"
gunzip -c "$BACKUP_FILE" | mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$RESTORE_DB"

echo "[backup-smoke] verifying critical tables"
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" "$RESTORE_DB" -e "SELECT COUNT(*) AS tenants FROM tenants; SELECT COUNT(*) AS users FROM users;"

echo "[backup-smoke] cleanup"
mysql -h "$MYSQL_HOST" -P "$MYSQL_PORT" -u "$MYSQL_USER" -p"$MYSQL_PASSWORD" -e "DROP DATABASE \`${RESTORE_DB}\`;"
rm -f "$BACKUP_FILE"

echo "[backup-smoke] success"
