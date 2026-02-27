# Go-Live Checklist (15 minutos) — ImagineCRM

Objetivo: validar que el despliegue a producción quedó sano, seguro y operable sin herramientas pagas.

## 0) Datos mínimos (1 min)
Confirma estas variables en tu `.env` de producción:
- `APP_DOMAIN`
- `ACME_EMAIL`
- `JWT_SECRET`
- `COOKIE_SECRET`
- `DATA_ENCRYPTION_KEY`
- `REDIS_URL`
- `REQUIRE_REDIS_IN_PROD=1`
- `ALLOW_DEV_LOGIN=0`
- `VITE_DEV_BYPASS_AUTH=0`

---

## 1) Pre-deploy rápido (3 min)
Desde el servidor/proyecto:

```bash
pnpm validate:prod-config
```

Debe terminar sin errores.

Si usas CI en GitHub, confirma último run verde en:
- Build/Test
- Real DB Parity
- Backup Restore Smoke

---

## 2) Deploy (3 min)

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --build
```

Revisa estado:

```bash
docker compose -f docker-compose.prod.yml ps
```

Todos los servicios (`app`, `mysql`, `redis`, `caddy`) deben estar `Up`/`healthy`.

---

## 3) Smoke técnico post-deploy (4 min)

### 3.1 Salud API
```bash
curl -fsS http://localhost:3000/api/health
curl -fsS http://localhost:3000/readyz
```

### 3.2 Proxy y TLS
```bash
curl -I https://TU_DOMINIO
```
Validar:
- Respuesta `200`/`301`/`302`
- Certificado TLS válido
- Header `strict-transport-security` presente

### 3.3 Logs sin errores críticos
```bash
docker compose -f docker-compose.prod.yml logs --tail=200 app
```
Validar que no aparezcan errores repetidos de:
- `EnvValidation`
- `OAuthSession Redis error`
- fallos de conexión DB

---

## 4) Smoke funcional de negocio (3 min)

1. Login (owner/admin) exitoso
2. Crear y editar un lead/contacto
3. Enviar un mensaje desde módulo de conversaciones (si aplica)
4. Crear una tarea/recordatorio
5. Confirmar que datos persisten tras refrescar

---

## 5) Criterio de aprobación
Marca release como **OK** solo si:
- Health y readyz responden OK
- UI carga por HTTPS sin errores severos
- Login y operación crítica funcionan
- No hay errores críticos en logs

---

## 6) Rollback inmediato (si falla)

```bash
docker compose -f docker-compose.prod.yml down
git checkout <tag_o_commit_estable>
docker compose -f docker-compose.prod.yml up -d --build
```

Luego repetir secciones 3 y 4.

---

## 7) Evidencia operativa (1 min)
Guardar en bitácora:
- Fecha/hora de despliegue
- Commit/tag desplegado
- Resultado health/readyz
- Captura de `docker compose ps`
- Responsable del release

Sugerencia: registrar en `ops/audit/YYYY-MM/README.md`.
