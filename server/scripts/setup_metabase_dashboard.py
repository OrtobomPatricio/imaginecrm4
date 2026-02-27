#!/usr/bin/env python3
"""
setup_metabase_dashboard.py
───────────────────────────────────────────────────────────────────────────────
Script de automatización para configurar el Dashboard de Emails Críticos
de ImagineCRM en Metabase vía su API REST.

Qué hace este script:
  1. Autentica con Metabase usando API Key o usuario/contraseña
  2. Conecta (o reutiliza) la base de datos MySQL de producción
  3. Crea las 5 preguntas (cards) del dashboard
  4. Crea el dashboard con las 5 cards en el layout correcto
  5. Agrega el filtro de período interactivo
  6. Imprime la URL del dashboard creado

Uso:
  pip install requests python-dotenv
  cp .env.example .env          # Editar con tus credenciales
  python setup_metabase_dashboard.py

Variables de entorno requeridas (ver .env.example):
  METABASE_URL          URL base de tu instancia (ej: https://metabase.tuempresa.com)
  METABASE_API_KEY      API Key de Metabase (recomendado)
  -- O alternativamente --
  METABASE_EMAIL        Email del administrador
  METABASE_PASSWORD     Contraseña del administrador
  -- Base de datos --
  DB_HOST               Host de la base de datos MySQL de producción
  DB_PORT               Puerto (por defecto 3306)
  DB_NAME               Nombre de la base de datos
  DB_USER               Usuario de la base de datos
  DB_PASSWORD           Contraseña de la base de datos

Autor: ImagineCRM Automation
"""

import os
import sys
import json
import time
import requests
from typing import Optional

# ── Carga de variables de entorno ──────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass  # python-dotenv opcional; se pueden pasar las vars directamente

# ── Configuración ──────────────────────────────────────────────────────────
METABASE_URL   = os.getenv("METABASE_URL", "http://localhost:3000").rstrip("/")
METABASE_API_KEY = os.getenv("METABASE_API_KEY", "")
METABASE_EMAIL   = os.getenv("METABASE_EMAIL", "")
METABASE_PASSWORD = os.getenv("METABASE_PASSWORD", "")

DB_HOST     = os.getenv("DB_HOST", "localhost")
DB_PORT     = int(os.getenv("DB_PORT", "3306"))
DB_NAME     = os.getenv("DB_NAME", "imaginecrm")
DB_USER     = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")

DASHBOARD_NAME    = "Emails Críticos — ImagineCRM"
COLLECTION_NAME   = "ImagineCRM"
DB_DISPLAY_NAME   = "ImagineCRM Producción"

# ── Colores de consola ─────────────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
BLUE   = "\033[94m"
BOLD   = "\033[1m"
RESET  = "\033[0m"

def ok(msg):    print(f"  {GREEN}✓{RESET} {msg}")
def warn(msg):  print(f"  {YELLOW}⚠{RESET} {msg}")
def err(msg):   print(f"  {RED}✗{RESET} {msg}")
def info(msg):  print(f"  {BLUE}→{RESET} {msg}")
def step(msg):  print(f"\n{BOLD}{msg}{RESET}")


# ══════════════════════════════════════════════════════════════════════════════
# CLASE CLIENTE DE METABASE
# ══════════════════════════════════════════════════════════════════════════════

