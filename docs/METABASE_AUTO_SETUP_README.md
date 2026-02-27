# Automatización del Dashboard de Metabase

Este proyecto incluye un script en Python (`setup_metabase_dashboard.py`) para automatizar la creación del dashboard de *Emails Críticos* en Metabase a través de su API REST, evitando tener que configurarlo manualmente haciendo clics.

### Archivos Involucrados
| Archivo | Propósito |
| :--- | :--- |
| `setup_metabase_dashboard.py` | Script principal de automatización. |
| `.env.metabase.example` | Plantilla de variables de entorno. |
| `server/scripts/metabase_readonly_user.sql` | Script SQL para crear el usuario de solo lectura. |

### Cómo ejecutarlo en 4 pasos:

```bash
# 1. Instalar dependencias
pip install requests python-dotenv

# 2. Configurar credenciales
cp .env.metabase.example .env.metabase
# Editar .env.metabase con tu editor favorito

# 3. (Opcional pero recomendado) Crear usuario de solo lectura en MySQL
mysql -u root -p < server/scripts/metabase_readonly_user.sql

# 4. Ejecutar el script
python setup_metabase_dashboard.py
```
*Al finalizar, el script imprime la URL directa del dashboard creado.*

### Qué hace el script automáticamente:
- **Autentica con Metabase** usando API Key o usuario/contraseña (configurable en `.env`).
- **Conecta la base de datos MySQL** de producción (o reutiliza la conexión si ya existe).
- **Crea la colección "ImagineCRM"** para organizar el contenido.
- **Crea las 5 preguntas** con SQL nativo y el parámetro `{{periodo_dias}}` filtrable:
  - Resumen Ejecutivo (KPIs en tabla)
  - Emails por Día (barras apiladas)
  - Distribución por Tipo (dona)
  - Top Tenants en Riesgo (barras horizontales)
  - Log Detallado de Envíos (tabla con buscador)
- **Ensambla el dashboard** con el layout de 3 filas y posiciona cada card.
- **Conecta el filtro de período** a todas las cards.

> **Nota de seguridad:** Se recomienda usar un usuario MySQL de solo lectura (`metabase_readonly`) para que Metabase no tenga acceso de escritura a la base de datos de producción.
