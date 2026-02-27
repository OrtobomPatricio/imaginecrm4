#!/bin/bash
# ══════════════════════════════════════════════════════════════════════════════
# install_metabase_cron.sh
# Instala el cron job y el servicio systemd para la actualización automática
# del Dashboard de Emails Críticos en Metabase.
#
# Uso:
#   chmod +x install_metabase_cron.sh
#   sudo ./install_metabase_cron.sh
#
# Requisitos:
#   - Python 3.8+ instalado
#   - pip install requests python-dotenv
#   - Archivo .env configurado en el mismo directorio
# ══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Colores ────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
err()  { echo -e "  ${RED}✗${NC} $1"; }
info() { echo -e "  ${BLUE}→${NC} $1"; }

# ── Variables de configuración ─────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT_NAME="update_metabase_dashboard.py"
SCRIPT_PATH="${SCRIPT_DIR}/${SCRIPT_NAME}"
ENV_FILE="${SCRIPT_DIR}/.env"
LOG_DIR="/var/log/imaginecrm"
LOG_FILE="${LOG_DIR}/metabase_update.log"
PYTHON_BIN="$(which python3)"
SERVICE_NAME="imaginecrm-metabase-update"
SYSTEMD_DIR="/etc/systemd/system"

echo ""
echo "══════════════════════════════════════════════════════════════"
echo "  ImagineCRM — Instalación de Actualización Automática Metabase"
echo "══════════════════════════════════════════════════════════════"
echo ""

# ── Verificaciones previas ─────────────────────────────────────────────────
info "Verificando requisitos..."

if [ ! -f "${SCRIPT_PATH}" ]; then
    err "No se encontró el script: ${SCRIPT_PATH}"
    exit 1
fi
ok "Script encontrado: ${SCRIPT_PATH}"

if [ ! -f "${ENV_FILE}" ]; then
    warn "No se encontró el archivo .env en ${SCRIPT_DIR}"
    warn "Asegúrate de crear el .env antes de que el cron se ejecute"
fi

if ! command -v python3 &> /dev/null; then
    err "Python3 no está instalado"
    exit 1
fi
ok "Python3 encontrado: ${PYTHON_BIN}"

# Verificar dependencias Python
if ! ${PYTHON_BIN} -c "import requests" 2>/dev/null; then
    warn "Instalando dependencia 'requests'..."
    pip3 install requests python-dotenv --quiet
    ok "Dependencias instaladas"
else
    ok "Dependencias Python verificadas"
fi

# ── Crear directorio de logs ───────────────────────────────────────────────
info "Configurando directorio de logs..."
mkdir -p "${LOG_DIR}"
touch "${LOG_FILE}"
chmod 664 "${LOG_FILE}"
ok "Log configurado en: ${LOG_FILE}"

# ── Instalar cron job ──────────────────────────────────────────────────────
echo ""
info "Instalando cron jobs..."

# Crear el archivo de cron en /etc/cron.d/
CRON_FILE="/etc/cron.d/imaginecrm-metabase"

cat > "${CRON_FILE}" << EOF
# ImagineCRM — Actualización automática del Dashboard de Metabase
# ──────────────────────────────────────────────────────────────────
# Formato: minuto hora dia mes dia_semana usuario comando

# Actualización completa cada hora (re-sync BD + re-ejecutar cards)
0 * * * * root ${PYTHON_BIN} ${SCRIPT_PATH} >> ${LOG_FILE} 2>&1

# Sincronización de esquema de BD una vez al día (a las 2:00 AM)
0 2 * * * root ${PYTHON_BIN} ${SCRIPT_PATH} --sync-only >> ${LOG_FILE} 2>&1

# Verificación de estado cada 6 horas (sin modificar nada)
0 */6 * * * root ${PYTHON_BIN} ${SCRIPT_PATH} --status >> ${LOG_FILE} 2>&1
EOF

chmod 644 "${CRON_FILE}"
ok "Cron instalado en: ${CRON_FILE}"

# ── Instalar servicio systemd (para ejecución manual y monitoreo) ──────────
echo ""
info "Instalando servicio systemd..."

# Servicio one-shot para ejecución manual
cat > "${SYSTEMD_DIR}/${SERVICE_NAME}.service" << EOF
[Unit]
Description=ImagineCRM — Actualización Dashboard Metabase
After=network.target
Documentation=https://imaginecrm.com

[Service]
Type=oneshot
User=root
WorkingDirectory=${SCRIPT_DIR}
EnvironmentFile=${ENV_FILE}
ExecStart=${PYTHON_BIN} ${SCRIPT_PATH}
StandardOutput=append:${LOG_FILE}
StandardError=append:${LOG_FILE}
TimeoutStartSec=120
RemainAfterExit=no

[Install]
WantedBy=multi-user.target
EOF

# Timer systemd (alternativa al cron, más robusto)
cat > "${SYSTEMD_DIR}/${SERVICE_NAME}.timer" << EOF
[Unit]
Description=ImagineCRM — Timer de Actualización Dashboard Metabase
Requires=${SERVICE_NAME}.service

[Timer]
# Ejecutar cada hora
OnCalendar=hourly
# Ejecutar también al arrancar el sistema (con 2 minutos de delay)
OnBootSec=2min
# Persistir la ejecución si el sistema estuvo apagado
Persistent=true
# Aleatorizar el inicio en un rango de 5 minutos (evitar picos de carga)
RandomizedDelaySec=300

[Install]
WantedBy=timers.target
EOF

# Recargar systemd y habilitar el timer
systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.timer"
systemctl start  "${SERVICE_NAME}.timer"

ok "Servicio systemd instalado: ${SERVICE_NAME}.service"
ok "Timer systemd habilitado:   ${SERVICE_NAME}.timer"

# ── Configurar rotación de logs ────────────────────────────────────────────
echo ""
info "Configurando rotación de logs..."

cat > "/etc/logrotate.d/imaginecrm-metabase" << EOF
${LOG_FILE} {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 664 root root
    dateext
    dateformat -%Y%m%d
}
EOF

ok "Rotación de logs configurada (30 días)"

# ── Ejecutar una primera actualización de prueba ──────────────────────────
echo ""
info "Ejecutando primera actualización de prueba..."
echo ""

if ${PYTHON_BIN} "${SCRIPT_PATH}" --status; then
    ok "Primera ejecución completada exitosamente"
else
    warn "La primera ejecución tuvo advertencias. Revisa el .env y los logs."
fi

# ── Resumen final ──────────────────────────────────────────────────────────
echo ""
echo "══════════════════════════════════════════════════════════════"
echo -e "  ${GREEN}✓ Instalación completada${NC}"
echo "══════════════════════════════════════════════════════════════"
echo ""
echo "  Programación configurada:"
echo "  • Cada hora:    Actualización completa (sync BD + refresh cards)"
echo "  • Cada día 2AM: Sincronización de esquema de BD"
echo "  • Cada 6 horas: Verificación de estado"
echo ""
echo "  Comandos útiles:"
echo "  • Ver logs en tiempo real:  tail -f ${LOG_FILE}"
echo "  • Ejecutar manualmente:     systemctl start ${SERVICE_NAME}"
echo "  • Ver estado del timer:     systemctl status ${SERVICE_NAME}.timer"
echo "  • Deshabilitar:             systemctl disable ${SERVICE_NAME}.timer"
echo "  • Ver cron:                 cat ${CRON_FILE}"
echo ""
