# Instrucciones para Replicar el Dashboard en Metabase

Este documento describe paso a paso cómo crear el dashboard de Emails Críticos en una instancia de Metabase conectada a la base de datos de producción de ImagineCRM.

## Requisitos Previos

Antes de comenzar, asegúrate de tener:
1. Una instancia de Metabase activa (versión 0.46 o superior). Puede ser self-hosted o en la nube en metabase.com.
2. Acceso de administrador a Metabase.
3. Las credenciales de la base de datos MySQL de producción de ImagineCRM.

## Paso 1: Conectar la Base de Datos

1. Inicia sesión en Metabase como administrador.
2. Ve a Admin → Databases → Add a database.
3. Selecciona MySQL como tipo de base de datos.
4. Completa los campos con las credenciales de producción:
   - Display Name: ImagineCRM Producción
   - Host, Port, Database, Username, Password: según tu configuración de DATABASE_URL.
5. Haz clic en Save y espera a que Metabase sincronice el esquema.

## Paso 2: Crear las 5 Preguntas (Queries)

Cada tarjeta del dashboard corresponde a una "Pregunta" en Metabase. Ve a New → Question → Native query para cada una.

### Pregunta 1: Resumen Ejecutivo (KPIs)
```sql
SELECT
    COUNT(*) AS total_enviados,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS exitosos,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS fallidos,
    CONCAT(ROUND((SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / COUNT(*)) * 100, 1), '%') AS tasa_exito,
    SUM(CASE WHEN emailType = 'PAYMENT_FAILED'   THEN 1 ELSE 0 END) AS pago_fallido,
    SUM(CASE WHEN emailType = 'TRIAL_EXPIRED'    THEN 1 ELSE 0 END) AS trial_expirado,
    SUM(CASE WHEN emailType = 'SUBSCRIPTION_EXP' THEN 1 ELSE 0 END) AS suscripcion_expirada
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY);
```
*Usa el parámetro `{{periodo_dias}}` para que el dashboard sea filtrable por período.*

### Pregunta 2: Emails por Día (Gráfico de Barras Apiladas)
```sql
SELECT
    DATE(sentAt) AS dia,
    emailType AS tipo,
    COUNT(*) AS cantidad
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY DATE(sentAt), emailType
ORDER BY dia ASC;
```
*En Metabase, selecciona Bar chart, eje X = dia, eje Y = cantidad, serie = tipo, activa Stacked.*

### Pregunta 3: Distribución por Tipo (Gráfico de Dona)
```sql
SELECT
    CASE emailType
        WHEN 'PAYMENT_FAILED'   THEN 'Pago Fallido'
        WHEN 'TRIAL_EXPIRED'    THEN 'Trial Expirado'
        WHEN 'SUBSCRIPTION_EXP' THEN 'Suscripción Expirada'
    END AS tipo,
    COUNT(*) AS cantidad
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY emailType;
```
*En Metabase, selecciona Pie chart.*

### Pregunta 4: Top Tenants en Riesgo
```sql
SELECT
    t.name AS tenant,
    COUNT(log.id) AS emails_recibidos
FROM critical_email_log log
JOIN tenants t ON log.tenantId = t.id
WHERE log.sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY t.id, t.name
ORDER BY emails_recibidos DESC
LIMIT 10;
```
*En Metabase, selecciona Row chart (barras horizontales).*

### Pregunta 5: Log Detallado (Tabla)
```sql
SELECT
    log.sentAt AS fecha,
    t.name AS tenant,
    log.recipientEmail AS email,
    CASE log.emailType
        WHEN 'PAYMENT_FAILED'   THEN 'Pago Fallido'
        WHEN 'TRIAL_EXPIRED'    THEN 'Trial Expirado'
        WHEN 'SUBSCRIPTION_EXP' THEN 'Suscripción Expirada'
    END AS tipo,
    CASE WHEN log.success = 1 THEN 'Exitoso' ELSE 'Fallido' END AS estado,
    log.errorMessage AS error
FROM critical_email_log log
JOIN tenants t ON log.tenantId = t.id
WHERE log.sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
ORDER BY log.sentAt DESC;
```
*En Metabase, selecciona Table. Aplica formato condicional: columna estado con color verde para "Exitoso" y rojo para "Fallido".*

## Paso 3: Crear el Dashboard

1. Ve a New → Dashboard y nómbralo **Emails Críticos — ImagineCRM**.
2. Haz clic en Add a question y agrega las 5 preguntas creadas.
3. Organiza las tarjetas en el siguiente layout:
   - **Fila 1:** Pregunta 1 (KPIs) — ancho completo
   - **Fila 2:** Pregunta 2 (Barras por día) — 2/3 del ancho · Pregunta 3 (Dona) — 1/3
   - **Fila 3:** Pregunta 4 (Top Tenants) — 1/2 · espacio para métricas adicionales
   - **Fila 4:** Pregunta 5 (Tabla de log) — ancho completo

## Paso 4: Agregar el Filtro de Período

1. En el dashboard, haz clic en el ícono de filtro (embudo) en la barra superior.
2. Selecciona **Number filter** y nómbralo **Período (días)**.
3. Conecta este filtro al parámetro `{{periodo_dias}}` de cada pregunta.
4. Establece el valor por defecto en 7.

## Paso 5: Configurar Alertas Automáticas

1. Abre la Pregunta 1 (Resumen Ejecutivo).
2. Haz clic en el ícono de campana (🔔) → Set up an alert.
3. Configura la alerta:
   - Condición: fallidos es mayor que 5
   - Frecuencia: Diaria
   - Canal: Email o Slack (requiere configurar el canal en Admin → Notifications)
4. Repite el proceso para alertar si tasa_exito cae por debajo del 95%.

## Paso 6: Compartir el Dashboard

- **Enlace interno:** Comparte la URL del dashboard con el equipo de operaciones.
- **Embed público:** En la configuración del dashboard, activa "Public sharing" para obtener un enlace embebible en otras herramientas internas.
- **Suscripción por email:** Haz clic en "Subscribe" para recibir el dashboard por email cada lunes a las 9:00 AM automáticamente.
