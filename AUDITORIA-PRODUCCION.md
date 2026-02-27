# 🔍 AUDITORÍA COMPLETA - CRM PRO V4
## Estado de Preparación para Producción

**Fecha de Auditoría:** 26 de Febrero de 2026  
**Versión del Proyecto:** 1.0.0  
**Total de Archivos:** ~90,945 archivos (incluyendo node_modules)  
**Líneas de Código (Schema DB):** 1,034 líneas  
**Stack:** React 19 + Node.js + Express + tRPC + Drizzle ORM + MySQL 8 + Redis

## ✅ FUENTE DE VERDAD ACTUAL (NO HISTÓRICA)

Para evitar conflictos con logs antiguos, el estado de preparación para producción se valida **solo** con estos comandos ejecutados en el estado actual del repo:

```powershell
pnpm check
pnpm build
$env:DATABASE_URL=''; $env:NODE_ENV='test'; pnpm test

$env:NODE_ENV='production'
$env:DATABASE_URL='mysql://<user>:<pass>@mysql:3306/<db>'
$env:JWT_SECRET='<64+ chars>'
$env:COOKIE_SECRET='<64+ chars>'
$env:DATA_ENCRYPTION_KEY='<32+ chars>'
$env:ALLOW_DEV_LOGIN='0'
$env:VITE_DEV_BYPASS_AUTH='0'
$env:REQUIRE_REDIS_IN_PROD='1'
$env:REDIS_URL='redis://redis:6379'
pnpm validate:prod-config
```

**Criterio de aprobación:** si todos los comandos anteriores pasan, el proyecto se considera técnicamente listo para producción a nivel de compilación, build, tests automatizados y validación de entorno.

---

## 📊 RESUMEN EJECUTIVO

| Categoría | Calificación | Estado |
|-----------|--------------|--------|
| **Arquitectura** | ⭐⭐⭐⭐⭐ (9/10) | ✅ Excelente |
| **Seguridad** | ⭐⭐⭐⭐☆ (7.5/10) | ⚠️ Requiere atención |
| **Base de Datos** | ⭐⭐⭐⭐⭐ (8.5/10) | ✅ Muy buena |
| **Tests** | ⭐⭐⭐☆☆ (5/10) | ⚠️ Necesita más cobertura |
| **CI/CD** | ⭐⭐⭐⭐☆ (8/10) | ✅ Bueno |
| **Docker/Deployment** | ⭐⭐⭐⭐⭐ (9/10) | ✅ Excelente |
| **Documentación** | ⭐⭐⭐⭐☆ (7/10) | ⚠️ Parcial |
| **Código/TypeScript** | ⭐⭐⭐☆☆ (5.5/10) | ❌ Tiene errores |

### 🎯 Calificación General: **7.2/10** (APROBADO CON OBSERVACIONES)

**Estado para Producción:** ⚠️ **LISTO CON CONDICIONES** - El sistema puede funcionar en producción pero requiere correcciones críticas antes de estar 100% listo.

---

## 1. 🏗 ARQUITECTURA Y ESTRUCTURA

### Calificación: 9/10 ⭐⭐⭐⭐⭐

#### ✅ Fortalezas

| Aspecto | Descripción |
|---------|-------------|
| **Multi-tenancy** | Arquitectura SaaS robusta con aislamiento de datos por tenant |
| **Modularidad** | Código bien organizado en módulos (`server/_core`, `server/routers`, `server/services`) |
| **API Type-Safe** | tRPC con tipos compartidos entre frontend y backend |
| **ORM Moderno** | Drizzle ORM con migraciones SQL manuales |
| **Micro-servicios ligeros** | Workers separados para campañas, workflows, reminders |
| **WebSocket** | Socket.io para comunicación en tiempo real |
| **PWA** | Progressive Web App configurada con Workbox |

#### ⚠️ Debilidades

| Problema | Severidad | Descripción |
|----------|-----------|-------------|
| Mezcla de responsabilidades en `server/_core/index.ts` | Baja | El archivo principal tiene ~400+ líneas |
| Algunos routers muy grandes | Media | `chat.ts` y `whatsapp.ts` son extensos |

