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
