# Guía de Despliegue a Producción — ImagineCRM
Esta guía cubre los pasos para desplegar ImagineCRM en un servidor Linux (Ubuntu 22.04 recomendado) usando Docker.

## 1. Pre-requisitos
* **Servidor**: VPS o dedicado con Ubuntu 22.04, mínimo 2 vCPU, 2GB RAM, 20GB SSD.
* **Dominio**: Un dominio principal (ej: `micrm.com`) y acceso a su configuración DNS.
* **Cloudflare** (Recomendado): Para gestionar DNS y obtener certificados SSL para subdominios wildcard (`*.micrm.com`) de forma automática.

**Cuentas de servicios:**
* Stripe (para pagos)
* Servidor SMTP (ej: SendGrid, Mailgun) para enviar emails.
* (Opcional) WhatsApp Cloud API.

## 2. Preparación del Servidor
Actualizar sistema:
```bash
sudo apt update && sudo apt upgrade -y
```

Instalar Docker:
```bash
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER
# Cierra y vuelve a abrir tu sesión SSH para aplicar los cambios de grupo
```

Instalar Git y clonar el repositorio:
```bash
sudo apt install git -y
git clone https://github.com/usuario/imaginecrm.git /opt/imaginecrm
cd /opt/imaginecrm
```

## 3. Configuración
Copia el contenido del paquete `deploy_production` a `/opt/imaginecrm/deploy/`

Configurar variables de entorno:
```bash
cd /opt/imaginecrm
cp deploy/production.env.example .env
nano .env
```
Completa todas las variables requeridas, especialmente `APP_DOMAIN`, `JWT_SECRET`, `DATA_ENCRYPTION_KEY`, `MYSQL_PASSWORD`, `STRIPE_SECRET_KEY` y las de `SMTP`.

Configurar Caddy (HTTPS Automático):
1. Crea un token de API en Cloudflare con permisos para editar DNS.
2. Agrega el token a tu archivo `.env`:
   ```env
   CLOUDFLARE_API_TOKEN=tu_token_de_cloudflare
   ```
3. Reemplaza el Caddyfile por defecto con `deploy/Caddyfile.prod` y edita el email para Let's Encrypt.

## 4. Despliegue Inicial
Ejecuta el script de despliegue desde el directorio `/opt/imaginecrm/deploy/`:
```bash
chmod +x deploy.sh
./deploy.sh
```
El script se encargará de:
* Verificar pre-requisitos.
* Construir las imágenes Docker.
* Levantar todos los servicios (`app`, `mysql`, `redis`, `caddy`).
* Ejecutar las migraciones de la base de datos.
* Crear el usuario superadministrador.
* Mostrar las credenciales de acceso al finalizar.

## 5. Configurar Auto-Arranque (Systemd)
Para que el CRM se inicie automáticamente si el servidor se reinicia:
```bash
sudo cp /opt/imaginecrm/deploy/imaginecrm.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable imaginecrm.service
sudo systemctl start imaginecrm.service
```
Verifica el estado con `sudo systemctl status imaginecrm.service`.

## 6. Actualizaciones
Para actualizar a una nueva versión del código sin downtime:

Obtén los últimos cambios:
```bash
cd /opt/imaginecrm
git pull origin main
```
Ejecuta el script de despliegue en modo update:
```bash
cd deploy
./deploy.sh --update
```
El script reconstruirá la imagen de la aplicación y la reiniciará iterativamente, aplicando rollback automático si falla.

## 7. Comandos Útiles
* **Ver estado del sistema:** `./deploy/deploy.sh --status`
* **Ver logs en tiempo real:** `docker compose -f docker-compose.prod.yml logs -f app`
* **Revertir a la versión anterior:** `./deploy/deploy.sh --rollback`
* **Ejecutar un comando dentro del contenedor:** `docker compose exec app <comando>` (ej: `bash`)