#### 📋 Acciones Recomendadas

- [ ] Considerar dividir routers grandes en sub-módulos
- [ ] Implementar API versioning para futuros cambios

---

## 2. 🔐 SEGURIDAD

### Calificación: 7.5/10 ⭐⭐⭐⭐☆

#### ✅ Fortalezas

| Control | Implementación | Estado |
|---------|----------------|--------|
| **Rate Limiting** | express-rate-limit con Redis store | ✅ Configurado |
| **Helmet.js** | Headers de seguridad CSP | ✅ Implementado |
| **CORS** | Orígenes explícitos en producción | ✅ Configurado |
| **RBAC** | Sistema de roles granular (owner/admin/supervisor/agent/viewer) | ✅ Completo |
| **Tenant Isolation** | Todas las queries filtran por tenantId | ✅ Verificado |
| **PII Encryption** | Servicio de encriptación para datos sensibles | ✅ Implementado |
| **Password Policy** | Validación de fortaleza de contraseñas | ✅ Configurado |
| **TOTP/2FA** | Soporte para autenticación de dos factores | ✅ Implementado |
| **Validación de Secrets** | Chequeo de variables en producción | ✅ Activo |
| **Sanitización** | Masking de PII en logs y respuestas | ✅ Implementado |
| **Idempotency Keys** | Prevención de duplicados en operaciones | ✅ Configurado |
| **Audit Logs** | Tablas access_logs y activity_logs | ✅ Implementado |

#### ⚠️ Debilidades Críticas

| Problema | Severidad | Impacto |
|----------|-----------|---------|
| **HSTS deshabilitado** | 🔴 Alta | `hsts: false` en Helmet config - riesgo de downgrade attacks |
| **CSP con 'unsafe-inline'** | 🟡 Media | Scripts inline permitidos en CSP |
| **No hay DDoS protection** | 🟡 Media | Rate limiting básico, sin protección contra volumetría |
| **Secrets en localStorage** | 🟡 Media | Tokens pueden estar en localStorage del cliente |

#### 📋 Acciones Requeridas para Producción

- [ ] **CRÍTICO:** Habilitar HSTS en producción o usar HTTPS forzado por Caddy
- [ ] **CRÍTICO:** Revisar que ningún secret se almacene en localStorage
- [ ] Implementar WAF o Cloudflare para protección DDoS
- [ ] Agregar validación de archivos subidos (solo se tiene magic-numbers básico)
- [ ] Implementar límite de tamaño de payload más restrictivo

---

## 3. 🗄 BASE DE DATOS Y MIGRACIONES

### Calificación: 8.5/10 ⭐⭐⭐⭐⭐

#### ✅ Fortalezas

| Aspecto | Implementación |
|---------|----------------|
| **Drizzle ORM** | ORM type-safe con 50+ tablas bien definidas |
| **Índices** | Índices estratégicos en campos de búsqueda frecuente |
| **Relaciones** | Foreign keys con `onDelete: cascade` apropiado |
| **Migraciones** | Sistema de migraciones SQL con `drizzle-kit` |
| **Soft Deletes** | Campos `deletedAt` en entidades principales |
| **Multi-tenancy** | `tenantId` en todas las tablas relevantes |
| **Constraints** | Unique indexes para prevenir duplicados |

#### 📊 Schema Analysis

```
Tablas principales identificadas:
├── tenants, users, app_settings          (Core)
├── leads, pipelines, pipeline_stages     (CRM)
├── conversations, chat_messages          (Chat)
├── whatsapp_numbers, whatsapp_connections (WhatsApp)
├── campaigns, campaign_recipients        (Marketing)
├── appointments, appointment_reasons     (Scheduling)
├── workflows, workflow_logs, workflow_jobs (Automation)
├── tags, lead_tags, conversation_tags    (Categorización)
├── access_logs, activity_logs            (Auditoría)
└── license, usage_tracking               (Billing)
```

