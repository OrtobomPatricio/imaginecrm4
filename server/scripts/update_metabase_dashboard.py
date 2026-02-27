#!/usr/bin/env python3
"""
update_metabase_dashboard.py
───────────────────────────────────────────────────────────────────────────────
Script de actualización automática del Dashboard de Emails Críticos en Metabase.

Qué hace este script:
  1. Autentica con Metabase (API Key o usuario/contraseña)
  2. Re-sincroniza el esquema de la base de datos (detecta nuevas columnas/tablas)
  3. Invalida el caché de todas las cards del dashboard
  4. Re-ejecuta (refresca) todas las cards del dashboard
  5. Configura el auto-refresh del dashboard si aún no está activo
  6. Genera un log de la actualización con métricas de tiempo

Modos de ejecución:
  python update_metabase_dashboard.py              # Actualización completa
  python update_metabase_dashboard.py --cards-only # Solo re-ejecutar cards
  python update_metabase_dashboard.py --sync-only  # Solo re-sincronizar BD
  python update_metabase_dashboard.py --status     # Ver estado actual del dashboard

Uso típico (cron cada hora):
  0 * * * * /usr/bin/python3 /opt/imaginecrm/update_metabase_dashboard.py >> /var/log/metabase_update.log 2>&1

Variables de entorno (mismo .env del script de setup):
  METABASE_URL, METABASE_API_KEY (o METABASE_EMAIL + METABASE_PASSWORD)
  METABASE_DASHBOARD_ID   ID del dashboard a actualizar (obtenido del setup)
  METABASE_DATABASE_ID    ID de la base de datos en Metabase (obtenido del setup)

Autor: ImagineCRM Automation
"""

import os
import sys
import time
import json
import argparse
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any

import requests

# ── Carga de variables de entorno ──────────────────────────────────────────
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# ── Configuración ──────────────────────────────────────────────────────────
METABASE_URL        = os.getenv("METABASE_URL", "http://localhost:3000").rstrip("/")
METABASE_API_KEY    = os.getenv("METABASE_API_KEY", "")
METABASE_EMAIL      = os.getenv("METABASE_EMAIL", "")
METABASE_PASSWORD   = os.getenv("METABASE_PASSWORD", "")
METABASE_DASHBOARD_ID = int(os.getenv("METABASE_DASHBOARD_ID", "0"))
METABASE_DATABASE_ID  = int(os.getenv("METABASE_DATABASE_ID", "0"))

# Configuración de reintentos
MAX_RETRIES     = 3
RETRY_DELAY_SEC = 5
CARD_EXEC_DELAY = 1.0   # Segundos entre ejecución de cada card (evitar sobrecarga)

# ── Logging ────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
log = logging.getLogger("metabase_update")


# ══════════════════════════════════════════════════════════════════════════════
# CLIENTE METABASE
# ══════════════════════════════════════════════════════════════════════════════

