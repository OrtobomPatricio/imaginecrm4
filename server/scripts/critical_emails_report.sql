-- ====================================================================
-- Script de Informe Semanal de Emails Críticos — ImagineCRM
-- Propósito: Extraer un resumen completo de todos los emails críticos
--            enviados en los últimos 7 días.
-- Ejecución: Ejecutar en cualquier cliente SQL (DBeaver, DataGrip,
--            MySQL Workbench) conectado a la base de datos de producción.
-- ====================================================================

-- Consulta 1: Resumen Ejecutivo
-- Muestra el total de emails enviados, la tasa de éxito y el desglose
-- por cada tipo de email crítico.

SELECT
    COUNT(*) AS total_emails_enviados,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS emails_exitosos,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS emails_fallidos,
    CONCAT(ROUND(
        (IFNULL(SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END), 0) / NULLIF(COUNT(*), 0)) * 100, 2
    ), 
    '%') AS tasa_de_exito,
    SUM(CASE WHEN emailType = 'PAYMENT_FAILED' THEN 1 ELSE 0 END) AS total_pago_fallido,
    SUM(CASE WHEN emailType = 'TRIAL_EXPIRED' THEN 1 ELSE 0 END) AS total_trial_expirado,
    SUM(CASE WHEN emailType = 'SUBSCRIPTION_EXP' THEN 1 ELSE 0 END) AS total_suscripcion_expirada
FROM
    critical_email_log
WHERE
    sentAt >= DATE_SUB(NOW(), INTERVAL 7 DAY);

-- ====================================================================

-- Consulta 2: Detalle de Envíos Fallidos
-- Lista todos los emails que no se pudieron enviar en la última semana,
-- junto con el mensaje de error, para diagnóstico y acción manual.

SELECT
    log.id,
    log.sentAt AS fecha_envio,
    t.name AS nombre_tenant,
    log.recipientEmail AS email_destinatario,
    log.emailType AS tipo_email,
    log.errorMessage AS mensaje_de_error
FROM
    critical_email_log log
JOIN
    tenants t ON log.tenantId = t.id
WHERE
    log.sentAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    AND log.success = 0
ORDER BY
    log.sentAt DESC;

-- ====================================================================

-- Consulta 3: Log Detallado Completo de la Última Semana
-- Muestra el registro completo de todos los emails enviados en los
-- últimos 7 días, tanto exitosos como fallidos.

SELECT
    log.id,
    log.sentAt AS fecha_envio,
    t.name AS nombre_tenant,
    log.recipientEmail AS email_destinatario,
    log.emailType AS tipo_email,
    CASE 
        WHEN log.success = 1 THEN '✅ Exitoso'
        ELSE '❌ Fallido'
    END AS estado_envio,
    log.errorMessage
FROM
    critical_email_log log
JOIN
    tenants t ON log.tenantId = t.id
WHERE
    log.sentAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
ORDER BY
    log.sentAt DESC;