#### ⚠️ Debilidades

| Problema | Severidad | Descripción |
|----------|-----------|-------------|
| Sin particionamiento de tablas grandes | 🟡 Media | `chat_messages` puede crecer rápidamente |
| Sin políticas de retención de datos | 🟡 Media | No hay TTL en logs o mensajes antiguos |

#### 📋 Acciones Recomendadas

- [ ] Implementar particionamiento para `chat_messages` por fecha
- [ ] Configurar job de limpieza de datos antiguos (GDPR compliance)
- [ ] Agregar índices de full-text search para búsquedas de leads

---

## 4. 🧪 TESTS Y COBERTURA

### Calificación: 5/10 ⭐⭐⭐☆☆

#### ✅ Fortalezas

| Tipo | Cobertura | Framework |
|------|-----------|-----------|
| Tests Unitarios | Servicios de seguridad | Vitest |
| Tests de Integración | Tenant isolation, seguridad | Vitest |
| Tests E2E | Smoke, Security, Kanban, Onboarding | Playwright |
| Cobertura objetivo | 50% (configurado) | v8 |

#### ⚠️ Debilidades Críticas

| Problema | Severidad | Detalle |
|----------|-----------|---------|
| **Baja cobertura de tests** | 🔴 Alta | Solo ~5-10% de los routers están testeados |
| **No hay tests de API** | 🔴 Alta | Los routers tRPC no tienen tests de integración |
| **Tests E2E limitados** | 🟡 Media | Solo 5 archivos de spec |
| **Sin tests de carga** | 🟡 Media | No hay k6 o artillery |
| **Sin tests de contrato** | 🟡 Media | No se validan cambios de API |

#### 📊 Cobertura Actual (estimada)

```
Servicios: ~40% (los principales)
Routers:   ~5%  (muy bajo)
Core:      ~20% (parcial)
Client:    ~0%  (sin tests unitarios)
```

#### 📋 Acciones Requeridas

- [ ] **CRÍTICO:** Agregar tests de integración para routers críticos (auth, leads, chat)
- [ ] **CRÍTICO:** Implementar tests de happy path para flujos principales
- [ ] Agregar tests de carga para endpoints críticos
- [ ] Implementar tests de contrato tRPC
- [ ] Objetivo: 70%+ cobertura antes de producción

---

## 5. 🔄 CI/CD Y AUTOMATIZACIÓN

### Calificación: 8/10 ⭐⭐⭐⭐☆

#### ✅ Fortalezas

| Workflow | Descripción | Estado |
|----------|-------------|--------|
| **CI/CD Pipeline** | Test → Build → Deploy automático | ✅ Implementado |
| **Secret Scan** | Gitleaks en PR y push | ✅ Activo |
| **Type Checking** | `tsc --noEmit` en CI | ✅ Configurado |
| **Security Audit** | `pnpm audit` en pipeline | ✅ Activo |
| **Real DB Parity** | Tests contra MySQL real | ✅ Implementado |
| **Auto-deploy VPS** | SSH deploy en merge a main | ✅ Configurado |

#### ⚠️ Debilidades

| Problema | Severidad | Descripción |
|----------|-----------|-------------|
| Sin staging environment | 🟡 Media | Deploy directo a producción |
| Sin rollback automático | 🟡 Media | No hay verificación post-deploy que detenga |
| Sin notificaciones | 🟢 Baja | No hay Slack/Teams notifications |
| Sin smoke tests post-deploy | 🟡 Media | Solo health check básico |

#### 📋 Acciones Recomendadas

- [ ] Implementar environment de staging
- [ ] Agregar smoke tests post-deployment
- [ ] Configurar rollback automático si health checks fallan
- [ ] Agregar notificaciones de deploy

---

## 6. 🐳 DOCKER Y DEPLOYMENT

### Calificación: 9/10 ⭐⭐⭐⭐⭐

#### ✅ Fortalezas