class MetabaseClient:
    """Cliente HTTP para la API REST de Metabase."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session  = requests.Session()
        self.session.headers.update({"Content-Type": "application/json"})

    # ── Autenticación ──────────────────────────────────────────────────────

    def auth_with_api_key(self, api_key: str):
        """Autentica usando API Key (método recomendado)."""
        self.session.headers["x-api-key"] = api_key
        # Verificar que la key funciona
        r = self.session.get(f"{self.base_url}/api/user/current")
        if r.status_code == 200:
            user = r.json()
            ok(f"Autenticado como: {user.get('email')} (API Key)")
            return True
        err(f"API Key inválida o sin permisos. Status: {r.status_code}")
        return False

    def auth_with_credentials(self, email: str, password: str) -> bool:
        """Autentica usando email y contraseña, obtiene session token."""
        r = self.session.post(
            f"{self.base_url}/api/session",
            json={"username": email, "password": password}
        )
        if r.status_code == 200:
            token = r.json().get("id")
            self.session.headers["X-Metabase-Session"] = token
            ok(f"Autenticado como: {email} (session token)")
            return True
        err(f"Credenciales inválidas. Status: {r.status_code} — {r.text[:200]}")
        return False

    # ── Helpers HTTP ───────────────────────────────────────────────────────

    def get(self, path: str, **kwargs) -> requests.Response:
        return self.session.get(f"{self.base_url}{path}", **kwargs)

    def post(self, path: str, data: dict = None, **kwargs) -> requests.Response:
        return self.session.post(f"{self.base_url}{path}", json=data, **kwargs)

    def put(self, path: str, data: dict = None, **kwargs) -> requests.Response:
        return self.session.put(f"{self.base_url}{path}", json=data, **kwargs)

    # ── Base de datos ──────────────────────────────────────────────────────

    def find_database(self, name: str) -> Optional[dict]:
        """Busca una base de datos por nombre."""
        r = self.get("/api/database")
        if r.status_code != 200:
            return None
        dbs = r.json().get("data", r.json()) if isinstance(r.json(), dict) else r.json()
        for db in dbs:
            if db.get("name") == name:
                return db
        return None

    def create_database(self) -> int:
        """Crea la conexión a la base de datos MySQL de ImagineCRM."""
        payload = {
            "engine": "mysql",
            "name": DB_DISPLAY_NAME,
            "details": {
                "host": DB_HOST,
                "port": DB_PORT,
                "dbname": DB_NAME,
                "user": DB_USER,
                "password": DB_PASSWORD,
                "ssl": False,
                "additional-options": ""
            },
            "auto_run_queries": True,
            "is_full_sync": True,
            "is_on_demand": False,
            "schedules": {}
        }
        r = self.post("/api/database", payload)
        if r.status_code in (200, 201):
            db_id = r.json()["id"]
            ok(f"Base de datos creada con ID: {db_id}")
            # Esperar a que Metabase sincronice el esquema
            info("Esperando sincronización del esquema (15s)...")
            time.sleep(15)
            return db_id
        raise RuntimeError(f"Error al crear la base de datos: {r.status_code} — {r.text[:300]}")

    def get_or_create_database(self) -> int:
        """Obtiene la BD existente o la crea si no existe."""
        existing = self.find_database(DB_DISPLAY_NAME)
        if existing:
            db_id = existing["id"]
            ok(f"Base de datos existente encontrada con ID: {db_id}")
            return db_id
        info(f"Creando nueva conexión a la base de datos '{DB_DISPLAY_NAME}'...")
        return self.create_database()

    # ── Colección ──────────────────────────────────────────────────────────

    def get_or_create_collection(self, name: str) -> Optional[int]:
        """Obtiene o crea una colección para organizar el dashboard."""
        r = self.get("/api/collection")
        if r.status_code == 200:
            collections = r.json().get("data", [])
            for col in collections:
                if col.get("name") == name:
                    ok(f"Colección existente encontrada: '{name}' (ID: {col['id']})")
                    return col["id"]
        # Crear nueva colección
        r = self.post("/api/collection", {"name": name, "color": "#509EE3"})
        if r.status_code in (200, 201):
            col_id = r.json()["id"]
            ok(f"Colección '{name}' creada con ID: {col_id}")
            return col_id
        warn(f"No se pudo crear la colección. El dashboard se creará en la raíz.")
        return None

    # ── Cards (Preguntas) ──────────────────────────────────────────────────

    def create_card(self, name: str, description: str, sql: str,
                    db_id: int, display: str, viz_settings: dict,
                    collection_id: Optional[int] = None) -> int:
        """Crea una pregunta (card) con SQL nativo en Metabase."""
        payload = {
            "name": name,
            "description": description,
            "display": display,
            "visualization_settings": viz_settings,
            "dataset_query": {
                "database": db_id,
                "type": "native",
                "native": {
                    "query": sql,
                    "template-tags": {
                        "periodo_dias": {
                            "id": "periodo_dias",
                            "name": "periodo_dias",
                            "display-name": "Período (días)",
                            "type": "number",
                            "default": "7"
                        }
                    }
                }
            },
            "collection_id": collection_id
        }
        r = self.post("/api/card", payload)
        if r.status_code in (200, 201):
            card_id = r.json()["id"]
            ok(f"Card '{name}' creada con ID: {card_id}")
            return card_id
        raise RuntimeError(f"Error al crear card '{name}': {r.status_code} — {r.text[:300]}")

    # ── Dashboard ──────────────────────────────────────────────────────────

    def create_dashboard(self, name: str, description: str,
                         collection_id: Optional[int] = None) -> int:
        """Crea un dashboard vacío."""
        payload = {
            "name": name,
            "description": description,
            "collection_id": collection_id,
            "parameters": []
        }
        r = self.post("/api/dashboard", payload)
        if r.status_code in (200, 201):
            dash_id = r.json()["id"]
            ok(f"Dashboard '{name}' creado con ID: {dash_id}")
            return dash_id
        raise RuntimeError(f"Error al crear dashboard: {r.status_code} — {r.text[:300]}")

    def add_card_to_dashboard(self, dashboard_id: int, card_id: int,
                               row: int, col: int, size_x: int, size_y: int) -> int:
        """Agrega una card al dashboard en la posición especificada."""
        payload = {
            "cardId": card_id,
            "row": row,
            "col": col,
            "size_x": size_x,
            "size_y": size_y,
            "parameter_mappings": [],
            "visualization_settings": {}
        }
        r = self.post(f"/api/dashboard/{dashboard_id}/cards", payload)
        if r.status_code in (200, 201):
            dash_card_id = r.json()["id"]
            return dash_card_id
        raise RuntimeError(
            f"Error al agregar card {card_id} al dashboard: {r.status_code} — {r.text[:300]}"
        )

    def add_filter_to_dashboard(self, dashboard_id: int, card_ids: list) -> None:
        """Agrega el filtro de período al dashboard y lo conecta a todas las cards."""
        # Obtener el estado actual del dashboard para leer los dashcards
        r = self.get(f"/api/dashboard/{dashboard_id}")
        if r.status_code != 200:
            warn("No se pudo obtener el estado del dashboard para agregar filtros.")
            return

        dash_data = r.json()
        ordered_cards = dash_data.get("ordered_cards", [])

        # Definir el parámetro de filtro
        filter_param = {
            "id": "periodo_dias_filter",
            "name": "Período (días)",
            "slug": "periodo_dias",
            "type": "category",
            "default": "7"
        }

        # Mapear el filtro a cada card que tenga el template-tag
        parameter_mappings = []
        for dc in ordered_cards:
            if dc.get("card_id") in card_ids:
                parameter_mappings.append({
                    "parameter_id": "periodo_dias_filter",
                    "card_id": dc["card_id"],
                    "target": ["variable", ["template-tag", "periodo_dias"]]
                })

        # Actualizar el dashboard con el parámetro y los mappings
        update_payload = {
            "parameters": [filter_param],
            "ordered_cards": [
                {**dc, "parameter_mappings": [
                    m for m in parameter_mappings if m["card_id"] == dc.get("card_id")
                ]}
                for dc in ordered_cards
            ]
        }
        r = self.put(f"/api/dashboard/{dashboard_id}", update_payload)
        if r.status_code == 200:
            ok("Filtro de período conectado a todas las cards del dashboard")
        else:
            warn(f"No se pudo conectar el filtro automáticamente: {r.status_code}")
            warn("Conecta el filtro manualmente desde la UI de Metabase.")


# ══════════════════════════════════════════════════════════════════════════════
# DEFINICIÓN DE LAS 5 PREGUNTAS (QUERIES SQL)
# ══════════════════════════════════════════════════════════════════════════════

def get_cards_definition():
    """Retorna la definición completa de las 5 cards del dashboard."""
    return [
        # ── Card 1: Resumen Ejecutivo ────────────────────────────────────
        {
            "name": "📊 Resumen Ejecutivo — Emails Críticos",
            "description": "KPIs principales: total enviados, tasa de éxito, fallos y desglose por tipo.",
            "sql": """
