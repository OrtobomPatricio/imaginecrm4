-- ============================================================
-- ImagineCRM — Script de Consulta de Licencias y Tenants
-- Versión: 1.0 | Fecha: 2026-02-25
-- Ejecutar como: superadmin con acceso directo a la base de datos
-- ============================================================

-- ────────────────────────────────────────────────────────────
-- CONSULTA 1: Vista completa de todos los tenants y licencias
-- ────────────────────────────────────────────────────────────
SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.slug                                  AS subdominio,
    t.plan                                  AS plan_tenant,
    t.status                                AS estado_tenant,
    t.stripeCustomerId                      AS stripe_customer_id,
    t.createdAt                             AS fecha_registro,

    -- Licencia
    l.id                                    AS license_id,
    l.key                                   AS license_key,
    l.status                                AS estado_licencia,
    l.plan                                  AS plan_licencia,
    l.trialEndsAt                           AS trial_vence,
    l.expiresAt                             AS suscripcion_vence,
    l.maxUsers                              AS max_usuarios,
    l.maxWhatsappNumbers                    AS max_numeros_wa,
    l.maxMessagesPerMonth                   AS max_mensajes_mes,
    JSON_UNQUOTE(JSON_EXTRACT(l.metadata, '$.stripeSubscriptionId'))
                                            AS stripe_subscription_id,
    JSON_UNQUOTE(JSON_EXTRACT(l.metadata, '$.paymentProvider'))
                                            AS proveedor_pago,

    -- Días restantes de trial (si aplica)
    CASE
        WHEN l.status = 'trial' AND l.trialEndsAt IS NOT NULL
            THEN GREATEST(0, DATEDIFF(l.trialEndsAt, NOW()))
        ELSE NULL
    END                                     AS dias_trial_restantes,

    -- Días hasta vencimiento de suscripción (si aplica)
    CASE
        WHEN l.status = 'active' AND l.expiresAt IS NOT NULL
            THEN GREATEST(0, DATEDIFF(l.expiresAt, NOW()))
        ELSE NULL
    END                                     AS dias_suscripcion_restantes,

    -- Uso actual
    (SELECT COUNT(*) FROM users u
     WHERE u.tenantId = t.id AND u.isActive = 1)
                                            AS usuarios_activos,
    (SELECT COUNT(*) FROM whatsapp_numbers wn
     WHERE wn.tenantId = t.id)             AS numeros_wa_registrados,

    -- Mensajes del mes actual
    (SELECT COALESCE(ut.messagesSent, 0) + COALESCE(ut.messagesReceived, 0)
     FROM usage_tracking ut
     WHERE ut.tenantId = t.id
       AND ut.year = YEAR(NOW())
       AND ut.month = MONTH(NOW())
     LIMIT 1)                              AS mensajes_mes_actual,

    -- Owner del tenant
    (SELECT u2.email FROM users u2
     WHERE u2.tenantId = t.id AND u2.role = 'owner'
     LIMIT 1)                              AS email_owner,

    (SELECT u2.name FROM users u2
     WHERE u2.tenantId = t.id AND u2.role = 'owner'
     LIMIT 1)                              AS nombre_owner,

    -- Alerta de estado
    CASE
        WHEN t.status = 'suspended'                              THEN '🔴 SUSPENDIDO'
        WHEN t.status = 'canceled'                               THEN '⚫ CANCELADO'
        WHEN l.status = 'expired'                                THEN '🟠 LICENCIA EXPIRADA'
        WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) <= 0
                                                                 THEN '🔴 TRIAL VENCIDO'
        WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) <= 3
                                                                 THEN '🟡 TRIAL VENCE PRONTO'
        WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) > 3
                                                                 THEN '🟢 TRIAL ACTIVO'
        WHEN l.status = 'active'                                 THEN '✅ ACTIVO'
        WHEN l.status = 'canceled'                               THEN '⚫ LICENCIA CANCELADA'
        ELSE '❓ DESCONOCIDO'
    END                                     AS alerta

FROM tenants t
LEFT JOIN license l ON l.tenantId = t.id
ORDER BY
    FIELD(t.status, 'suspended', 'canceled', 'active') ASC,
    FIELD(l.status, 'expired', 'canceled', 'trial', 'active') ASC,
    t.createdAt DESC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 2: Resumen ejecutivo por estado
-- ────────────────────────────────────────────────────────────
SELECT
    t.status                                AS estado_tenant,
    l.status                                AS estado_licencia,
    l.plan                                  AS plan,
    COUNT(*)                                AS cantidad,
    SUM(CASE WHEN l.status = 'trial' AND DATEDIFF(l.trialEndsAt, NOW()) <= 3
             THEN 1 ELSE 0 END)            AS trials_vencen_3_dias
