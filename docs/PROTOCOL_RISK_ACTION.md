# Protocolo de Acción Operativa para Retención y Upselling
**Frecuencia de Revisión:** Diaria, preferiblemente al inicio de la jornada laboral.

**Equipo Responsable:** Operaciones y Ventas

## Acciones por Nivel de Riesgo:

### 🔴 CRÍTICO (Pago Fallido):
* **Disparador:** Alerta del sistema de monitoreo de PayPal o revisión manual de webhooks fallidos.
* **Acción Inmediata:**
  1. **Contacto Telefónico:** El ejecutivo de cuenta asignado debe llamar al owner del tenant inmediatamente.
  2. **Email Personalizado:** Enviar un email con el asunto "Acción Urgente Requerida: Problema con tu Pago en ImagineCRM", explicando que la cuenta será suspendida y ofreciendo ayuda para actualizar el método de pago.
* **Objetivo:** Recuperar el pago antes de que la suspensión automática impacte la operación del cliente.

### 🟠 ALTO (Trial Vence en ≤ 3 Días):
* **Disparador:** Tenants que aparecen en la consulta SQL con riesgo "ALTO".
* **Acción Inmediata:**
  1. **Email Personalizado:** El ejecutivo de cuenta debe enviar un email personalizado (no automatizado) preguntando sobre la experiencia del trial, resolviendo dudas y recordando los beneficios de los planes de pago.
  2. **Ofrecer Extensión (Opcional):** Si el cliente muestra interés pero no ha tenido tiempo de evaluar, el superadmin puede extender el trial 3-5 días más como gesto de buena voluntad.
* **Objetivo:** Conversión. Resolver las últimas barreras para que el cliente se suscriba.

### 🟡 MEDIO (Trial Vence en 4-7 Días):
* **Disparador:** Tenants que aparecen en la consulta SQL con riesgo "MEDIO".
* **Acción:**
  1. **Segmentación:** Añadir a estos clientes a una campaña de email automatizada de "Última Semana de Trial", que destaque casos de éxito, funciones avanzadas y una clara llamada a la acción para suscribirse.
* **Objetivo:** Nutrir. Mantener el interés y guiar al cliente hacia la decisión de compra sin ser intrusivo.

### 🔵 INFORMATIVO (>90% Uso de Mensajes):
* **Disparador:** Tenants que aparecen en la consulta SQL con riesgo "INFORMATIVO".
* **Acción:**
  1. **Notificación Proactiva:** Enviar un email informativo: "Parece que le estás sacando mucho provecho a ImagineCRM. Has usado más del 90% de tu límite de mensajes este mes. Considera actualizar tu plan para evitar interrupciones."
* **Objetivo:** Upselling. Generar ingresos adicionales y mejorar la experiencia del cliente al evitar que se tope con un límite.
