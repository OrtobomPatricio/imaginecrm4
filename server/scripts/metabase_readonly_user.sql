-- ══════════════════════════════════════════════════════════════════════════════
-- ImagineCRM — Usuario de solo lectura para Metabase
-- Ejecutar como root o usuario con privilegios de administración en MySQL
-- ══════════════════════════════════════════════════════════════════════════════

-- 1. Crear el usuario de solo lectura
--    Reemplaza 'contraseña_readonly_segura' con una contraseña fuerte
--    Reemplaza '%' con la IP del servidor de Metabase para mayor seguridad
CREATE USER IF NOT EXISTS 'metabase_readonly'@'%'
    IDENTIFIED BY 'contraseña_readonly_segura';

-- 2. Otorgar permisos de solo lectura sobre la base de datos de ImagineCRM
GRANT SELECT ON imaginecrm.* TO 'metabase_readonly'@'%';

-- 3. Aplicar los cambios
FLUSH PRIVILEGES;

-- 4. Verificar que el usuario fue creado correctamente
SELECT User, Host FROM mysql.user WHERE User = 'metabase_readonly';

-- 5. Verificar los permisos otorgados
SHOW GRANTS FOR 'metabase_readonly'@'%';

-- ══════════════════════════════════════════════════════════════════════════════
-- NOTA DE SEGURIDAD:
-- Si quieres restringir el acceso solo desde la IP del servidor de Metabase,
-- reemplaza '%' por la IP específica, por ejemplo:
--
--   CREATE USER IF NOT EXISTS 'metabase_readonly'@'192.168.1.100' ...
--   GRANT SELECT ON imaginecrm.* TO 'metabase_readonly'@'192.168.1.100';
-- ══════════════════════════════════════════════════════════════════════════════