| Aspecto | Implementación |
|---------|----------------|
| **Multi-stage build** | Dockerfile optimizado (base → deps → build → runner) |
| **docker-compose** | Desarrollo y producción separados |
| **Health checks** | Configurados en app y MySQL |
| **Caddy proxy** | Reverse proxy con HTTPS automático |
| **Scripts de deploy** | 15+ scripts para diferentes escenarios |
| **Volumes persistentes** | Datos de MySQL, uploads, sesiones |
| **Non-root user** | Seguridad en contenedores |
| **Resource limits** | Logging limits configurados |

#### 📁 Scripts de Deployment Disponibles

```
deploy/
├── docker-entrypoint.sh           # Entrypoint con migraciones
├── setup.sh, setup-https.sh       # Setup inicial
├── deploy.sh, quick-deploy.sh     # Deploy automatizado
├── update.sh, update_vps.sh       # Actualizaciones
├── backup_restore_smoke.sh        # Backup/Restore
├── check_vps_health.sh            # Health checks
└── Caddyfile.prod, nginx.example.conf  # Configs proxy
```

#### ⚠️ Debilidades

| Problema | Severidad | Descripción |
|----------|-----------|-------------|
| Sin orquestación Kubernetes | 🟢 Baja | Docker Compose es suficiente para escala inicial |
| Sin auto-scaling | 🟢 Baja | Configuración manual de réplicas |

---

## 7. 📝 DOCUMENTACIÓN

### Calificación: 7/10 ⭐⭐⭐⭐☆

#### ✅ Documentación Existente

| Archivo | Contenido | Estado |
|---------|-----------|--------|
| `README.md` | Overview y quick start | ✅ Bueno |
| `INICIAR-AQUI.md` | Guía de inicio en español | ✅ Completo |
| `TROUBLESHOOTING.md` | Solución de problemas | ✅ Útil |
| `SETUP.md` | Guía de configuración | ✅ Detallado |
| `deployment_guide.md` | Guía de despliegue | ✅ Completo |
| `deploy/GUIA_DESPLIEGUE.md` | Guía en español | ✅ Detallado |
| `server/routers/README.md` | Documentación de API | ⚠️ Básico |
| `server/services/README.md` | Documentación de servicios | ⚠️ Básico |

#### ⚠️ Falta de Documentación

| Elemento | Prioridad | Descripción |
|----------|-----------|-------------|
| API Documentation | 🔴 Alta | No hay OpenAPI/Swagger para tRPC |
| Architecture Decision Records | 🟡 Media | No hay ADRs |
| Runbooks de operaciones | 🟡 Media | Procedimientos de troubleshooting en prod |
| Onboarding de desarrolladores | 🟢 Baja | Guía para nuevos devs |

#### 📋 Acciones Recomendadas

- [ ] Generar documentación de API tRPC (usando trpc-openapi)
- [ ] Crear runbooks para incidentes comunes
- [ ] Documentar decisiones arquitectónicas (ADRs)

---

## 8. 💻 CÓDIGO Y TYPESCRIPT

### Calificación: 5.5/10 ⭐⭐⭐☆☆

#### ✅ Fortalezas

| Aspecto | Estado |
|---------|--------|
| TypeScript estricto | `strict: true` en tsconfig |
| Path aliases | `@/*` y `@shared/*` configurados |
| ESLint/Prettier | Configurado con husky y lint-staged |
| Zod validation | Schemas de validación en inputs |
| Error handling | Uso de `safeError` y logging con Pino |

#### ℹ️ Errores Históricos (resueltos)

```typescript
// Referencia histórica (corregida en el código actual)

1. client/src/components/notes-tasks/LeadReminders.tsx(91,5)
   error TS2304: Cannot find name 'useEffect'.
   → Falta import de React

2. client/src/components/tags/TagSelector.tsx(149,68)
   error TS2345: Argument of type '{ id?: number; ... }' is not assignable...
   → Inconsistencia de tipos en Tag

3. client/src/main.tsx(76,7)
   error TS2322: Type 'typeof SuperJSON' is not assignable...
   → Problema de compatibilidad con tRPC transformer
```

#### ⚠️ Problemas de Código

