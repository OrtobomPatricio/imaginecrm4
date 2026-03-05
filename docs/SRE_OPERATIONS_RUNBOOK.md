# SRE Operations Runbook (Enterprise)

## Ownership model
- **Primary on-call:** Engineering Lead
- **Secondary on-call:** Backend/SRE engineer
- **Escalation:** CTO/Founder within 30 minutes for Sev-1

## Incident severities and response targets
- **Sev-1 (outage/data loss/security incident):** ack <= 5 min, mitigation <= 30 min
- **Sev-2 (major degradation):** ack <= 15 min, mitigation <= 2 h
- **Sev-3 (minor degradation):** ack <= 4 h, mitigation <= 1 business day

## Alert channels
- Sentry alerts -> Pager channel (Slack/Email)
- Uptime monitor alerts -> Pager channel
- DB backup smoke failures -> Ops email + issue tracker

## Required weekly evidence
1. CI green for:
   - Test/Build
   - Real DB parity
2. Backup restore smoke run green (`backup-restore-smoke.yml`)
3. Incident review log updated (even if "no incidents")

## Monthly evidence
1. Secret rotation audit (JWT/cookie/encryption keys policy validation)
2. Access review (production server/database accounts)
3. DR drill note (restore objective and elapsed time)

## Audit storage
- Store links to workflow runs + screenshots + incident timeline in:
  - `ops/audit/YYYY-MM/README.md` (private internal repo/wiki)

## Release gate (operational)
- Do not release if any of these are missing:
  - Latest weekly backup-restore smoke success
  - Latest real DB parity success
  - Open Sev-1 unresolved

## Incident playbook: "No se puede iniciar sesión"

### Síntomas
- Usuario reporta loop de login o sesión expirada inmediatamente.
- `401/403` recurrentes en `/api/trpc/*`.

### Diagnóstico rápido (5-10 min)
1. Confirmar variables en producción:
  - `NODE_ENV=production`
  - `COOKIE_SECRET`, `JWT_SECRET`, `COOKIE_SAMESITE`, `COOKIE_SECURE`, `TRUST_PROXY=1`
2. Verificar URL pública y CORS:
  - `CLIENT_URL`, `VITE_API_URL`, `VITE_OAUTH_PORTAL_URL`, `OAUTH_SERVER_URL`
3. Revisar cabecera `Set-Cookie` en navegador (DevTools):
  - cookie de sesión presente
  - dominio/path/samesite correctos
4. Revisar logs backend para errores de firma token/cookie.

### Mitigación
- Si no hay cookie en cliente: corregir `TRUST_PROXY`, `COOKIE_SECURE`, URL HTTPS.
- Si hay token inválido: rotar sesión del usuario y verificar consistencia de secretos entre instancias.
- Si es solo un tenant: validar estado del tenant (suspendido/billing lock).

## Incident playbook: "La app está lenta"

### Síntomas
- Dashboard/leads/chat con tiempos > 2-3s.
- Timeouts intermitentes en listados o métricas.

### Diagnóstico rápido (10-20 min)
1. Revisar salud de servicios:
  - app CPU/RAM
  - MySQL conexiones activas
  - Redis latencia/errores
2. Ejecutar verificaciones:
  - `pnpm verify:tenant-indexes`
  - `pnpm verify:tenant-performance` (con `TENANT_ID` real)
3. Revisar slow query log o `EXPLAIN` de consultas afectadas.
4. Confirmar que migraciones de índices (`0040`, `0041`) están aplicadas.

### Mitigación
- Aplicar índices faltantes y reiniciar workers de cola.
- Reducir carga temporal (batch sizes, concurrencia de campañas).
- Escalar verticalmente DB/app si hay saturación sostenida.

## Incident playbook: "Error 500 frecuente en módulo X"

### Síntomas
- Error 500 repetido en un router/página específica.
- Aumento de excepciones en logs/Sentry.

### Diagnóstico rápido (10-15 min)
1. Identificar módulo y endpoint exacto (`/api/trpc/<router>.<procedure>`).
2. Correlacionar con `X-Request-Id` y stacktrace.
3. Validar entrada esperada (payload) y permisos del usuario/rol.
4. Reproducir en entorno controlado con mismo tenant/rol.