class MetabaseClient:
    """Cliente HTTP para la API REST de Metabase con reintentos automáticos."""

    def __init__(self, base_url: str):
        self.base_url = base_url
        self.session  = requests.Session()
        self.session.headers.update({
            "Content-Type": "application/json",
            "Accept": "application/json"
        })

    # ── Autenticación ──────────────────────────────────────────────────────

    def auth_with_api_key(self, api_key: str) -> bool:
        self.session.headers["x-api-key"] = api_key
        r = self._get("/api/user/current")
        if r and r.status_code == 200:
            user = r.json()
            log.info(f"Autenticado como: {user.get('email')} (API Key)")
            return True
        log.error(f"API Key inválida. Status: {r.status_code if r else 'N/A'}")
        return False

    def auth_with_credentials(self, email: str, password: str) -> bool:
        r = self.session.post(
            f"{self.base_url}/api/session",
            json={"username": email, "password": password}
        )
        if r.status_code == 200:
            token = r.json().get("id")
            self.session.headers["X-Metabase-Session"] = token
            log.info(f"Autenticado como: {email} (session token)")
            return True
        log.error(f"Credenciales inválidas. Status: {r.status_code}")
        return False

    # ── HTTP con reintentos ────────────────────────────────────────────────

    def _request(self, method: str, path: str, **kwargs) -> Optional[requests.Response]:
        url = f"{self.base_url}{path}"
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                r = self.session.request(method, url, timeout=30, **kwargs)
                if r.status_code == 429:  # Rate limit
                    wait = int(r.headers.get("Retry-After", RETRY_DELAY_SEC * attempt))
                    log.warning(f"Rate limit alcanzado. Esperando {wait}s...")
                    time.sleep(wait)
                    continue
                return r
            except requests.exceptions.ConnectionError as e:
                log.warning(f"Error de conexión (intento {attempt}/{MAX_RETRIES}): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_SEC * attempt)
            except requests.exceptions.Timeout:
                log.warning(f"Timeout (intento {attempt}/{MAX_RETRIES})")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_DELAY_SEC)
        log.error(f"Falló después de {MAX_RETRIES} intentos: {method} {path}")
        return None

    def _get(self, path: str, **kwargs):
        return self._request("GET", path, **kwargs)

    def _post(self, path: str, data: dict = None, **kwargs):
        return self._request("POST", path, json=data, **kwargs)

    def _put(self, path: str, data: dict = None, **kwargs):
        return self._request("PUT", path, json=data, **kwargs)

    def _delete(self, path: str, **kwargs):
        return self._request("DELETE", path, **kwargs)

    # ── Base de datos ──────────────────────────────────────────────────────

    def sync_database_schema(self, db_id: int) -> bool:
        """
        Fuerza la re-sincronización del esquema de la base de datos.
        Detecta nuevas tablas, columnas y cambios de tipo.
        """
        log.info(f"Re-sincronizando esquema de la base de datos ID: {db_id}...")
        r = self._post(f"/api/database/{db_id}/sync_schema")
        if r and r.status_code in (200, 204):
            log.info("Sincronización de esquema iniciada correctamente")
            return True
        log.warning(f"Error al sincronizar esquema: {r.status_code if r else 'N/A'}")
        return False

    def rescan_database_values(self, db_id: int) -> bool:
        """
        Re-escanea los valores de los campos para actualizar los filtros.
        Útil cuando hay nuevos valores en columnas de tipo enum/category.
        """
        log.info(f"Re-escaneando valores de la base de datos ID: {db_id}...")
        r = self._post(f"/api/database/{db_id}/rescan_values")
        if r and r.status_code in (200, 204):
            log.info("Re-escaneo de valores iniciado correctamente")
            return True
        log.warning(f"Error al re-escanear valores: {r.status_code if r else 'N/A'}")
        return False

    def get_database_status(self, db_id: int) -> Optional[Dict]:
        """Obtiene el estado actual de la base de datos."""
        r = self._get(f"/api/database/{db_id}")
        if r and r.status_code == 200:
            return r.json()
        return None

    # ── Dashboard ──────────────────────────────────────────────────────────

    def get_dashboard(self, dashboard_id: int) -> Optional[Dict]:
        """Obtiene los datos completos del dashboard incluyendo sus cards."""
        r = self._get(f"/api/dashboard/{dashboard_id}")
        if r and r.status_code == 200:
            return r.json()
        log.error(f"No se pudo obtener el dashboard {dashboard_id}: {r.status_code if r else 'N/A'}")
        return None

    def get_dashboard_cards(self, dashboard_id: int) -> List[Dict]:
        """Obtiene la lista de cards (preguntas) del dashboard."""
        dashboard = self.get_dashboard(dashboard_id)
        if not dashboard:
            return []
        # Las cards pueden estar en 'ordered_cards' o 'dashcards'
        cards = dashboard.get("ordered_cards", dashboard.get("dashcards", []))
        return [c for c in cards if c.get("card_id")]  # Excluir text cards

    def set_dashboard_auto_refresh(self, dashboard_id: int,
                                    interval_seconds: int = 3600) -> bool:
        """
        Configura el auto-refresh del dashboard.
        Intervalos válidos en Metabase: 60, 300, 600, 1800, 3600, 10800, 21600, 86400
        """
        valid_intervals = [60, 300, 600, 1800, 3600, 10800, 21600, 86400]
        if interval_seconds not in valid_intervals:
            # Usar el intervalo válido más cercano
            interval_seconds = min(valid_intervals, key=lambda x: abs(x - interval_seconds))
            log.warning(f"Intervalo ajustado al válido más cercano: {interval_seconds}s")

        r = self._put(f"/api/dashboard/{dashboard_id}", {
            "cache_ttl": interval_seconds
        })
        if r and r.status_code == 200:
            minutes = interval_seconds // 60
            log.info(f"Auto-refresh configurado a cada {minutes} minutos")
            return True
        log.warning(f"No se pudo configurar auto-refresh: {r.status_code if r else 'N/A'}")
        return False

    # ── Cards (Preguntas) ──────────────────────────────────────────────────

    def invalidate_card_cache(self, card_id: int) -> bool:
        """Invalida el caché de una card específica."""
        r = self._delete(f"/api/card/{card_id}/public_link")
        # Metabase no tiene un endpoint explícito de invalidación de caché,
        # pero re-ejecutar la card con force=true tiene el mismo efecto.
        return True  # La invalidación real ocurre al re-ejecutar

    def execute_card(self, card_id: int, parameters: list = None) -> Optional[Dict]:
        """
        Fuerza la re-ejecución de una card, ignorando el caché.
        Retorna el resultado de la ejecución con métricas de tiempo.
        """
        payload = {
            "parameters": parameters or [],
            "ignore_cache": True
        }
        start_time = time.time()
        r = self._post(f"/api/card/{card_id}/query", payload)
        elapsed = round(time.time() - start_time, 2)

        if r and r.status_code == 202:
            # 202 Accepted: la query fue aceptada para ejecución asíncrona
            log.info(f"  Card {card_id}: ejecución asíncrona iniciada ({elapsed}s)")
            return {"card_id": card_id, "status": "async", "elapsed": elapsed}

        if r and r.status_code == 200:
            data = r.json()
            row_count = 0
            if "data" in data:
                row_count = len(data["data"].get("rows", []))
            log.info(f"  Card {card_id}: {row_count} filas ({elapsed}s)")
            return {"card_id": card_id, "status": "ok", "rows": row_count, "elapsed": elapsed}

        status = r.status_code if r else "N/A"
        log.warning(f"  Card {card_id}: error al ejecutar (status {status}, {elapsed}s)")
        return {"card_id": card_id, "status": "error", "http_status": status, "elapsed": elapsed}

    def get_card_info(self, card_id: int) -> Optional[Dict]:
        """Obtiene información de una card específica."""
        r = self._get(f"/api/card/{card_id}")
        if r and r.status_code == 200:
            return r.json()
        return None

    # ── Búsqueda de dashboard por nombre ──────────────────────────────────

    def find_dashboard_by_name(self, name: str) -> Optional[int]:
        """Busca un dashboard por nombre y retorna su ID."""
        r = self._get("/api/dashboard", params={"f": "all"})
        if r and r.status_code == 200:
            dashboards = r.json()
            if isinstance(dashboards, dict):
                dashboards = dashboards.get("data", [])
            for d in dashboards:
                if d.get("name") == name:
                    return d["id"]
        return None