| Problema | Severidad | Ubicación |
|----------|-----------|-----------|
| `as any` frecuentes | 🟡 Media | Múltiples archivos |
| `// @ts-ignore` | 🟢 Baja | Algunos casos justificados |
| Variables no usadas | 🟢 Baja | En desestructuración |
| Funciones largas | 🟡 Media | Algunos routers >200 líneas |

#### 📋 Estado Actual

- [x] Errores de TypeScript corregidos
- [x] Compatibilidad de SuperJSON/tRPC validada en build/check actuales
- [ ] Ejecutar `npm run check` y corregir todos los errores
- [ ] Reducir uso de `as any` gradualmente

---

## 9. 🔧 CONFIGURACIÓN DE ENTORNOS

### Calificación: 8/10 ⭐⭐⭐⭐☆

#### ✅ Fortalezas

| Aspecto | Implementación |
|---------|----------------|
| `.env.example` | Template completo de variables |
| `.env.production.example` | Config específica de producción |
| Validación de env | `env-validation.ts` con reglas estrictas |
| Secrets scanning | Gitleaks configurado |
| Separación de config | Dev/prod claramente separados |

#### ⚠️ Variables Críticas para Producción

```bash
# Seguridad
JWT_SECRET=<64+ caracteres aleatorios>
DATA_ENCRYPTION_KEY=<32+ caracteres aleatorios>
COOKIE_SECRET=<64+ caracteres aleatorios>

# Feature Flags (DEBEN estar en 0 en producción)
ALLOW_DEV_LOGIN=0
ENABLE_DEV_BYPASS=0
VITE_DEV_BYPASS_AUTH=0

# Base de datos
DATABASE_URL=mysql://<user>:<pass>@mysql:3306/chin_crm
REDIS_URL=redis://redis:6379
REQUIRE_REDIS_IN_PROD=1

# Infraestructura
NODE_ENV=production
TRUST_PROXY=1
```

#### 📋 Checklist de Variables para Producción

- [ ] Todas las variables de `.env.production.example` configuradas
- [ ] Secrets generados con `openssl rand -base64 64`
- [ ] Feature flags de desarrollo deshabilitados
- [ ] URLs apuntando a dominio de producción
- [ ] Redis configurado y accesible

---

## 10. 📈 MONITOREO Y OBSERVABILIDAD

### Calificación: 6/10 ⭐⭐⭐☆☆

#### ✅ Fortalezas

| Herramienta | Uso |
|-------------|-----|
| **Sentry** | Error tracking configurado |
| **Pino Logger** | Logging estructurado con niveles |
| **Health checks** | Endpoints `/api/health` y `/readyz` |

#### ⚠️ Debilidades

| Falta | Severidad | Impacto |
|-------|-----------|---------|
| **APM/Tracing** | 🟡 Media | No hay distributed tracing |
| **Métricas (Prometheus)** | 🟡 Media | No hay métricas expuestas |
| **Dashboards** | 🟡 Media | No hay Grafana/Datadog |
| **Alertas** | 🔴 Alta | No hay alertas configuradas |
| **Log aggregation** | 🟡 Media | Logs solo en archivos locales |

#### 📋 Acciones Recomendadas

- [ ] Implementar Prometheus metrics endpoint
- [ ] Configurar Grafana o Datadog
- [ ] Agregar alertas para errores críticos (PagerDuty/Opsgenie)
- [ ] Considerar ELK stack o Loki para logs

---

## 🚀 PLAN DE ACCIÓN PARA PRODUCCIÓN 100%

### Fase 1: Crítico (Bloqueante para Producción) - Semana 1

| # | Tarea | Responsable | Estado |
|---|-------|-------------|--------|
| 1.1 | Corregir errores de TypeScript | Dev Team | ⬜ |
| 1.2 | Resolver problema SuperJSON/tRPC | Dev Team | ⬜ |
| 1.3 | Validar variables de entorno en prod | DevOps | ⬜ |
| 1.4 | Habilitar HSTS o verificar HTTPS | DevOps | ⬜ |
| 1.5 | Generar secrets seguros | DevOps | ⬜ |
| 1.6 | Deshabilitar feature flags de dev | DevOps | ⬜ |

