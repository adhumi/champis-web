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


@pytest.mark.parametrize("page", ["index.html", "carte.html", "comprendre.html", "soutenir.html"])
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


def test_no_third_party_cdn():
    """Étape C, lot C1 (6 nov. 2026) : aucune page ne charge de bibliothèque depuis un tiers ;
    MapLibre et PMTiles sont servis par Champis depuis `web/vendor/`, qui existe bien."""
    for page in sorted(WEB.glob("*.html")):
        html = page.read_text(encoding="utf-8")
        assert "unpkg.com" not in html and "cdn." not in html, page.name
        for src in re.findall(r'(?:src|href)="(vendor/[^"]+)"', html):
            assert (WEB / src).is_file(), src


def test_home_page_carries_the_promise_and_keeps_old_map_links():
    """Étape C, lot C3 : l'accueil porte l'accroche décidée et la promesse, mène à la carte, et
    renvoie toujours vers la carte les anciens liens (`index.html#11/47/6`, `?tiles=…`)."""
    html = (WEB / "index.html").read_text(encoding="utf-8")
    assert "La météo des champignons, forêt par forêt." in html
    assert (
        "Où et quand poussent cèpes et girolles, forêt par forêt, jour par jour. Gratuit, sans compte."
        in html
    )
    assert 'href="carte.html"' in html
    assert 'name="robots" content="noindex"' in html
    assert 'location.replace("carte.html" + location.search + location.hash)' in html
    for article in ("cueillir-sans-nuire", "donnees-et-sources", "confidentialite"):
        assert f"comprendre.html?article={article}" in html
