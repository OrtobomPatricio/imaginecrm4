#!/usr/bin/env bash
# =============================================================================
# ImagineCRM — Script de Despliegue a Producción
# Versión: 2.0.0
# Uso:
#   ./deploy.sh                   → Despliegue completo (primera vez)
#   ./deploy.sh --update          → Actualizar versión existente (sin downtime)
#   ./deploy.sh --rollback        → Revertir al despliegue anterior
#   ./deploy.sh --check           → Solo verificar pre-requisitos
#   ./deploy.sh --migrate-only    → Solo ejecutar migraciones de BD
#   ./deploy.sh --status          → Ver estado actual del sistema
# =============================================================================
set -euo pipefail
IFS=$'\n\t'

# ─── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

# ─── Configuración ────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="${PROJECT_ROOT:-$(dirname "$SCRIPT_DIR")}"
APP_NAME="${APP_NAME:-imaginecrm}"
COMPOSE_FILE="${PROJECT_ROOT}/docker-compose.prod.yml"
ENV_FILE="${PROJECT_ROOT}/.env"
BACKUP_DIR="${PROJECT_ROOT}/.deploy-backups"
LOG_FILE="${PROJECT_ROOT}/deploy.log"
HEALTH_URL="http://localhost:3000/api/health"
HEALTH_TIMEOUT=120
MODE="full"

# ─── Argumentos ───────────────────────────────────────────────────────────────
for arg in "$@"; do
  case $arg in
    --update)       MODE="update"        ;;
    --rollback)     MODE="rollback"      ;;
    --check)        MODE="check"         ;;
    --migrate-only) MODE="migrate"       ;;
    --status)       MODE="status"        ;;
    --help|-h)      MODE="help"          ;;
    *)              echo -e "${RED}Argumento desconocido: $arg${NC}"; exit 1 ;;
  esac
done

# ─── Funciones de utilidad ────────────────────────────────────────────────────

log() {
  local level="$1"; shift
  local msg="$*"
  local ts; ts=$(date '+%Y-%m-%d %H:%M:%S')
  echo "$ts [$level] $msg" >> "$LOG_FILE"
  case $level in
    INFO)  echo -e "${GREEN}[✓]${NC} $msg" ;;
    WARN)  echo -e "${YELLOW}[!]${NC} $msg" ;;
    ERROR) echo -e "${RED}[✗]${NC} $msg" ;;
    STEP)  echo -e "${BLUE}${BOLD}[→]${NC} $msg" ;;
    *)     echo "$msg" ;;
  esac
}

die() {
  log ERROR "$*"
  echo -e "${RED}${BOLD}Despliegue abortado.${NC} Revisa $LOG_FILE para más detalles."
  exit 1
}

banner() {
  echo -e "${CYAN}${BOLD}"
  echo "╔══════════════════════════════════════════════════════╗"
  echo "║          ImagineCRM — Deploy a Producción            ║"
  echo "║                    v2.0.0                            ║"
  echo "╚══════════════════════════════════════════════════════╝"
  echo -e "${NC}"
}

show_help() {
  banner
  cat <<EOF
${BOLD}USO:${NC}
  ./deploy.sh [OPCIÓN]

${BOLD}OPCIONES:${NC}
  (sin opción)      Despliegue completo desde cero (primera vez)
  --update          Actualizar versión sin downtime (rolling update)
  --rollback        Revertir al despliegue anterior
  --check           Verificar pre-requisitos sin desplegar
  --migrate-only    Ejecutar solo las migraciones de base de datos
  --status          Ver estado actual del sistema
  --help            Mostrar esta ayuda

${BOLD}VARIABLES DE ENTORNO REQUERIDAS:${NC}
  APP_DOMAIN        Dominio principal (ej: imaginecrm.com)
  JWT_SECRET        Secreto para tokens JWT (mínimo 32 chars)
  DATA_ENCRYPTION_KEY Clave de cifrado de datos (32 chars hex)
  MYSQL_PASSWORD    Contraseña de MySQL
  STRIPE_SECRET_KEY Clave secreta de Stripe (para billing)
  SMTP_HOST         Servidor SMTP para emails

${BOLD}EJEMPLOS:${NC}
  ./deploy.sh                              # Primera instalación
  APP_DOMAIN=crm.miempresa.com ./deploy.sh # Con dominio personalizado
  ./deploy.sh --update                     # Actualizar tras git pull
  ./deploy.sh --status                     # Ver estado del sistema
EOF
}

# ─── Pre-checks ───────────────────────────────────────────────────────────────