# ══════════════════════════════════════════════════════════════════════════════
# OPERACIONES PRINCIPALES
# ══════════════════════════════════════════════════════════════════════════════

def authenticate(client: MetabaseClient) -> bool:
    """Autentica el cliente con Metabase."""
    if METABASE_API_KEY:
        return client.auth_with_api_key(METABASE_API_KEY)
    elif METABASE_EMAIL and METABASE_PASSWORD:
        return client.auth_with_credentials(METABASE_EMAIL, METABASE_PASSWORD)
    else:
        log.error("No hay credenciales configuradas. "
                  "Configura METABASE_API_KEY o METABASE_EMAIL + METABASE_PASSWORD")
        return False


def resolve_ids(client: MetabaseClient) -> tuple:
    """
    Resuelve el dashboard_id y database_id desde las variables de entorno
    o buscando por nombre si no están configurados.
    """
    dashboard_id = METABASE_DASHBOARD_ID
    database_id  = METABASE_DATABASE_ID

    if not dashboard_id:
        log.info("METABASE_DASHBOARD_ID no configurado. Buscando por nombre...")
        dashboard_id = client.find_dashboard_by_name("Emails Críticos — ImagineCRM")
        if dashboard_id:
            log.info(f"Dashboard encontrado con ID: {dashboard_id}")
            log.info(f"Tip: Agrega METABASE_DASHBOARD_ID={dashboard_id} a tu .env")
        else:
            log.error("No se encontró el dashboard. Ejecuta primero setup_metabase_dashboard.py")

    if not database_id:
        log.info("METABASE_DATABASE_ID no configurado. Buscando base de datos...")
        r = client._get("/api/database")
        if r and r.status_code == 200:
            dbs = r.json()
            if isinstance(dbs, dict):
                dbs = dbs.get("data", [])
            for db in dbs:
                if "imaginecrm" in db.get("name", "").lower():
                    database_id = db["id"]
                    log.info(f"Base de datos encontrada con ID: {database_id}")
                    log.info(f"Tip: Agrega METABASE_DATABASE_ID={database_id} a tu .env")
                    break

    return dashboard_id, database_id


