#!/usr/bin/env bash
set -e

# Wait for DB to be potentially ready
echo "[boot] Waiting for database..."
sleep 5

echo "[boot] running DB migrations"
max_attempts=${MIGRATION_MAX_ATTEMPTS:-12}
attempt=1
until node dist/migrate.js; do
	if [ "$attempt" -ge "$max_attempts" ]; then
		echo "[boot] migrations failed after ${attempt} attempts"
		exit 1
	fi
	echo "[boot] migration attempt ${attempt}/${max_attempts} failed, retrying in 5s..."
	attempt=$((attempt + 1))
	sleep 5
done
echo "[boot] migrations completed"

echo "[boot] bootstrapping admin user..."
# SECURITY: Use environment variables instead of hardcoded credentials
# Fallback generates a random password if not provided
export BOOTSTRAP_ADMIN_EMAIL=${BOOTSTRAP_ADMIN_EMAIL:-admin@crm.com}
export BOOTSTRAP_ADMIN_PASSWORD=${BOOTSTRAP_ADMIN_PASSWORD:-$(cat /dev/urandom | tr -dc 'A-Za-z0-9' | fold -w 24 | head -n 1)}
node dist/bootstrap-admin.js || echo "Admin creation skipped (likely already exists)"

echo "[boot] starting server"
exec node dist/index.js
