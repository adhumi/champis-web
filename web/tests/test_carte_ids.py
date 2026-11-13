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


def test_maplibre_is_the_vendored_es_module():
    """MapLibre GL JS 6 n'existe qu'en module ES : `maplibre.js` l'importe depuis `web/vendor/` et
    le pose en global ; carte.html le charge avant ses scripts, tous différés pour s'exécuter après
    lui. Le worker est le fichier voisin du module, que MapLibre charge par son adresse."""
    shim = (WEB / "maplibre.js").read_text(encoding="utf-8")
    (module,) = re.findall(r'from "\./(vendor/[^"]+)"', shim)
    assert (WEB / module).is_file(), module
    assert (WEB / module).with_name("maplibre-gl-worker.mjs").is_file()
    assert "globalThis.maplibregl = maplibregl" in shim
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    scripts = re.findall(r"<script([^>]*)>", html)
    assert 'type="module" src="maplibre.js"' in scripts[0]
    assert all(" defer " in s for s in scripts[1:]), scripts
    # la feuille de style vient du même dossier versionné que le module
    assert f'href="{module.rsplit("/", 1)[0]}/maplibre-gl.css"' in html


@pytest.mark.parametrize("page", sorted(p.name for p in WEB.glob("*.html")))
def test_no_inline_script_nor_inline_handler(page: str):
    """La CSP du site (`script-src 'self'`, Caddyfile) refuse tout script en ligne : chaque balise
    `<script>` a un `src` local, aucun attribut `on…=`, aucun lien `javascript:`."""
    html = (WEB / page).read_text(encoding="utf-8")
    for attrs, body in re.findall(r"<script([^>]*)>(.*?)</script>", html, re.S):
        src = re.search(r'src="([^"]+)"', attrs)
        assert src and body.strip() == "", (page, attrs, body[:60])
        assert not re.match(r"^(?:[a-z]+:)?//", src.group(1)), src.group(1)
        assert (WEB / src.group(1)).is_file(), src.group(1)
    assert not re.search(r"<[^>]+\son[a-z]+\s*=", html), page
    assert "javascript:" not in html


def test_the_caddyfile_sends_the_security_headers():
    """En-têtes du 13 nov. 2026 : HSTS, Permissions-Policy (la géolocalisation pour « me
    localiser », rien d'autre) et une CSP dont les seuls hôtes tiers sont ceux que le code joint :
    l'API, la Géoplateforme de l'IGN et OpenStreetMap."""
    caddy = (WEB.parent / "Caddyfile").read_text(encoding="utf-8")
    assert 'Strict-Transport-Security "max-age=31536000; includeSubDomains"' in caddy
    assert 'Permissions-Policy "geolocation=(self)"' in caddy
    (csp,) = re.findall(r'Content-Security-Policy "([^"]+)"', caddy)
    policy = {d.split()[0]: d.split()[1:] for d in csp.split(";") if d.strip()}
    assert policy["default-src"] == ["'self'"]
    assert policy["script-src"] == ["'self'"]
    assert policy["worker-src"] == ["'self'"]
    assert policy["object-src"] == policy["frame-ancestors"] == ["'none'"]
    assert policy["base-uri"] == policy["form-action"] == ["'self'"]
    hosts = {h for values in policy.values() for h in values if h.startswith("http")}
    site = (WEB / "site.js").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")
    called = set(re.findall(r'"(https://[a-z0-9.-]+)', site + app))
    assert (
        hosts
        == called
        == {
            "https://api.champis.app",
            "https://data.geopf.fr",
            "https://tile.openstreetmap.org",
        }
    )
    assert set(policy["connect-src"]) == {"'self'"} | hosts
    for values in policy.values():
        assert "'unsafe-eval'" not in values and "*" not in values
    assert "'unsafe-inline'" not in policy["script-src"]


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
    redirect = (WEB / "anciens-liens.js").read_text(encoding="utf-8")
    assert '<script src="anciens-liens.js"></script>' in html.split("</head>")[0]
    assert 'location.replace("carte.html" + location.search + location.hash)' in redirect
    for article in ("cueillir-sans-nuire", "donnees-et-sources", "confidentialite"):
        assert f"comprendre.html?article={article}" in html


def test_map_bar_carries_picker_and_search_and_the_map_carries_the_basemap():
    """Carte du 9 nov. 2026 : la recherche et le sélecteur d'espèce (liste illustrée, plus de
    `<select>`) sont dans la barre de navigation flottante ; le fond de carte est un bouton des
    commandes de la carte, sous « me localiser » ; le potentiel toute saison n'est plus proposé."""
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    app = (WEB / "app.js").read_text(encoding="utf-8")
    header = html[html.index('<header id="site-header"') : html.index("</header>")]
    for needed in (
        'class="nav-tools"',
        'id="layer"',
        'role="listbox"',
        'id="search"',
        'id="search-open"',
    ):
        assert needed in header, needed
    assert "<select" not in html
    for gone in ('id="potential"', 'id="basemap"', "toute saison", 'id="mobile-controls"'):
        assert gone not in html, gone
    assert "mode()" not in app and '$("potential")' not in app
    geolocate = app.index("new maplibregl.GeolocateControl")
    assert geolocate < app.index("new BasemapControl()") < app.index("new LegendControl()")
    assert "shared/illustrations/" in app and "Site.layerItems" in app


def test_support_links_follow_one_switch():
    """« Soutenir » masqué le 9 nov. 2026 jusqu'à sa réactivation : un seul interrupteur,
    `SUPPORT_VISIBLE` dans site.js, retire l'entrée de l'en-tête, des onglets, du pied de page, et
    les liens marqués `data-support` ou conditionnés dans les pages."""
    site = (WEB / "site.js").read_text(encoding="utf-8")
    assert re.search(r"const SUPPORT_VISIBLE = (true|false);", site)
    for page in sorted(WEB.glob("*.html")):
        html = page.read_text(encoding="utf-8")
        for m in re.finditer(r'<a href="soutenir\.html"', html):
            before = html[: m.start()]
            assert before.rfind("<span data-support>") > before.rfind("</span>"), page.name
    guide = (WEB / "comprendre.js").read_text(encoding="utf-8")
    assert "soutenir.html" not in guide or "Site.SUPPORT_VISIBLE" in guide


def test_the_map_has_no_sidebar():
    """9 nov. 2026 : plus de barre latérale sur ordinateur ; la légende s'ouvre au bouton des
    commandes de la carte, comme sur téléphone, et la fiche flotte."""
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    assert "--panel-w" not in html and "border-left" not in html
    assert "#panel { display: contents; }" in html
