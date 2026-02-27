-- ============================================================
-- ImagineCRM — Consulta Principal: Tenants en Riesgo Activo (No Suspendidos)
-- Propósito: Identificar tenants con trial por vencer o alto uso de mensajes
-- ============================================================

SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.slug                                  AS subdominio,
    -- Nivel de Riesgo
    CASE
        WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) <= 3
                                                THEN '🟠 ALTO (Trial vence <= 3 días)'
        WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) BETWEEN 4 AND 7
                                                THEN '🟡 MEDIO (Trial vence en 4-7 días)'
        WHEN (ut.messagesSent / l.maxMessagesPerMonth) >= 0.9
                                                THEN '🔵 INFORMATIVO (>90% uso mensajes)'
        ELSE 'Bajo'
    END                                     AS nivel_de_riesgo,

    -- Detalles del Riesgo
    l.status                                AS estado_licencia,
    l.trialEndsAt                           AS trial_vence,
    DATEDIFF(l.trialEndsAt, NOW())          AS dias_restantes_trial,
    l.maxMessagesPerMonth                   AS limite_mensajes,
    ut.messagesSent                         AS mensajes_enviados_mes,
    ROUND((ut.messagesSent / l.maxMessagesPerMonth) * 100, 1)
                                            AS pct_uso_mensajes,

    -- Contacto
    (SELECT u.email FROM users u WHERE u.tenantId = t.id AND u.role = 'owner' LIMIT 1)
                                            AS email_owner,
    (SELECT u.name FROM users u WHERE u.tenantId = t.id AND u.role = 'owner' LIMIT 1)
                                            AS nombre_owner,
    (SELECT COUNT(*) FROM users u WHERE u.tenantId = t.id AND u.isActive = 1)
                                            AS usuarios_activos
FROM tenants t
JOIN license l ON l.tenantId = t.id
LEFT JOIN usage_tracking ut ON ut.tenantId = t.id AND ut.year = YEAR(NOW()) AND ut.month = MONTH(NOW())
WHERE
    t.status = 'active' -- Solo tenants activos, no los ya suspendidos
    AND (
        -- Criterio de Trial Próximo a Vencer
        (l.status = 'trial' AND l.trialEndsAt IS NOT NULL AND DATEDIFF(l.trialEndsAt, NOW()) <= 7)
        OR
        -- Criterio de Alto Uso de Mensajes
        (ut.messagesSent IS NOT NULL AND l.maxMessagesPerMonth > 0 AND (ut.messagesSent / l.maxMessagesPerMonth) >= 0.9)
    )
ORDER BY
    FIELD(nivel_de_riesgo, '🟠 ALTO (Trial vence <= 3 días)', '🟡 MEDIO (Trial vence en 4-7 días)', '🔵 INFORMATIVO (>90% uso mensajes)'),
    l.trialEndsAt ASC;