SELECT
    COUNT(*) AS total_enviados,
    SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS emails_exitosos,
    SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS emails_fallidos,
    CONCAT(ROUND(
        (SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0)) * 100, 1
    ), '%') AS tasa_de_exito,
    SUM(CASE WHEN emailType = 'PAYMENT_FAILED'   THEN 1 ELSE 0 END) AS pago_fallido,
    SUM(CASE WHEN emailType = 'TRIAL_EXPIRED'    THEN 1 ELSE 0 END) AS trial_expirado,
    SUM(CASE WHEN emailType = 'SUBSCRIPTION_EXP' THEN 1 ELSE 0 END) AS suscripcion_expirada
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
""".strip(),
            "display": "scalar",
            "viz_settings": {},
            "layout": {"row": 0, "col": 0, "size_x": 24, "size_y": 4}
        },

        # ── Card 2: Emails por Día ───────────────────────────────────────
        {
            "name": "📅 Emails por Día (por tipo)",
            "description": "Evolución diaria de emails críticos enviados, desglosados por tipo.",
            "sql": """
SELECT
    DATE(sentAt) AS dia,
    CASE emailType
        WHEN 'PAYMENT_FAILED'   THEN 'Pago Fallido'
        WHEN 'TRIAL_EXPIRED'    THEN 'Trial Expirado'
        WHEN 'SUBSCRIPTION_EXP' THEN 'Suscripción Expirada'
        ELSE emailType
    END AS tipo,
    COUNT(*) AS cantidad
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY DATE(sentAt), emailType
ORDER BY dia ASC
""".strip(),
            "display": "bar",
            "viz_settings": {
                "graph.dimensions": ["dia", "tipo"],
                "graph.metrics": ["cantidad"],
                "stackable.stack_type": "stacked",
                "graph.x_axis.title_text": "Fecha",
                "graph.y_axis.title_text": "Cantidad de emails"
            },
            "layout": {"row": 4, "col": 0, "size_x": 16, "size_y": 8}
        },

        # ── Card 3: Distribución por Tipo ────────────────────────────────
        {
            "name": "🍩 Distribución por Tipo",
            "description": "Proporción de emails críticos por tipo en el período seleccionado.",
            "sql": """