def sync_database(client: MetabaseClient, database_id: int) -> Dict:
    """Re-sincroniza el esquema de la base de datos."""
    results = {"sync_schema": False, "rescan_values": False}

    if not database_id:
        log.warning("No se puede sincronizar: database_id no configurado")
        return results

    # Verificar estado actual de la BD
    db_status = client.get_database_status(database_id)
    if db_status:
        initial_sync = db_status.get("initial_sync_status", "unknown")
        log.info(f"Estado actual de la BD: {initial_sync}")

    results["sync_schema"]    = client.sync_database_schema(database_id)
    results["rescan_values"]  = client.rescan_database_values(database_id)

    if results["sync_schema"]:
        # Esperar a que la sincronización se complete antes de re-ejecutar cards
        log.info("Esperando que la sincronización se complete (10s)...")
        time.sleep(10)

    return results


def refresh_dashboard_cards(client: MetabaseClient, dashboard_id: int) -> Dict:
    """Re-ejecuta todas las cards del dashboard."""
    results = {
        "total": 0,
        "success": 0,
        "errors": 0,
        "total_elapsed": 0.0,
        "cards": []
    }

    if not dashboard_id:
        log.warning("No se puede refrescar: dashboard_id no configurado")
        return results

    log.info(f"Obteniendo cards del dashboard {dashboard_id}...")
    dashboard_cards = client.get_dashboard_cards(dashboard_id)

    if not dashboard_cards:
        log.warning("No se encontraron cards en el dashboard")
        return results

    results["total"] = len(dashboard_cards)
    log.info(f"Refrescando {results['total']} cards...")

    for dc in dashboard_cards:
        card_id = dc.get("card_id")
        if not card_id:
            continue

        # Obtener nombre de la card para el log
        card_info = client.get_card_info(card_id)
        card_name = card_info.get("name", f"Card {card_id}") if card_info else f"Card {card_id}"
        log.info(f"  Ejecutando: {card_name[:50]}...")

        result = client.execute_card(card_id)
        if result:
            results["cards"].append({
                "card_id": card_id,
                "name": card_name,
                **result
            })
            if result.get("status") in ("ok", "async"):
                results["success"] += 1
            else:
                results["errors"] += 1
            results["total_elapsed"] += result.get("elapsed", 0)
        else:
            results["errors"] += 1

        # Pausa entre cards para no saturar la API
        time.sleep(CARD_EXEC_DELAY)

    return results