### Mitigación
- Aplicar hotfix mínimo y seguro en el procedimiento afectado.
- Si no hay fix inmediato: feature flag/rollback del módulo.
- Documentar RCA con causa raíz + acción preventiva.

## Incident playbook: "WhatsApp desconectado tras restore"

### Síntomas
- Conexiones WhatsApp aparecen como "desconectadas" después de restaurar un backup.
- Mensajes salientes fallan con error de sesión.

### Diagnóstico rápido (5 min)
1. Verificar logs del restore: buscar `[Restore] WhatsApp connection secrets re-applied`.
2. Revisar contadores: `secretsRestored` (tokens preservados) y `markedDisconnected` (sin match).
3. Consultar `whatsapp_connections` del tenant: `SELECT id, connectionType, phoneNumberId, isConnected, accessToken IS NOT NULL as hasToken FROM whatsapp_connections WHERE tenantId = ?`.

### Mitigación
- **Cloud API** (connectionType=api): si `accessToken` es NULL → reconectar desde Settings > Distribución (re-OAuth con Meta).
- **QR** (connectionType=qr): si `sessionData` es NULL → escanear QR nuevamente.
- El frontend muestra toast "X conexión(es) necesitan reconectarse" automáticamente.
- **Prevención**: no restaurar backups de otro entorno que tenga phoneNumberIds distintos.

## Incident playbook: "Cuota de mensajes bloqueando envíos"

### Síntomas
- Usuarios reportan que no pueden enviar mensajes.
- Error: "Has alcanzado el límite de X mensajes de tu plan".

### Diagnóstico rápido (5 min)
1. Verificar cuota actual: `SELECT COUNT(*) FROM chat_messages WHERE tenantId = ? AND direction = 'outbound' AND createdAt >= '[primer dia del mes]'`.
2. Verificar plan del tenant: `SELECT plan, maxMessagesPerMonth FROM license WHERE tenantId = ?`.
3. Confirmar que el índice `idx_chat_messages_tenant_dir_created` existe.

### Mitigación
- Si es un falso positivo (plan mal configurado): actualizar `license.maxMessagesPerMonth`.
- Si es cuota real: coordinar con billing para upgrade del plan.
- **Emergencia**: incrementar temporalmente `maxMessagesPerMonth` en la tabla `license`.

## Incident playbook: "PayPal webhooks no llegan"

### Síntomas
- Suscripciones/pagos no se actualizan automáticamente.
- No hay logs de PayPal webhook en el servidor.

### Diagnóstico rápido (10 min)
1. Verificar variables: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_WEBHOOK_ID`.
2. Si `PAYPAL_WEBHOOK_ID` falta en producción → el servidor rechaza 400 en cada webhook.
3. Verificar en PayPal Developer Dashboard → Webhooks → estado y URL configurada.
4. Revisar logs: buscar `paypal` en logs del servidor.

### Mitigación
- Configurar `PAYPAL_WEBHOOK_ID` y reiniciar (validación de env lo detecta en startup).
- Verificar que la URL pública del webhook sea accesible desde internet.
- Re-sincronizar suscripciones manualmente si se perdieron eventos.

## Incident playbook: "Campaña lenta o timeout al lanzar"

### Síntomas
- Lanzar campaña con muchos leads tarda o da timeout.
- Logs muestran queries lentos en `campaign_recipients`.

### Diagnóstico rápido (5 min)
1. Verificar tamaño de audiencia: `SELECT COUNT(*) FROM leads WHERE tenantId = ? AND deletedAt IS NULL`.
2. Verificar que el batch insert está activo (chunks de 500, no INSERT individual).
3. Revisar `campaign_recipients` por duplicados.

### Mitigación
- Si hay más de 10,000 leads: considerar segmentar la audiencia.
- Verificar índices en `campaign_recipients` (tenantId, campaignId).
- Si hay duplicados recurrentes: revisar audienceConfig de la campaña.