SELECT
    CASE emailType
        WHEN 'PAYMENT_FAILED'   THEN 'Pago Fallido'
        WHEN 'TRIAL_EXPIRED'    THEN 'Trial Expirado'
        WHEN 'SUBSCRIPTION_EXP' THEN 'Suscripción Expirada'
        ELSE emailType
    END AS tipo,
    COUNT(*) AS cantidad
FROM critical_email_log
WHERE sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY emailType
ORDER BY cantidad DESC
""".strip(),
            "display": "pie",
            "viz_settings": {
                "pie.dimension": "tipo",
                "pie.metric": "cantidad"
            },
            "layout": {"row": 4, "col": 16, "size_x": 8, "size_y": 8}
        },

        # ── Card 4: Top Tenants en Riesgo ────────────────────────────────
        {
            "name": "🏢 Top Tenants en Riesgo",
            "description": "Los 10 tenants que más emails críticos han recibido en el período.",
            "sql": """
SELECT
    t.name AS tenant,
    COUNT(log.id) AS emails_recibidos,
    SUM(CASE WHEN log.success = 0 THEN 1 ELSE 0 END) AS emails_fallidos
FROM critical_email_log log
JOIN tenants t ON log.tenantId = t.id
WHERE log.sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
GROUP BY t.id, t.name
ORDER BY emails_recibidos DESC
LIMIT 10
""".strip(),
            "display": "row",
            "viz_settings": {
                "graph.dimensions": ["tenant"],
                "graph.metrics": ["emails_recibidos"],
                "graph.x_axis.title_text": "Emails recibidos"
            },
            "layout": {"row": 12, "col": 0, "size_x": 12, "size_y": 8}
        },

        # ── Card 5: Log Detallado ────────────────────────────────────────
        {
            "name": "📋 Log Detallado de Envíos",
            "description": "Registro completo de todos los emails críticos enviados en el período.",
            "sql": """
SELECT
    log.sentAt AS fecha_envio,
    t.name AS tenant,
    log.recipientEmail AS email_destinatario,
    CASE log.emailType
        WHEN 'PAYMENT_FAILED'   THEN 'Pago Fallido'
        WHEN 'TRIAL_EXPIRED'    THEN 'Trial Expirado'
        WHEN 'SUBSCRIPTION_EXP' THEN 'Suscripción Expirada'
        ELSE log.emailType
    END AS tipo_email,
    CASE WHEN log.success = 1 THEN 'Exitoso' ELSE 'Fallido' END AS estado,
    COALESCE(log.errorMessage, '—') AS error