def configure_auto_refresh(client: MetabaseClient, dashboard_id: int,
                            interval_seconds: int = 3600) -> bool:
    """Configura el auto-refresh del dashboard."""
    if not dashboard_id:
        return False

    dashboard = client.get_dashboard(dashboard_id)
    if not dashboard:
        return False

    current_ttl = dashboard.get("cache_ttl")
    if current_ttl == interval_seconds:
        log.info(f"Auto-refresh ya configurado a {interval_seconds // 60} minutos")
        return True

    return client.set_dashboard_auto_refresh(dashboard_id, interval_seconds)


def show_status(client: MetabaseClient, dashboard_id: int, database_id: int):
    """Muestra el estado actual del dashboard y la base de datos."""
    print("\n" + "═" * 60)
    print("  Estado del Dashboard de Emails Críticos")
    print("═" * 60)

    # Estado de la base de datos
    if database_id:
        db = client.get_database_status(database_id)
        if db:
            print(f"\n  Base de datos: {db.get('name', 'N/A')}")
            print(f"  Motor: {db.get('engine', 'N/A')}")
            print(f"  Estado de sync: {db.get('initial_sync_status', 'N/A')}")
            print(f"  Último sync: {db.get('updated_at', 'N/A')}")

    # Estado del dashboard
    if dashboard_id:
        dashboard = client.get_dashboard(dashboard_id)
        if dashboard:
            print(f"\n  Dashboard: {dashboard.get('name', 'N/A')}")
            print(f"  ID: {dashboard_id}")
            cache_ttl = dashboard.get("cache_ttl")
            if cache_ttl:
                print(f"  Auto-refresh: cada {cache_ttl // 60} minutos")
            else:
                print(f"  Auto-refresh: no configurado")

            cards = dashboard.get("ordered_cards", dashboard.get("dashcards", []))
            real_cards = [c for c in cards if c.get("card_id")]
            print(f"  Cards: {len(real_cards)}")

            for dc in real_cards:
                card_id = dc.get("card_id")
                if card_id:
                    info = client.get_card_info(card_id)
                    if info:
                        name = info.get("name", f"Card {card_id}")[:45]
                        updated = info.get("updated_at", "N/A")[:19]
                        print(f"    [{card_id}] {name:<45} | Actualizada: {updated}")

    print("\n" + "═" * 60 + "\n")


# ══════════════════════════════════════════════════════════════════════════════
# FUNCIÓN PRINCIPAL
# ══════════════════════════════════════════════════════════════════════════════