### Fase 2: Importante (Alta Prioridad) - Semana 2-3

| # | Tarea | Impacto |
|---|-------|---------|
| 2.1 | Agregar tests de integración para routers críticos | Calidad |
| 2.2 | Implementar alertas de monitoreo | Operaciones |
| 2.3 | Configurar backup automático de base de datos | Datos |
| 2.4 | Implementar rate limiting más estricto | Seguridad |
| 2.5 | Agregar validación de archivos subidos | Seguridad |

### Fase 3: Mejoras (Media Prioridad) - Mes 2

| # | Tarea | Impacto |
|-------|-------|---------|
| 3.1 | Implementar staging environment | Calidad |
| 3.2 | Agregar tests de carga | Rendimiento |
| 3.3 | Documentar API con OpenAPI | Desarrollo |
| 3.4 | Implementar particionamiento de mensajes | Escalabilidad |
| 3.5 | Agregar métricas Prometheus | Observabilidad |

### Fase 4: Optimización (Baja Prioridad) - Mes 3+

| # | Tarea | Impacto |
|-------|-------|---------|
| 4.1 | Kubernetes migration | Escalabilidad |
| 4.2 | CDN para assets estáticos | Rendimiento |
| 4.3 | Caché distribuida con Redis | Rendimiento |
| 4.4 | Implementar circuit breakers | Resiliencia |

---

## 📋 CHECKLIST FINAL DE PRODUCCIÓN

### Pre-Deploy

- [ ] Todos los errores TypeScript corregidos (`npm run check` pasa)
- [ ] Tests pasando (`npm test` sin fallos)
- [ ] Build exitoso (`npm run build`)
- [ ] Variables de entorno validadas (`npm run validate:prod-config`)
- [ ] Secrets generados y seguros (32+ chars, aleatorios)
- [ ] Base de datos migrada (`npm run db:migrate`)

### Deploy

- [ ] Docker images construidas sin errores
- [ ] Contenedores inician correctamente
- [ ] Health checks responden OK
- [ ] SSL/HTTPS funcionando
- [ ] Webhooks configurados y probados

### Post-Deploy

- [ ] Login funciona correctamente
- [ ] Flujo de leads completo operativo
- [ ] WhatsApp envía/recibe mensajes
- [ ] Dashboard carga datos correctamente
- [ ] No hay errores en logs (Sentry/logs)

---

## 📝 CONCLUSIONES

### Estado Actual

El **CRM PRO V4** es un sistema **robusto y bien arquitectado** con características enterprise-grade:

- ✅ Multi-tenancy completo
- ✅ Seguridad sólida (RBAC, PII encryption, audit logs)
- ✅ Infraestructura Docker lista para producción
- ✅ CI/CD automatizado
- ✅ Base de datos bien diseñada con 50+ tablas

### Riesgos para Producción

| Riesgo | Probabilidad | Impacto | Mitigación |
|--------|--------------|---------|------------|
| Errores TypeScript en runtime | Media | Alto | Corregir antes de deploy |
| Falta de tests de integración | Alta | Medio | Agregar tests críticos |
| Sin monitoreo de alertas | Alta | Alto | Configurar alerts ASAP |
| HSTS deshabilitado | Baja | Medio | Verificar HTTPS forzado |

### Recomendación

🔶 **APROBADO CONDICIONALMENTE**

El sistema puede desplegarse en producción **después de completar la Fase 1** (corrección de errores TypeScript y validación de configuración). Las Fases 2-4 deben ejecutarse en las semanas posteriores al lanzamiento.

**Timeline sugerido:**
- **Semana 1:** Fase 1 (Bloqueantes)
- **Semana 2:** Deploy inicial a producción
- **Semanas 3-4:** Fase 2 (Importante)
- **Mes 2:** Fase 3 (Mejoras)
- **Mes 3+:** Fase 4 (Optimización)