FROM critical_email_log log
JOIN tenants t ON log.tenantId = t.id
WHERE log.sentAt >= DATE_SUB(NOW(), INTERVAL {{periodo_dias}} DAY)
ORDER BY log.sentAt DESC
LIMIT 500
""".strip(),
            "display": "table",
            "viz_settings": {
                "table.pivot_column": "tipo_email",
                "table.cell_column": "estado",
                "column_settings": {
                    '["name","estado"]': {
                        "column_title": "Estado",
                        "color_getter": "estado"
                    }
                }
            },
            "layout": {"row": 12, "col": 12, "size_x": 12, "size_y": 8}
        }
    ]


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIÓN PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

def main():
    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{BOLD}  ImagineCRM — Setup Dashboard Metabase{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")

    # ── 1. Validar configuración ───────────────────────────────────────────
    step("1/6  Validando configuración...")

    if not METABASE_URL or METABASE_URL == "http://localhost:3000":
        warn("METABASE_URL no configurado. Usando http://localhost:3000")

    if not METABASE_API_KEY and not (METABASE_EMAIL and METABASE_PASSWORD):
        err("Debes configurar METABASE_API_KEY o (METABASE_EMAIL + METABASE_PASSWORD)")
        err("Copia .env.example a .env y completa las variables.")
        sys.exit(1)

    if not DB_PASSWORD:
        warn("DB_PASSWORD está vacío. Asegúrate de que la BD no requiere contraseña.")

    ok("Configuración validada")

    # ── 2. Autenticar ──────────────────────────────────────────────────────
    step("2/6  Autenticando en Metabase...")
    client = MetabaseClient(METABASE_URL)

    if METABASE_API_KEY:
        if not client.auth_with_api_key(METABASE_API_KEY):
            sys.exit(1)
    else:
        if not client.auth_with_credentials(METABASE_EMAIL, METABASE_PASSWORD):
            sys.exit(1)

    # ── 3. Conectar base de datos ──────────────────────────────────────────
    step("3/6  Configurando conexión a la base de datos...")
    try:
        db_id = client.get_or_create_database()
    except RuntimeError as e:
        err(str(e))
        sys.exit(1)

    # ── 4. Crear colección ─────────────────────────────────────────────────
    step("4/6  Configurando colección...")
    collection_id = client.get_or_create_collection(COLLECTION_NAME)

    # ── 5. Crear las 5 cards ───────────────────────────────────────────────
    step("5/6  Creando preguntas (cards)...")
    cards_def = get_cards_definition()
    card_ids  = []

    for card_def in cards_def:
        try:
            card_id = client.create_card(
                name=card_def["name"],
                description=card_def["description"],
                sql=card_def["sql"],
                db_id=db_id,
                display=card_def["display"],
                viz_settings=card_def["viz_settings"],
                collection_id=collection_id
            )
            card_ids.append((card_id, card_def["layout"]))
            time.sleep(0.5)  # Pequeña pausa para no saturar la API
        except RuntimeError as e:
            err(str(e))
            warn(f"Continuando con las demás cards...")

    if not card_ids:
        err("No se pudo crear ninguna card. Abortando.")
        sys.exit(1)

    # ── 6. Crear dashboard y agregar cards ─────────────────────────────────
    step("6/6  Creando dashboard y configurando layout...")
    try:
        dashboard_id = client.create_dashboard(
            name=DASHBOARD_NAME,
            description="Monitoreo en tiempo real de emails críticos enviados a tenants en riesgo.",
            collection_id=collection_id
        )
    except RuntimeError as e:
        err(str(e))
        sys.exit(1)

    # Agregar cada card al dashboard en su posición
    all_card_ids = []
    for card_id, layout in card_ids:
        try:
            client.add_card_to_dashboard(
                dashboard_id=dashboard_id,
                card_id=card_id,
                row=layout["row"],
                col=layout["col"],
                size_x=layout["size_x"],
                size_y=layout["size_y"]
            )
            all_card_ids.append(card_id)
            ok(f"Card {card_id} agregada al dashboard en posición ({layout['row']}, {layout['col']})")
            time.sleep(0.3)
        except RuntimeError as e:
            err(str(e))

    # Agregar filtro de período
    if all_card_ids:
        info("Conectando filtro de período a las cards...")
        client.add_filter_to_dashboard(dashboard_id, all_card_ids)

    # ── Resultado final ────────────────────────────────────────────────────
    dashboard_url = f"{METABASE_URL}/dashboard/{dashboard_id}"

    print(f"\n{BOLD}{'═' * 60}{RESET}")
    print(f"{GREEN}{BOLD}  ✓ Dashboard creado exitosamente{RESET}")
    print(f"{BOLD}{'═' * 60}{RESET}")
    print(f"\n  {BOLD}URL del dashboard:{RESET}")
    print(f"  {BLUE}{dashboard_url}{RESET}")
    print(f"\n  {BOLD}Cards creadas:{RESET} {len(all_card_ids)}/{len(cards_def)}")
    print(f"  {BOLD}Dashboard ID:{RESET} {dashboard_id}")
    print(f"  {BOLD}Base de datos ID:{RESET} {db_id}")
    print(f"\n  {YELLOW}Próximos pasos:{RESET}")
    print(f"  1. Abre la URL del dashboard en tu navegador")
    print(f"  2. Verifica que el filtro 'Período (días)' funciona correctamente")
    print(f"  3. Configura alertas desde cada card (ícono de campana 🔔)")
    print(f"  4. Comparte el dashboard con tu equipo de operaciones")
    print(f"\n")


if __name__ == "__main__":
    main()
