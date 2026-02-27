# Instrucciones Operativas: Informe Semanal de Emails Críticos

**Propósito:** Este documento describe cómo generar y utilizar el informe semanal de emails críticos enviados por el sistema ImagineCRM. El objetivo es tener una visibilidad completa sobre la comunicación automática con tenants en riesgo y poder actuar sobre los fallos.

**Frecuencia recomendada:** Semanal (ej. todos los lunes a primera hora).

## Paso 1: Ejecutar el Script SQL

1. **Conectar a la base de datos:** Utiliza tu cliente SQL preferido (DBeaver, DataGrip, MySQL Workbench, etc.) para conectarte a la base de datos de producción de ImagineCRM.
2. **Abrir el script:** Abre el archivo `critical_emails_report.sql` / `informe_emails_criticos_semanal.sql`.
3. **Ejecutar las consultas:** Ejecuta las 3 consultas que contiene el script. Cada una proporciona una vista diferente del estado de los envíos.

## Paso 2: Analizar los Resultados

El script te devolverá 3 tablas. Aquí cómo interpretar cada una:

### Tabla 1: Resumen Ejecutivo
Esta tabla te da una visión general de la salud del sistema de emails críticos.
* **tasa_de_exito:** Métrica clave. Un valor consistentemente por debajo del 98% indica un problema subyacente (ej. configuración de SMTP incorrecta en varios tenants, problemas de reputación del dominio). Si baja, es una señal de alerta.
* **emails_fallidos:** Si este número es mayor a cero, procede inmediatamente al análisis de la Tabla 2.
* **Desglose por tipo:** Te permite ver qué tipo de problema está ocurriendo con más frecuencia en tus clientes (pagos fallidos, trials que no convierten, etc.).

### Tabla 2: Detalle de Envíos Fallidos
Esta es la tabla más importante para la acción manual. Contiene solo los emails que no se pudieron enviar.
* **mensaje_de_error:** Lee este campo con atención. Errores comunes pueden ser:
  * `Invalid login: 535-5.7.8 Username and Password not accepted`: El tenant configuró mal su SMTP.
  * `Recipient address rejected: 550 5.1.1 User unknown`: El email del owner del tenant no existe o fue mal escrito.
  * `Connection timed out`: Problema de red o firewall entre el servidor de ImagineCRM y el servidor SMTP del cliente.
* **Acción a tomar:**
  1. **Contactar al tenant:** Para errores de configuración de SMTP o email inválido, el equipo de soporte debe contactar al owner del tenant (por un medio alternativo si es posible) para ayudarle a corregir la configuración en Ajustes > SMTP.
  2. **Diagnóstico técnico:** Para errores de conexión o timeouts, el equipo técnico debe investigar la causa raíz.

### Tabla 3: Log Detallado Completo
Esta tabla es un log completo de todos los intentos de envío de la última semana. Es útil para auditoría, para buscar un envío específico o para tener una visión completa de la actividad.

## Paso 3: Automatización y Reporting (Opcional)

Para optimizar este proceso, considera las siguientes automatizaciones:
* **Exportar a CSV:** La mayoría de los clientes SQL permiten exportar los resultados de una consulta a un archivo CSV. Puedes automatizar esto para compartir el informe con equipos no técnicos.
* **Conectar a un Dashboard:** Conecta la consulta SQL a una herramienta de Business Intelligence (Metabase, Looker, Power BI, etc.) para crear un dashboard que se actualice automáticamente. Esto proporciona visibilidad en tiempo real sin necesidad de ejecutar el script manualmente.
* **Alertas automáticas:** Configura una alerta (ej. en un canal de Slack) que se dispare si la `tasa_de_exito` de la Consulta 1 cae por debajo de un umbral predefinido (ej. 95%) o si el número de `emails_fallidos` es mayor a 5 en una semana.