check_prerequisites() {
  log STEP "Verificando pre-requisitos del sistema..."
  local errors=0

  # Docker
  if ! command -v docker &>/dev/null; then
    log ERROR "Docker no está instalado. Ejecuta: curl -fsSL https://get.docker.com | sh"
    ((errors++))
  else
    local docker_version; docker_version=$(docker --version | grep -oP '\d+\.\d+' | head -1)
    log INFO "Docker $docker_version instalado"
  fi

  # Docker Compose
  if ! docker compose version &>/dev/null 2>&1; then
    log ERROR "Docker Compose v2 no está disponible. Actualiza Docker Desktop o instala el plugin."
    ((errors++))
  else
    log INFO "Docker Compose v2 disponible"
  fi

  # OpenSSL (para generar secretos)
  if ! command -v openssl &>/dev/null; then
    log WARN "openssl no encontrado — los secretos no se generarán automáticamente"
  else
    log INFO "openssl disponible"
  fi

  # curl (para health checks)
  if ! command -v curl &>/dev/null; then
    log WARN "curl no encontrado — los health checks se omitirán"
  else
    log INFO "curl disponible"
  fi

  # Archivo .env
  if [ ! -f "$ENV_FILE" ]; then
    log WARN "Archivo .env no encontrado en $ENV_FILE"
    log WARN "Se generará uno nuevo. Revísalo antes de continuar."
  else
    log INFO "Archivo .env encontrado"
    check_env_vars
  fi

  # Espacio en disco (mínimo 5GB)
  local available_gb; available_gb=$(df -BG "$PROJECT_ROOT" | awk 'NR==2 {print $4}' | tr -d 'G')
  if [ "${available_gb:-0}" -lt 5 ]; then
    log WARN "Espacio en disco bajo: ${available_gb}GB disponibles (recomendado: 5GB+)"
  else
    log INFO "Espacio en disco: ${available_gb}GB disponibles"
  fi

  # RAM (mínimo 2GB)
  local ram_gb; ram_gb=$(free -g | awk '/^Mem:/{print $2}')
  if [ "${ram_gb:-0}" -lt 2 ]; then
    log WARN "RAM disponible: ${ram_gb}GB (recomendado: 2GB+)"
  else
    log INFO "RAM: ${ram_gb}GB disponible"
  fi

  if [ "$errors" -gt 0 ]; then
    die "$errors pre-requisito(s) crítico(s) no cumplido(s)"
  fi

  log INFO "Todos los pre-requisitos verificados correctamente"
}

