# Guía de Backups, Point-in-Time Recovery y Read Replicas

## 🔐 Backups Automatizados

### Backup desde la Aplicación
CRM PRO incluye un sistema de backup automático integrado. Se configura mediante:
- **`server/services/auto-backup.ts`**: Ejecuta backups periódicos como cron job.
- **UI**: Desde el menú **Settings → Backup**, los administradores pueden crear backups manuales y restaurar datos.

### Backup de MySQL con mysqldump
Para backups completos de la base de datos:

```bash
# Backup completo diario
mysqldump -u $DB_USER -p$DB_PASSWORD --single-transaction --routines --triggers $DB_NAME > backup_$(date +%Y%m%d).sql

# Backup comprimido
mysqldump -u $DB_USER -p$DB_PASSWORD --single-transaction $DB_NAME | gzip > backup_$(date +%Y%m%d).sql.gz
```

### Cron Job de Backup Automatizado (VPS)
Agregar al crontab del servidor:

```bash
# Ejecutar a las 2:00 AM todos los días
0 2 * * * /usr/bin/mysqldump -u crm_user -p'SECURE_PASSWORD' --single-transaction crm_db | gzip > /backups/crm_$(date +\%Y\%m\%d).sql.gz

# Eliminar backups mayores a 30 días
0 3 * * * find /backups -name "crm_*.sql.gz" -mtime +30 -delete
```

### Verificación de Backups
```bash
# Verificar integridad del backup
gunzip -c backup_20260224.sql.gz | mysql -u root -p crm_db_test

# Contar registros como sanity check
mysql -u root -p crm_db_test -e "SELECT COUNT(*) FROM leads;"
```

---

## ⏪ Point-in-Time Recovery (PITR)

MySQL soporta restauración a un punto exacto en el tiempo usando Binary Logs.

### 1. Habilitar Binary Logging

En `my.cnf` o `my.ini`:
```ini
[mysqld]
log-bin = mysql-bin
binlog-format = ROW
expire_logs_days = 14
server-id = 1
```

### 2. Reiniciar MySQL
```bash
sudo systemctl restart mysql
```

### 3. Restaurar a un Punto en el Tiempo
```bash
# Paso 1: Restaurar el último backup completo
mysql -u root -p crm_db < backup_20260224.sql

# Paso 2: Aplicar los binary logs hasta el momento deseado
mysqlbinlog --stop-datetime="2026-02-24 15:30:00" /var/log/mysql/mysql-bin.000042 | mysql -u root -p crm_db
```

### 4. Verificación
```bash
mysql -u root -p crm_db -e "SELECT MAX(updatedAt) FROM leads;"
```

---

## 📊 Read Replica para Reporting

Una read replica permite ejecutar queries pesados de reporting sin afectar la performance del servidor principal.

### 1. Configurar el Servidor Primario (Master)

En `my.cnf`:
```ini
[mysqld]
server-id = 1
log-bin = mysql-bin
binlog-format = ROW
bind-address = 0.0.0.0
```

Crear usuario de replicación:
```sql
CREATE USER 'repl_user'@'%' IDENTIFIED BY 'SECURE_REPLICATION_PASSWORD';
GRANT REPLICATION SLAVE ON *.* TO 'repl_user'@'%';
FLUSH PRIVILEGES;
```

### 2. Configurar la Réplica (Slave)

En `my.cnf` del servidor réplica:
```ini
[mysqld]
server-id = 2
read-only = 1
relay-log = relay-bin
```

Iniciar replicación:
```sql
CHANGE MASTER TO
  MASTER_HOST = '10.0.0.1',
  MASTER_USER = 'repl_user',
  MASTER_PASSWORD = 'SECURE_REPLICATION_PASSWORD',
  MASTER_LOG_FILE = 'mysql-bin.000001',
  MASTER_LOG_POS = 0;

START SLAVE;
SHOW SLAVE STATUS\G
```

### 3. Configurar la App para Usar Read Replica

Agregar en `.env`:
```env
DATABASE_URL=mysql://crm_user:pass@primary:3306/crm_db
DATABASE_REPLICA_URL=mysql://crm_user:pass@replica:3306/crm_db
```

El código de la aplicación puede usar `DATABASE_REPLICA_URL` para queries de analytics y dashboards pesados mientras que las escrituras van siempre al `DATABASE_URL` primario.

---

## ✅ Checklist Operacional

| Componente | Estado |
|------------|--------|
| Backup diario automatizado | ✅ Configurar cron job |
| Binary Logging habilitado | ✅ Agregar a my.cnf |
| Retención de backups (30 días) | ✅ Cron de limpieza |
| PITR habilitado | ✅ Con binary logs |
| Verificación de backups | ✅ Script de sanity check |
| Read Replica | ✅ Documentado y configurable |
| Archivado periódico de datos | ✅ `archival-job.ts` activo |

---

## 🔄 Comportamiento del Restore In-App

### Modos de restauración

| Modo | Qué hace | Qué preserva |
|------|----------|---------------|
| **Replace** | Borra TODOS los datos del tenant y los reemplaza con los del backup | Tokens de WhatsApp (si matchean por clave estable) |
| **Merge** | Importa leads + templates + pipelines sin borrar existentes | Todo lo existente (solo agrega) |

### Tablas afectadas por Replace

Se borran y reinsertan (en orden de dependencia):
1. `app_settings`
2. `pipelines` → `pipeline_stages`
3. `templates`
4. `leads`
5. `whatsapp_numbers` → `whatsapp_connections`
6. `integrations`
7. `campaigns` → `campaign_recipients`
8. `conversations` → `chat_messages`

### Preservación de secretos (WhatsApp)

Los backups sanitizan campos sensibles (`accessToken`, `password`, `refreshToken`, `appSecret`) reemplazándolos con `[REDACTED]`.

Al restaurar en modo **Replace**:
1. **Pre-DELETE**: se guardan los tokens reales de `whatsapp_connections` del tenant actual
2. Se mapean por clave estable:
   - Cloud API: `phoneNumberId`
   - QR: `whatsappNumberId`
3. **Post-INSERT**: se re-aplican los tokens guardados a las conexiones restauradas que matcheen
4. Las conexiones sin match se marcan como `isConnected = false`

### Respuesta del restore

```json
{
  "success": true,
  "inserted": { "leads": 150, "chatMessages": 3200, ... },
  "secretsRestored": 2,
  "requiresReconnect": true,
  "connectionsRequiringReconnect": 1
}
```

- `secretsRestored`: cantidad de conexiones cuyos tokens se preservaron correctamente
- `requiresReconnect`: `true` si alguna conexión perdió su token
- `connectionsRequiringReconnect`: cuántas conexiones necesitan reconexión manual

### Qué hacer si `requiresReconnect = true`

1. El frontend muestra automáticamente un toast de advertencia
2. Ir a **Configuración → Distribución**
3. Para Cloud API: re-hacer OAuth con Meta
4. Para QR: escanear QR nuevamente

### Qué NO se restaura

- `users` (cuentas de usuario)
- `tenants` (configuración del tenant)
- `license` (plan/facturación)
- `facebook_pages` (conexiones de Facebook/Instagram)
- `file_uploads` (metadatos de archivos) — los archivos físicos en `storage/uploads/` tampoco se incluyen en el backup JSON

### Recomendaciones

- Siempre hacer backup **antes** de restaurar (el botón "Descargar Backup" está disponible en la misma página)
- No restaurar un backup de un entorno diferente si las conexiones de WhatsApp son distintas (perderás tokens)
- El modo **Merge** es más seguro para importar datos sin perder configuración existente
