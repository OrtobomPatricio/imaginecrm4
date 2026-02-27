# EasyPanel - Registro de Estabilización y Configuración Final

Este documento guarda el progreso real que permitió estabilizar el despliegue de Imagine CRM en EasyPanel (Docker Swarm + Traefik), incluyendo fixes de código, configuración final y checklist de verificación.

## 1) Estado final validado

- La app arranca correctamente y responde por dominio público.
- El servicio dejó de ciclar en estado `0/1` por salidas limpias no deseadas.
- La secuencia de arranque estable quedó: migración controlada -> bootstrap admin -> server.

## 2) Problemas resueltos (histórico)

1. **Deriva de esquema (schema drift)** en producción:
   - Faltaban columnas/tablas esperadas por código actual.
   - Se agregó parche de compatibilidad en migraciones para entornos legacy.

2. **Refresh de vistas/materialized summaries frágil**:
   - Fallos por datos nulos o estructuras antiguas.
   - Se endureció el refresh por pasos y tolerancia a valores legacy.

3. **Comportamiento mock DB en producción**:
   - Se bloqueó explícitamente el fallback/mock en `NODE_ENV=production`.
   - Carga lazy del módulo mock para evitar efectos secundarios en arranque.

4. **Loop Swarm `Ready/Complete` (sin crash explícito)**:
   - Causa raíz: bloque standalone ejecutando `process.exit(0)` en contexto bundle/import.
   - Se cambió a ejecución standalone **solo** con variable explícita.

## 3) Commits clave aplicados

- `bf03aed` - schema compatibility + disable legacy runtime SQL optimizers
- `98e756b` - MV hardening against null/legacy values
- `40efc8e` - forbid mock DB in prod + schema patching
- `c37bf97` - lazy-load mock DB + bootstrap admin tenant
- `3b2b089` - prevent standalone MV runner from exiting bundled server process

## 4) Configuración final recomendada en EasyPanel

### Servicio (Web Service)

- Tipo: **Web Service**
- Puerto interno app: `3000`
- Publicación por Traefik: `80/443` (proxy)
- Imagen/Build: rama `main` actualizada

### Comando/arranque

- Usar entrypoint estándar del proyecto (no reemplazar con comandos que terminen proceso principal).
- Evitar comandos one-shot como comando principal de servicio.

### Variables de entorno críticas

- `NODE_ENV=production`
- `PORT=3000`
- `DATABASE_URL=<mysql...>`
- `SESSION_SECRET=<seguro>`
- `DATA_ENCRYPTION_KEY=<32+ chars>`
- `RUN_MIGRATIONS=0` (mantener en `0` para operación estable continua; ejecutar migración manual/controlada en cambios mayores)

### Variable de seguridad para standalone MV

- **No definir** `RUN_MV_STANDALONE` en el servicio web.
- Solo usar `RUN_MV_STANDALONE=1` para ejecución manual y puntual fuera del proceso web.

### Estrategia durante estabilización

- Desactivar temporalmente “zero downtime/rolling agresivo” si genera reemplazos continuos.
- Validar estabilidad `1/1` antes de volver a activar despliegue progresivo.

## 5) Checklist operativo post-deploy

1. Ver réplica estable:
   - `docker service ls | grep crm_imagine-crm`
   - Esperado: `1/1` estable (sin rotación constante de task id).

2. Verificar health endpoint:
   - `https://<tu-dominio>/healthz`

3. Confirmar logs limpios de lifecycle:
   - Sin secuencia repetida `Starting -> Complete` cada pocos segundos.

4. Confirmar app funcional:
   - Login, carga de dashboard, operaciones básicas de tenant.

## 6) Procedimiento seguro de actualización

1. Hacer `git pull`/redeploy de `main`.
2. Mantener `RUN_MIGRATIONS=0` por defecto en runtime.
3. Si release incluye cambios de schema, correr migración de forma controlada (job/manual), verificar y recién luego subir tráfico completo.
4. Validar checklist operativo.

## 7) Referencias internas

- `server/services/materialized-views.ts`
- `server/scripts/migrate.ts`
- `server/db.ts`
- `server/scripts/bootstrap-admin.ts`
- `deploy/docker-entrypoint.sh`

---

Última actualización: 2026-02-26