---

## 📚 ANEXOS

### A. Comandos Útiles

```bash
# Verificar estado
npm run check
npm test
npm run validate:prod-config

# Construir para producción
npm run build

# Deploy con Docker
docker compose -f docker-compose.prod.yml up -d --build

# Backup de base de datos
docker exec mysql-crm mysqldump -u root -p chin_crm > backup.sql
```

### B. Contactos y Recursos

- Documentación: `/docs` y `README.md`
- Troubleshooting: `TROUBLESHOOTING.md`
- Guía de despliegue: `deployment_guide.md`

### C. Métricas del Proyecto

| Métrica | Valor |
|---------|-------|
| Líneas de código (TypeScript) | ~90,945 archivos |
| Tablas de base de datos | 50+ |
| Routers tRPC | 30+ |
| Servicios | 40+ |
| Tests | 15+ suites |
| Docker Compose services | 4 (app, mysql, redis, caddy) |

### D. Plan UX/UI Ejecutable (Sprint de 2 semanas)

#### 1) Pantalla objetivo: Dashboard principal

**Objetivo UX:** reducir saturación y acelerar la primera acción útil del usuario en menos de 10 segundos.

**Layout propuesto (desktop):**
- Fila 1: 4 KPIs primarios (`Leads nuevos hoy`, `Conversaciones abiertas`, `Citas de hoy`, `Tareas vencidas`).
- Fila 2 (izquierda 70%): `Actividad reciente` + `Embudo resumido`.
- Fila 2 (derecha 30%): `Atajos rápidos` (Crear lead, Agendar cita, Enviar campaña, Ver inbox).
- Fila 3: `Métricas secundarias` en bloque colapsable (oculto por defecto).

**Estados obligatorios por widget:**
- `loading`: skeleton consistente.
- `empty`: mensaje accionable + CTA.
- `error`: mensaje claro + botón `Reintentar`.

#### 2) Pantalla objetivo: Leads (lista operativa)

**Objetivo UX:** mejorar velocidad de gestión sin sobrecargar la tabla.

**Configuración por defecto:**
- Columnas visibles: `Nombre`, `Estado`, `Asignado`, `Último contacto`, `Acciones`.
- Filtros rápidos: `Hoy`, `Sin seguimiento`, `Calientes`, `No contactados 7d`.
- Detalle completo del lead en panel lateral (no en columnas extra).

**Acciones principales visibles:**
- `Crear lead`, `Cambiar estado`, `Asignar`, `Enviar mensaje`.
- Acciones secundarias dentro de menú `Más`.

#### 3) Consistencia visual y de interacción

- Unificar acción primaria por pantalla (mismo color, tamaño y ubicación).
- Normalizar microcopys de feedback:
   - Éxito: `Guardado correctamente`.
   - Error recoverable: `No se pudo completar la acción. Intenta de nuevo.`
   - Permisos: `No tienes permisos para esta acción.`
- Mantener jerarquía de títulos: `H1` página, `H2` secciones, `H3` tarjetas.

#### 4) Criterios de aceptación (Definition of Done UX)

- Tiempo a primera acción útil en Dashboard: <= 10 segundos (usuario recurrente).
- Reducción de scroll inicial en Dashboard: >= 30% vs diseño actual.
- Leads: no más de 5 columnas por defecto y panel lateral activo para detalle.
- Todos los módulos críticos con estados `loading/empty/error` consistentes.
- Validación manual responsive en 3 breakpoints: `mobile`, `tablet`, `desktop`.

#### 5) Validación para equipo de desarrollo (DX)

- Crear checklist UI por PR: jerarquía visual, microcopy, estados y permisos.
- Evitar lógica de permisos en componentes sueltos; centralizar en capa de acceso actual.
- Reusar componentes de `client/src/components/ui` para mantener design system.
- Todo cambio UX en vistas críticas debe incluir al menos 1 test de integración de flujo.

---

*Informe generado automáticamente el 26 de Febrero de 2026*
*Auditoría realizada por: Análisis de Código Automatizado*