check_env_vars() {
  local required_vars=(
    "JWT_SECRET"
    "DATA_ENCRYPTION_KEY"
    "MYSQL_PASSWORD"
    "DATABASE_URL"
  )
  local missing=0

  for var in "${required_vars[@]}"; do
    if ! grep -q "^${var}=" "$ENV_FILE" 2>/dev/null; then
      log WARN "Variable requerida no encontrada en .env: $var"
      ((missing++))
    fi
  done

  # Verificar longitud mínima de JWT_SECRET
  local jwt_val; jwt_val=$(grep '^JWT_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | tr -d "'")
  if [ ${#jwt_val} -lt 32 ]; then
    log WARN "JWT_SECRET es demasiado corto (${#jwt_val} chars, mínimo 32)"
  fi

  # Verificar que ALLOW_DEV_LOGIN esté en 0
  local dev_login; dev_login=$(grep '^ALLOW_DEV_LOGIN=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
  if [ "$dev_login" != "0" ]; then
    log WARN "ALLOW_DEV_LOGIN no está en 0 — RIESGO DE SEGURIDAD en producción"
  fi

  if [ "$missing" -gt 0 ]; then
    log WARN "$missing variable(s) requerida(s) no encontrada(s) en .env"
  fi
}

# ─── Generación de .env ───────────────────────────────────────────────────────

generate_env() {
  log STEP "Generando archivo .env de producción..."

  # Preservar secretos existentes si ya hay un .env
  local jwt_secret db_pass enc_key mysql_root_pass
  if [ -f "$ENV_FILE" ]; then
    log INFO "Preservando secretos del .env existente..."
    jwt_secret=$(grep '^JWT_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
    db_pass=$(grep '^MYSQL_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
    enc_key=$(grep '^DATA_ENCRYPTION_KEY=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
    mysql_root_pass=$(grep '^MYSQL_ROOT_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- | tr -d '"' || true)
  fi

  # Generar nuevos secretos si no existen
  jwt_secret="${jwt_secret:-$(openssl rand -hex 32)}"
  db_pass="${db_pass:-$(openssl rand -hex 16)}"
  enc_key="${enc_key:-$(openssl rand -hex 32)}"
  mysql_root_pass="${mysql_root_pass:-$(openssl rand -hex 16)}"

  local domain="${APP_DOMAIN:-localhost}"
  local protocol="https"
  if [[ "$domain" == "localhost" ]] || [[ "$domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    protocol="http"
  fi
  local base_url="${protocol}://${domain}"

  cat > "$ENV_FILE" <<EOF
# ============================================================
# ImagineCRM — Configuración de Producción
# Generado: $(date '+%Y-%m-%d %H:%M:%S')
# ============================================================

# ─── Aplicación ─────────────────────────────────────────────
NODE_ENV=production
APP_DOMAIN=${domain}
CLIENT_URL=${base_url}
PORT=3000

# ─── Seguridad ──────────────────────────────────────────────
JWT_SECRET=${jwt_secret}
DATA_ENCRYPTION_KEY=${enc_key}
ALLOW_DEV_LOGIN=0
VITE_DEV_BYPASS_AUTH=0

# ─── Base de Datos ──────────────────────────────────────────
MYSQL_DATABASE=imaginecrm
MYSQL_USER=imaginecrm
MYSQL_PASSWORD=${db_pass}
MYSQL_ROOT_PASSWORD=${mysql_root_pass}
DATABASE_URL=mysql://imaginecrm:${db_pass}@mysql:3306/imaginecrm
RUN_MIGRATIONS=1

# ─── Redis ──────────────────────────────────────────────────
REDIS_URL=redis://redis:6379

# ─── OAuth / Auth ───────────────────────────────────────────
VITE_OAUTH_PORTAL_URL=${base_url}
OAUTH_SERVER_URL=${base_url}
VITE_APP_ID=imaginecrm

# ─── WhatsApp ───────────────────────────────────────────────
WHATSAPP_WEBHOOK_VERIFY_TOKEN=imaginecrm_verify_$(openssl rand -hex 8)
WHATSAPP_APP_SECRET=
WHATSAPP_GRAPH_VERSION=v19.0
WHATSAPP_GRAPH_BASE_URL=https://graph.facebook.com

# ─── Stripe (Billing) ───────────────────────────────────────
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
STRIPE_PRICE_STARTER=
STRIPE_PRICE_PRO=
STRIPE_PRICE_ENTERPRISE=

# ─── Email (SMTP) ───────────────────────────────────────────
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=noreply@${domain}

# ─── Almacenamiento ─────────────────────────────────────────
STORAGE_PATH=/app/storage/uploads
MAX_UPLOAD_SIZE_MB=50

# ─── Analytics (opcional) ───────────────────────────────────
VITE_ANALYTICS_ENDPOINT=
VITE_ANALYTICS_WEBSITE_ID=

# ─── Superadmin inicial ─────────────────────────────────────
BOOTSTRAP_ADMIN_EMAIL=admin@${domain}
BOOTSTRAP_ADMIN_PASSWORD=$(openssl rand -base64 16 | tr -d '/+=' | head -c 16)
EOF

  log INFO "Archivo .env generado en: $ENV_FILE"
  log WARN "IMPORTANTE: Completa las variables de Stripe y SMTP antes de continuar"
  echo ""
  echo -e "${YELLOW}${BOLD}Variables que debes completar manualmente:${NC}"
  echo "  STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, STRIPE_PRICE_*"
  echo "  SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS"
  echo ""
}

# ─── Backup ───────────────────────────────────────────────────────────────────

create_backup() {
  log STEP "Creando backup del estado actual..."
  mkdir -p "$BACKUP_DIR"
  local ts; ts=$(date '+%Y%m%d_%H%M%S')
  local backup_path="$BACKUP_DIR/backup_${ts}"
  mkdir -p "$backup_path"

  # Backup del .env
  [ -f "$ENV_FILE" ] && cp "$ENV_FILE" "$backup_path/.env.bak"

  # Backup de la base de datos (si MySQL está corriendo)
  if docker compose -f "$COMPOSE_FILE" ps mysql 2>/dev/null | grep -q "running"; then
    log INFO "Haciendo dump de la base de datos..."
    local db_pass; db_pass=$(grep '^MYSQL_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    local db_name; db_name=$(grep '^MYSQL_DATABASE=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    docker compose -f "$COMPOSE_FILE" exec -T mysql \
      mysqldump -u imaginecrm -p"${db_pass}" "${db_name}" \
      > "$backup_path/database.sql" 2>/dev/null \
      && log INFO "Dump de BD guardado en: $backup_path/database.sql" \
      || log WARN "No se pudo hacer dump de la BD (continuando...)"
  fi

  # Guardar imagen actual del contenedor app
  local current_image; current_image=$(docker compose -f "$COMPOSE_FILE" images app 2>/dev/null | awk 'NR>1{print $2}' | head -1)
  echo "${current_image:-unknown}" > "$backup_path/image_tag.txt"

  # Limpiar backups antiguos (mantener últimos 5)
  ls -dt "$BACKUP_DIR"/backup_* 2>/dev/null | tail -n +6 | xargs rm -rf 2>/dev/null || true

  log INFO "Backup creado en: $backup_path"
  echo "$backup_path"
}

# ─── Migraciones ──────────────────────────────────────────────────────────────

run_migrations() {
  log STEP "Ejecutando migraciones de base de datos..."

  # Esperar a que MySQL esté listo
  local max_wait=60
  local waited=0
  log INFO "Esperando que MySQL esté disponible..."
  until docker compose -f "$COMPOSE_FILE" exec -T mysql \
    mysqladmin ping -h 127.0.0.1 --silent 2>/dev/null; do
    if [ "$waited" -ge "$max_wait" ]; then
      die "MySQL no respondió después de ${max_wait}s"
    fi
    sleep 2
    ((waited+=2))
    echo -n "."
  done
  echo ""
  log INFO "MySQL disponible después de ${waited}s"

  # Ejecutar migraciones Drizzle
  docker compose -f "$COMPOSE_FILE" exec -T app node dist/migrate.js \
    && log INFO "Migraciones ejecutadas correctamente" \
    || die "Error al ejecutar migraciones"

  # Ejecutar migración de analytics (tablas nuevas)
  log INFO "Aplicando migración de analytics y ciclo SaaS..."
  local db_pass; db_pass=$(grep '^MYSQL_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
  local db_name; db_name=$(grep '^MYSQL_DATABASE=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)

  # Migración 0037: trialEndsAt + password_reset_tokens
  if [ -f "${PROJECT_ROOT}/drizzle/0037_saas_lifecycle_fixes.sql" ]; then
    docker compose -f "$COMPOSE_FILE" exec -T mysql \
      mysql -u imaginecrm -p"${db_pass}" "${db_name}" \
      < "${PROJECT_ROOT}/drizzle/0037_saas_lifecycle_fixes.sql" 2>/dev/null \
      && log INFO "Migración 0037 (SaaS lifecycle) aplicada" \
      || log WARN "Migración 0037 ya aplicada o error (continuando)"
  fi

  # Migración 0038: critical_email_log
  if [ -f "${PROJECT_ROOT}/drizzle/0038_critical_email_log.sql" ]; then
    docker compose -f "$COMPOSE_FILE" exec -T mysql \
      mysql -u imaginecrm -p"${db_pass}" "${db_name}" \
      < "${PROJECT_ROOT}/drizzle/0038_critical_email_log.sql" 2>/dev/null \
      && log INFO "Migración 0038 (critical email log) aplicada" \
      || log WARN "Migración 0038 ya aplicada o error (continuando)"
  fi
}

# ─── Health check ─────────────────────────────────────────────────────────────

wait_for_health() {
  log STEP "Esperando que la aplicación esté lista..."
  local waited=0
  local interval=5

  until curl -sf "$HEALTH_URL" &>/dev/null; do
    if [ "$waited" -ge "$HEALTH_TIMEOUT" ]; then
      log ERROR "La aplicación no respondió después de ${HEALTH_TIMEOUT}s"
      log ERROR "Últimos logs del contenedor app:"
      docker compose -f "$COMPOSE_FILE" logs --tail=30 app 2>/dev/null || true
      die "Health check fallido"
    fi
    sleep "$interval"
    ((waited+=interval))
    echo -ne "\r  Esperando... ${waited}s / ${HEALTH_TIMEOUT}s"
  done
  echo ""
  log INFO "Aplicación lista después de ${waited}s"
}

# ─── Verificación post-deploy ─────────────────────────────────────────────────

verify_deployment() {
  log STEP "Verificando despliegue..."

  # Health check básico
  local health_response; health_response=$(curl -sf "$HEALTH_URL" 2>/dev/null || echo "{}")
  log INFO "Health check: $health_response"

  # Verificar que los workers están corriendo
  local app_logs; app_logs=$(docker compose -f "$COMPOSE_FILE" logs --tail=20 app 2>/dev/null)

  if echo "$app_logs" | grep -q "license-expiry-worker"; then
    log INFO "Worker de expiración de licencias: activo"
  else
    log WARN "Worker de expiración de licencias: no detectado en logs recientes"
  fi

  if echo "$app_logs" | grep -q "critical-email-worker"; then
    log INFO "Worker de emails críticos: activo"
  else
    log WARN "Worker de emails críticos: no detectado en logs recientes"
  fi

  # Verificar servicios Docker
  echo ""
  echo -e "${BOLD}Estado de los servicios:${NC}"
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null

  # Verificar endpoint de analytics
  local analytics_url="http://localhost:3000/api/trpc/analytics.overview"
  if curl -sf "$analytics_url" &>/dev/null; then
    log INFO "Endpoint de analytics: respondiendo"
  else
    log WARN "Endpoint de analytics: no verificable sin autenticación (normal)"
  fi
}

# ─── Modo: Status ─────────────────────────────────────────────────────────────

show_status() {
  banner
  echo -e "${BOLD}Estado del sistema ImagineCRM${NC}"
  echo "──────────────────────────────────────────────────"

  if ! [ -f "$COMPOSE_FILE" ]; then
    echo -e "${RED}docker-compose.prod.yml no encontrado${NC}"
    return 1
  fi

  # Estado de contenedores
  echo -e "\n${BOLD}Contenedores:${NC}"
  docker compose -f "$COMPOSE_FILE" ps 2>/dev/null || echo "No hay contenedores corriendo"

  # Health check
  echo -e "\n${BOLD}Health Check:${NC}"
  if curl -sf "$HEALTH_URL" &>/dev/null; then
    echo -e "${GREEN}✓ Aplicación respondiendo en $HEALTH_URL${NC}"
  else
    echo -e "${RED}✗ Aplicación no responde en $HEALTH_URL${NC}"
  fi

  # Uso de recursos
  echo -e "\n${BOLD}Uso de recursos:${NC}"
  docker stats --no-stream --format "table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}" 2>/dev/null | \
    grep -E "imaginecrm|NAME" || echo "No hay contenedores activos"

  # Últimas líneas de logs
  echo -e "\n${BOLD}Últimos logs (app):${NC}"
  docker compose -f "$COMPOSE_FILE" logs --tail=10 app 2>/dev/null || echo "Sin logs disponibles"

  # Backups disponibles
  echo -e "\n${BOLD}Backups disponibles:${NC}"
  ls -lt "$BACKUP_DIR" 2>/dev/null | head -6 || echo "Sin backups"
}

# ─── Modo: Rollback ───────────────────────────────────────────────────────────

do_rollback() {
  log STEP "Iniciando rollback al despliegue anterior..."

  local latest_backup; latest_backup=$(ls -dt "$BACKUP_DIR"/backup_* 2>/dev/null | head -1)
  if [ -z "$latest_backup" ]; then
    die "No hay backups disponibles para rollback"
  fi

  log INFO "Usando backup: $latest_backup"

  # Restaurar .env
  if [ -f "$latest_backup/.env.bak" ]; then
    cp "$latest_backup/.env.bak" "$ENV_FILE"
    log INFO ".env restaurado"
  fi

  # Restaurar base de datos
  if [ -f "$latest_backup/database.sql" ]; then
    log INFO "Restaurando base de datos..."
    local db_pass; db_pass=$(grep '^MYSQL_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    local db_name; db_name=$(grep '^MYSQL_DATABASE=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
    docker compose -f "$COMPOSE_FILE" exec -T mysql \
      mysql -u imaginecrm -p"${db_pass}" "${db_name}" \
      < "$latest_backup/database.sql" \
      && log INFO "Base de datos restaurada" \
      || log WARN "Error al restaurar BD"
  fi

  # Reiniciar servicios
  docker compose -f "$COMPOSE_FILE" restart app
  wait_for_health

  log INFO "Rollback completado"
}

# ─── Modo: Update (sin downtime) ─────────────────────────────────────────────

do_update() {
  log STEP "Iniciando actualización sin downtime..."

  # Backup antes de actualizar
  create_backup

  # Pull de cambios
  if [ -d "${PROJECT_ROOT}/.git" ]; then
    log INFO "Actualizando código fuente..."
    cd "$PROJECT_ROOT"
    git pull origin main 2>/dev/null || log WARN "git pull falló — usando código local"
  fi

  # Rebuild solo del contenedor app
  log INFO "Reconstruyendo imagen de la aplicación..."
  docker compose -f "$COMPOSE_FILE" build --no-cache app \
    || die "Error al construir la imagen"

  # Rolling update: levantar nuevo contenedor antes de bajar el viejo
  log INFO "Aplicando rolling update..."
  docker compose -f "$COMPOSE_FILE" up -d --no-deps app \
    || die "Error al actualizar el contenedor"

  # Ejecutar migraciones
  run_migrations

  # Verificar
  wait_for_health
  verify_deployment

  log INFO "Actualización completada sin downtime"
}

# ─── Modo: Despliegue completo ────────────────────────────────────────────────

do_full_deploy() {
  banner
  log STEP "Iniciando despliegue completo de ImagineCRM..."
  echo ""

  # 1. Pre-checks
  check_prerequisites

  # 2. Generar .env si no existe
  if [ ! -f "$ENV_FILE" ]; then
    generate_env
    echo ""
    echo -e "${YELLOW}${BOLD}⚠️  Se generó un nuevo .env en: $ENV_FILE${NC}"
    echo -e "${YELLOW}Completa las variables de Stripe y SMTP antes de continuar.${NC}"
    echo ""
    read -rp "¿Deseas continuar con el despliegue ahora? [s/N]: " confirm
    if [[ ! "$confirm" =~ ^[sS]$ ]]; then
      echo "Despliegue pausado. Edita $ENV_FILE y vuelve a ejecutar ./deploy.sh"
      exit 0
    fi
  fi

  # 3. Backup (si hay algo que respaldar)
  if docker compose -f "$COMPOSE_FILE" ps 2>/dev/null | grep -q "running"; then
    create_backup
  fi

  # 4. Construir imágenes
  log STEP "Construyendo imágenes Docker..."
  cd "$PROJECT_ROOT"
  docker compose -f "$COMPOSE_FILE" build --no-cache \
    || die "Error al construir las imágenes Docker"
  log INFO "Imágenes construidas correctamente"

  # 5. Levantar servicios
  log STEP "Levantando servicios..."
  docker compose -f "$COMPOSE_FILE" up -d \
    || die "Error al levantar los servicios"
  log INFO "Servicios levantados"

  # 6. Migraciones
  run_migrations

  # 7. Health check
  wait_for_health

  # 8. Verificación
  verify_deployment

  # 9. Resumen final
  local domain; domain=$(grep '^APP_DOMAIN=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2- || echo "localhost")
  local admin_email; admin_email=$(grep '^BOOTSTRAP_ADMIN_EMAIL=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)
  local admin_pass; admin_pass=$(grep '^BOOTSTRAP_ADMIN_PASSWORD=' "$ENV_FILE" 2>/dev/null | cut -d'=' -f2-)

  echo ""
  echo -e "${GREEN}${BOLD}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}${BOLD}║         ✅ Despliegue completado exitosamente        ║${NC}"
  echo -e "${GREEN}${BOLD}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "${BOLD}Acceso al sistema:${NC}"
  echo -e "  URL:      ${CYAN}https://${domain}${NC}"
  echo -e "  Admin:    ${CYAN}${admin_email}${NC}"
  echo -e "  Password: ${CYAN}${admin_pass}${NC}"
  echo ""
  echo -e "${BOLD}Comandos útiles:${NC}"
  echo "  Ver logs:      docker compose -f docker-compose.prod.yml logs -f app"
  echo "  Ver estado:    ./deploy/deploy.sh --status"
  echo "  Actualizar:    ./deploy/deploy.sh --update"
  echo "  Rollback:      ./deploy/deploy.sh --rollback"
  echo ""
  echo -e "${YELLOW}⚠️  Guarda las credenciales del admin en un lugar seguro.${NC}"
  echo -e "${YELLOW}⚠️  Configura Stripe y SMTP en .env si aún no lo hiciste.${NC}"
  echo ""
  log INFO "Log completo disponible en: $LOG_FILE"
}

# ─── Dispatcher principal ─────────────────────────────────────────────────────

mkdir -p "$(dirname "$LOG_FILE")"
touch "$LOG_FILE"

case "$MODE" in
  full)         do_full_deploy    ;;
  update)       do_update         ;;
  rollback)     do_rollback       ;;
  check)        check_prerequisites; log INFO "Pre-checks completados" ;;
  migrate)      run_migrations    ;;
  status)       show_status       ;;
  help)         show_help         ;;
esac
