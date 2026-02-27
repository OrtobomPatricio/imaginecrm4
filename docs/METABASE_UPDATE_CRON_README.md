# Automatización de Actualizaciones de Metabase (Auto-Refresh)

Este componente incluye un script en Python (`update_metabase_dashboard.py`) y un instalador de Bash (`install_metabase_cron.sh`) para asegurar que el dashboard de *Emails Críticos* en Metabase y su base de datos subyacente se mantengan siempre actualizados, sin intervención manual, usando Cron y Systemd.

### Archivos Involucrados
| Archivo | Propósito |
| :--- | :--- |
| `update_metabase_dashboard.py` | Script principal de actualización. |
| `install_metabase_cron.sh` | Instalador automático de cron + systemd. |
| `metabase_update.env.example` | Plantilla de variables de entorno. |

### Instalación en un solo comando:

```bash
# 1. Configurar variables de entorno
cp metabase_update.env.example .env
nano .env   # Completar METABASE_URL, API_KEY, DASHBOARD_ID, DATABASE_ID

# 2. Instalar cron + systemd automáticamente
chmod +x install_metabase_cron.sh
sudo ./install_metabase_cron.sh
```

### Qué hace el script `update_metabase_dashboard.py`:
El script ejecuta 3 pasos en secuencia:

1. **Re-sincronización de la base de datos:** Llama a la API de Metabase para detectar nuevas tablas, columnas o cambios de tipo en la BD de producción. Espera 10 segundos para que la sincronización se complete antes de continuar.
2. **Re-ejecución de todas las cards:** Fuerza la re-ejecución de cada card del dashboard con `ignore_cache: true`, asegurando que los datos mostrados sean siempre los más recientes. Incluye pausa de 1 segundo entre cards para no saturar la API.
3. **Configuración de auto-refresh:** Verifica y configura el intervalo de auto-refresh del dashboard (por defecto 1 hora).

### Programación automática instalada por `install_metabase_cron.sh`:
| Frecuencia | Comando | Propósito |
| :--- | :--- | :--- |
| **Cada hora** | `update_metabase_dashboard.py` | Actualización completa |
| **Diario 2 AM**| `--sync-only` | Sincronización de esquema de BD |
| **Cada 6 horas**| `--status` | Verificación de estado |
| **Al arrancar**| Timer systemd | Recuperación tras downtime |

### Modos de ejecución manual:
```bash
python update_metabase_dashboard.py              # Actualización completa
python update_metabase_dashboard.py --cards-only # Solo refrescar cards
python update_metabase_dashboard.py --sync-only  # Solo sincronizar BD
python update_metabase_dashboard.py --status     # Ver estado actual
python update_metabase_dashboard.py --refresh-interval 1800  # Auto-refresh cada 30 min
```