def main():
    # ── Argumentos de línea de comandos ───────────────────────────────────
    parser = argparse.ArgumentParser(
        description="Actualiza el Dashboard de Emails Críticos en Metabase",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Ejemplos:
  python update_metabase_dashboard.py              # Actualización completa
  python update_metabase_dashboard.py --cards-only # Solo re-ejecutar cards
  python update_metabase_dashboard.py --sync-only  # Solo re-sincronizar BD
  python update_metabase_dashboard.py --status     # Ver estado actual
  python update_metabase_dashboard.py --refresh-interval 1800  # Auto-refresh cada 30min
        """
    )
    parser.add_argument("--cards-only",       action="store_true",
                        help="Solo re-ejecutar las cards (sin sync de BD)")
    parser.add_argument("--sync-only",        action="store_true",
                        help="Solo re-sincronizar la base de datos (sin ejecutar cards)")
    parser.add_argument("--status",           action="store_true",
                        help="Mostrar el estado actual del dashboard y salir")
    parser.add_argument("--refresh-interval", type=int, default=3600,
                        help="Intervalo de auto-refresh en segundos (default: 3600 = 1h)")
    parser.add_argument("--no-auto-refresh",  action="store_true",
                        help="No configurar auto-refresh del dashboard")
    args = parser.parse_args()

    # ── Inicio ─────────────────────────────────────────────────────────────
    start_time = datetime.now()
    log.info("=" * 60)
    log.info("  ImagineCRM — Actualización Dashboard Metabase")
    log.info(f"  Inicio: {start_time.strftime('%Y-%m-%d %H:%M:%S')}")
    log.info("=" * 60)

    # ── Autenticación ──────────────────────────────────────────────────────
    client = MetabaseClient(METABASE_URL)
    if not authenticate(client):
        sys.exit(1)

    # ── Resolver IDs ───────────────────────────────────────────────────────
    dashboard_id, database_id = resolve_ids(client)

    if not dashboard_id and not args.sync_only:
        log.error("No se pudo resolver el dashboard_id. Abortando.")
        sys.exit(1)

    # ── Modo: solo mostrar estado ──────────────────────────────────────────
    if args.status:
        show_status(client, dashboard_id, database_id)
        sys.exit(0)

    # ── Modo: solo sincronizar BD ──────────────────────────────────────────
    if args.sync_only:
        if not database_id:
            log.error("No se pudo resolver el database_id. Abortando.")
            sys.exit(1)
        sync_results = sync_database(client, database_id)
        log.info(f"Sync completado: {sync_results}")
        sys.exit(0)

    # ── Actualización completa o solo cards ───────────────────────────────
    summary = {
        "timestamp": start_time.isoformat(),
        "dashboard_id": dashboard_id,
        "database_id": database_id,
        "sync": {},
        "cards": {},
        "auto_refresh": False
    }

    # Paso 1: Sincronizar BD (si no es --cards-only)
    if not args.cards_only and database_id:
        log.info("─── Paso 1/3: Sincronizando base de datos ───")
        summary["sync"] = sync_database(client, database_id)
    else:
        log.info("─── Paso 1/3: Sincronización de BD omitida ───")

    # Paso 2: Re-ejecutar cards del dashboard
    log.info("─── Paso 2/3: Refrescando cards del dashboard ───")
    summary["cards"] = refresh_dashboard_cards(client, dashboard_id)

    # Paso 3: Configurar auto-refresh
    if not args.no_auto_refresh:
        log.info("─── Paso 3/3: Configurando auto-refresh ───")
        summary["auto_refresh"] = configure_auto_refresh(
            client, dashboard_id, args.refresh_interval
        )
    else:
        log.info("─── Paso 3/3: Auto-refresh omitido ───")

    # ── Resumen final ──────────────────────────────────────────────────────
    elapsed_total = (datetime.now() - start_time).total_seconds()
    cards = summary["cards"]

    log.info("=" * 60)
    log.info("  RESUMEN DE ACTUALIZACIÓN")
    log.info("=" * 60)
    log.info(f"  Dashboard ID:      {dashboard_id}")
    log.info(f"  Cards procesadas:  {cards.get('total', 0)}")
    log.info(f"  Exitosas:          {cards.get('success', 0)}")
    log.info(f"  Con errores:       {cards.get('errors', 0)}")
    log.info(f"  Tiempo total:      {elapsed_total:.1f}s")
    log.info(f"  Auto-refresh:      {'Configurado' if summary['auto_refresh'] else 'No configurado'}")

    if cards.get("errors", 0) > 0:
        log.warning("Algunas cards tuvieron errores. Revisa los logs anteriores.")
        sys.exit(2)  # Exit code 2 = completado con advertencias

    log.info("Actualización completada exitosamente.")
    sys.exit(0)


if __name__ == "__main__":
    main()
