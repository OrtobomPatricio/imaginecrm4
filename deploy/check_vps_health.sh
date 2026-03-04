#!/bin/bash
# check_vps_health.sh

echo "🔍 Diagnosticando Salud del VPS..."

echo "\n📦 Contenedores Activos:"
docker compose ps

echo "\n🌐 Puertos Escuchando (Host):"
netstat -tulpn | grep LISTEN

echo "\n🔥 Firewall (UFW Status):"
ufw status verbose

echo "\n🧪 Prueba Curl Local (App:3000):"
curl -I http://localhost:3000

echo "\n🧪 Prueba Curl Local (Caddy:80):"
curl -I http://localhost:80

echo "\n📝 Logs Recientes (App):"
docker compose logs --tail=20 app

echo "\n📝 Logs Recientes (Caddy):"
docker compose logs --tail=20 caddy