FROM tenants t
LEFT JOIN license l ON l.tenantId = t.id
GROUP BY t.status, l.status, l.plan
ORDER BY cantidad DESC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 3: Tenants en riesgo (trial próximo a vencer o ya vencido)
-- ────────────────────────────────────────────────────────────
SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.slug                                  AS subdominio,
    t.status                                AS estado_tenant,
    l.status                                AS estado_licencia,
    l.trialEndsAt                           AS trial_vence,
    DATEDIFF(l.trialEndsAt, NOW())          AS dias_restantes,
    (SELECT u.email FROM users u
     WHERE u.tenantId = t.id AND u.role = 'owner'
     LIMIT 1)                              AS email_owner,
    (SELECT COUNT(*) FROM users u
     WHERE u.tenantId = t.id AND u.isActive = 1)
                                            AS usuarios_activos
FROM tenants t
INNER JOIN license l ON l.tenantId = t.id
WHERE l.status = 'trial'
  AND l.trialEndsAt IS NOT NULL
  AND DATEDIFF(l.trialEndsAt, NOW()) <= 7  -- Vence en 7 días o ya venció
ORDER BY l.trialEndsAt ASC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 4: Tenants suspendidos (requieren acción)
-- ────────────────────────────────────────────────────────────
SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.slug                                  AS subdominio,
    t.stripeCustomerId                      AS stripe_customer_id,
    l.status                                AS estado_licencia,
    l.trialEndsAt                           AS trial_vencio,
    l.expiresAt                             AS suscripcion_vencio,
    t.updatedAt                             AS fecha_suspension,
    (SELECT u.email FROM users u
     WHERE u.tenantId = t.id AND u.role = 'owner'
     LIMIT 1)                              AS email_owner
FROM tenants t
LEFT JOIN license l ON l.tenantId = t.id
WHERE t.status = 'suspended'
ORDER BY t.updatedAt DESC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 5: Uso mensual por tenant (mes actual)
-- ────────────────────────────────────────────────────────────
SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.plan                                  AS plan,
    l.maxMessagesPerMonth                   AS limite_mensajes,
    COALESCE(ut.messagesSent, 0)            AS mensajes_enviados,
    COALESCE(ut.messagesReceived, 0)        AS mensajes_recibidos,
    COALESCE(ut.messagesSent, 0) + COALESCE(ut.messagesReceived, 0)
                                            AS total_mensajes,
    ROUND(
        (COALESCE(ut.messagesSent, 0) / NULLIF(l.maxMessagesPerMonth, 0)) * 100, 1
    )                                       AS pct_uso_mensajes,
    COALESCE(ut.activeUsers, 0)             AS usuarios_activos_mes,
    l.maxUsers                              AS limite_usuarios
FROM tenants t
LEFT JOIN license l ON l.tenantId = t.id
LEFT JOIN usage_tracking ut
    ON ut.tenantId = t.id
    AND ut.year = YEAR(NOW())
    AND ut.month = MONTH(NOW())
WHERE t.status = 'active'
ORDER BY total_mensajes DESC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 6: Historial de uso últimos 6 meses (todos los tenants)
-- ────────────────────────────────────────────────────────────
SELECT
    t.name                                  AS empresa,
    ut.year                                 AS año,
    ut.month                                AS mes,
    ut.messagesSent                         AS mensajes_enviados,
    ut.messagesReceived                     AS mensajes_recibidos,
    ut.activeUsers                          AS usuarios_activos,
    ut.activeWhatsappNumbers                AS numeros_wa_activos
FROM usage_tracking ut
INNER JOIN tenants t ON t.id = ut.tenantId
WHERE (ut.year = YEAR(NOW()) AND ut.month >= MONTH(NOW()) - 5)
   OR (ut.year = YEAR(NOW()) - 1 AND ut.month > 12 - (6 - MONTH(NOW())))
ORDER BY t.name ASC, ut.year DESC, ut.month DESC;


-- ────────────────────────────────────────────────────────────
-- CONSULTA 7: Tenants con suscripción Stripe activa
-- ────────────────────────────────────────────────────────────
SELECT
    t.id                                    AS tenant_id,
    t.name                                  AS empresa,
    t.plan                                  AS plan,
    t.stripeCustomerId                      AS stripe_customer_id,
    JSON_UNQUOTE(JSON_EXTRACT(l.metadata, '$.stripeSubscriptionId'))
                                            AS stripe_subscription_id,
    l.status                                AS estado_licencia,
    l.expiresAt                             AS vence,
    (SELECT u.email FROM users u
     WHERE u.tenantId = t.id AND u.role = 'owner'
     LIMIT 1)                              AS email_owner
FROM tenants t
INNER JOIN license l ON l.tenantId = t.id
WHERE t.stripeCustomerId IS NOT NULL
  AND l.status = 'active'
ORDER BY t.name ASC;
