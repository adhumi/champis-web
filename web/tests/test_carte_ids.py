"""Les identifiants que `app.js` et `today.js` cherchent par `$("…")` existent dans leur page.

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
    dynamic = {"probe-close"}
    assert ids_used_by(js) - ids_in(html) - dynamic == set()


def test_every_id_used_by_today_js_exists_in_index_html():
    html = (WEB / "index.html").read_text(encoding="utf-8")
    js = (WEB / "today.js").read_text(encoding="utf-8")
    assert ids_used_by(js) - ids_in(html) == set()


@pytest.mark.parametrize("page", ["index.html", "carte.html", "comprendre.html", "soutenir.html"])
def test_every_page_has_the_shared_chrome(page: str):
    html = (WEB / page).read_text(encoding="utf-8")
    assert {"site-header", "site-tabs"} <= ids_in(html)


def test_the_france_view_is_gone():
    """Décision du 4 nov. 2026 (spec › Points ouverts › Vue France et indice par département) :
    plus de départements colorés sur la carte ni sur l'accueil, la couche de tuiles reste visible
    à tout zoom ; `GET /departements` ne sert plus qu'au bandeau des jours et à la phrase de saison."""
    app = (WEB / "app.js").read_text(encoding="utf-8")
    today = (WEB / "today.js").read_text(encoding="utf-8")
    index = (WEB / "index.html").read_text(encoding="utf-8")
    for name in ("DEPT_ZOOM", "franceView", "paintDepts", "updateTileVisibility", "depts-line"):
        assert name not in app, name
    assert 'setLayoutProperty("T"' not in app
    assert "maplibre" not in index and "maplibregl" not in today
    assert "departements.geojson" not in today
    # le bandeau des jours garde l'indice par département, des deux côtés
    assert "/departements?" in app and "centerDept" in app and "renderDays" in app
    assert "/departements?" in today and "seasonSentence" in today
