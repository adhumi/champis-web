"""Les identifiants que `app.js` cherche par `$("…")` existent dans leur page.

Un identifiant manquant plante le gestionnaire au premier `null` (le 4 nov. 2026, `$("weather")`
cassait la bascule « potentiel toute saison » et laissait un patchwork T/S à l'écran).
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

WEB = Path(__file__).parent.parent


def ids_in(html: str) -> set[str]:
    return set(re.findall(r'id="([^"]+)"', html))


def ids_used_by(js: str) -> set[str]:
    return set(re.findall(r'\$\("([^"]+)"\)', js))


def test_every_id_used_by_app_js_exists_in_carte_html():
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    # identifiants créés dynamiquement par app.js ou site.js, hors du HTML statique
    dynamic = {"probe-close", "probe-days"}
    assert ids_used_by(js) - ids_in(html) - dynamic == set()


@pytest.mark.parametrize("page", ["carte.html", "comprendre.html", "soutenir.html"])
def test_every_page_has_the_shared_chrome(page: str):
    html = (WEB / page).read_text(encoding="utf-8")
    assert {"site-header", "site-tabs"} <= ids_in(html)


def test_the_france_view_is_gone():
    """Décision du 4 nov. 2026 (spec › Points ouverts › Vue France et indice par département) :
    plus de départements colorés sur la carte ni sur l'accueil, la couche de tuiles reste visible
    à tout zoom."""
    app = (WEB / "app.js").read_text(encoding="utf-8")
    for name in ("DEPT_ZOOM", "franceView", "paintDepts", "updateTileVisibility", "depts-line"):
        assert name not in app, name
    assert 'setLayoutProperty("T"' not in app


def test_the_map_stays_on_today_and_the_probe_shows_the_week():
    """Étape A (spec › Produit, 6 nov. 2026) : le bandeau des jours quitte la carte, qui montre
    toujours aujourd'hui ; plus de lecture de `GET /departements` ni des limites départementales ;
    les onze jours d'un point sont dans sa fiche, en lecture seule."""
    app = (WEB / "app.js").read_text(encoding="utf-8")
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    for name in (
        "/departements?",
        "departements.geojson",
        "renderDays",
        "selectedDay",
        "centerDept",
    ):
        assert name not in app, name
    assert 'id="strip"' not in html and 'id="today-line"' in html
    assert "Site.renderDayDots" in app and "Site.todayLine" in app
