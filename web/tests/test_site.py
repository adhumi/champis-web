"""web/site.js (lot 5) : les fonctions pures du site, exécutées par node (sauté sans node).

Dates en français sans dépendre de la locale, classes depuis la palette du dépôt, phrase de saison
de l'accueil (aucune valeur inventée), rendu du Markdown de shared/texts/, adresse de l'API.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import unicodedata
from pathlib import Path

import pytest

from referential import REFERENTIAL, load_palette

HERE = Path(__file__).parent
DRIVER = HERE / "site_driver.js"
ROOT = HERE.parent.parent

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")


def call(*calls: tuple[str, list]) -> list:
    payload = json.dumps([{"fn": fn, "args": args} for fn, args in calls])
    proc = subprocess.run(
        ["node", str(DRIVER)], input=payload, capture_output=True, text=True, check=True
    )
    out = json.loads(proc.stdout)
    for item in out:
        assert "error" not in item, item
    return [item["value"] for item in out]


def classes() -> list:
    return call(("sortedClasses", [load_palette()]))[0]


def test_french_dates_without_locale():
    name, short, day, plus7, minus3, today_word, other_word = call(
        ("weekdayName", ["2026-11-01"]),
        ("shortWeekday", ["2026-11-01"]),
        ("frenchDate", ["2026-11-01"]),
        ("dateFor", ["2026-11-01", 7]),
        ("dateFor", ["2026-11-01", -3]),
        ("whenWord", ["2026-11-01", "2026-11-01"]),
        ("whenWord", ["2026-11-04", "2026-11-01"]),
    )
    assert (name, short, day) == ("dimanche", "dim.", "dim. 1 nov.")
    assert (plus7, minus3) == ("2026-11-08", "2026-10-29")
    assert (today_word, other_word) == ("aujourd'hui", "mercredi")
    assert call(("dateFor", [None, 2]))[0] is None


def test_classes_follow_the_palette():
    cls = classes()
    assert [c["label"] for c in cls] == ["excellent", "bon", "moyen", "faible", "tres_faible"]
    bon = next(t["hex"] for t in load_palette()["thresholds"] if t["label"] == "bon")
    assert cls[1]["rgb"] == [int(bon[i : i + 2], 16) for i in (1, 3, 5)]
    hi, lo, acc = call(
        ("classify", [cls, 0.8]), ("classify", [cls, 0.0]), ("accentHex", [load_palette()])
    )
    assert hi["fr"] == "Excellent" and lo["label"] == "tres_faible"
    # l'accent du site est le violet de l'échelle (6 nov. 2026) ; le « Bon » sans `scale`
    assert acc == load_palette()["scale"]["hex"]
    legacy = {k: v for k, v in load_palette().items() if k != "scale"}
    assert call(("accentHex", [legacy]))[0] == bon


def test_pixel_color_matches_the_parity_vectors():
    """Échelle linéaire (6 nov. 2026) : un violet, l'alpha est le score, arrondi floor(x + 0,5),
    identique à Python (champis-api) et Swift (app) via shared/vectors/palette.json."""
    vectors = json.loads((REFERENTIAL / "shared" / "vectors" / "palette.json").read_text())
    cases = vectors["cases"]
    got = call(*(("pixelColor", [load_palette(), c["score"]]) for c in cases))
    for c, rgba in zip(cases, got, strict=True):
        assert rgba == c["expected"]["rgba"], c["score"]
    # les demi-niveaux d'arrondi sont bien couverts par les vecteurs
    assert any(abs(c["score"] - 0.5 / 255) < 1e-12 for c in cases)


def test_season_sentence_counts_departements_by_class_and_never_invents():
    cls = classes()
    base = {"groupName": "Cèpes", "iso": "2026-11-01", "today": "2026-11-01"}
    good, mid_only, nothing, unknown, other_day = call(
        ("seasonSentence", [{**base, "values": [0.9, 0.6, 0.4, 0.4, 0.1, 0.05, None]}, cls]),
        ("seasonSentence", [{**base, "values": [0.4, 0.36]}, cls]),
        ("seasonSentence", [{**base, "values": [0.1, 0.05, None]}, cls]),
        ("seasonSentence", [{**base, "values": [None, None]}, cls]),
        ("seasonSentence", [{**base, "iso": "2026-11-05", "values": [0.9]}, cls]),
    )
    assert good == (
        "Cèpes aujourd'hui : bon ou excellent dans 2 départements, "
        "moyen dans 2 départements, faible ailleurs."
    )
    assert mid_only == "Cèpes aujourd'hui : moyen dans 2 départements."
    assert nothing == "Cèpes aujourd'hui : hors saison ou météo défavorable partout."
    assert (
        unknown
        == "Cèpes aujourd'hui : pas encore d'indice, la météo du jour est en cours de calcul."
    )
    assert other_day == "Cèpes jeudi : bon ou excellent dans 1 département."


def test_markdown_rendering_matches_the_app_rules():
    md = (
        "# Titre\n\nPremière ligne\nsuite.\n\n## Section\n\n- une **puce**\n- `code` et *ital*\n\n"
        "Un [lien](https://exemple.fr/x) <b>pas de HTML</b>\n"
    )
    html, with_title, title = call(
        ("renderMarkdown", [md]),
        ("renderMarkdown", [md, {"skipTitle": False}]),
        ("markdownTitle", [md]),
    )
    assert html == (
        "<p>Première ligne suite.</p>\n<h2>Section</h2>\n"
        "<ul><li>une <strong>puce</strong></li><li><code>code</code> et <em>ital</em></li></ul>\n"
        '<p>Un <a href="https://exemple.fr/x" rel="noopener">lien</a> &lt;b&gt;pas de HTML&lt;/b&gt;</p>'
    )
    assert with_title.startswith("<h1>Titre</h1>")
    assert title == "Titre"


def test_shared_texts_render_without_error():
    texts = REFERENTIAL / "shared" / "texts"
    index = json.loads((texts / "index.json").read_text(encoding="utf-8"))
    bodies = [(texts / a["file"]).read_text(encoding="utf-8") for a in index["articles"]]
    rendered = call(*[("renderMarkdown", [b]) for b in bodies])
    titles = call(*[("markdownTitle", [b]) for b in bodies])
    assert titles == [a["title"] for a in index["articles"]]
    for html in rendered:
        assert html.startswith("<p>") or html.startswith("<h2>"), html[:40]
        assert "<h1>" not in html


def test_api_base_and_dev_flag():
    """Découpage des dépôts (6 nov. 2026) : le site sur champis.app appelle api.champis.app ; en
    local, l'API de `make serve` sur le port 8000 ; `?api=` l'emporte toujours."""
    page = {"hostname": "champis.app", "protocol": "https:", "origin": "https://champis.app"}
    local = {"hostname": "localhost", "protocol": "http:", "origin": "http://localhost:3000"}
    prod, override, dev_api, dev, nodev = call(
        ("apiBase", [{**page, "search": ""}]),
        ("apiBase", [{**local, "search": "?api=https://x.test/"}]),
        ("apiBase", [{**local, "search": ""}]),
        ("isDev", ["?dev=1&x=2"]),
        ("isDev", ["?x=2"]),
    )
    assert prod == "https://api.champis.app"
    assert override == "https://x.test"
    assert dev_api == "http://localhost:8000"
    assert (dev, nodev) == (True, False)


def test_short_date_and_today_line_in_paris_time():
    """Étape A (6 nov. 2026) : « sam. 7 » sous une pastille, et la ligne sous la carte qui dit
    l'heure de calcul de la météo en heure de Paris, quel que soit le fuseau du navigateur."""
    short, same_day, day_before, line, line_bare, bad = call(
        ("shortDate", ["2026-11-07"]),
        ("computedPhrase", ["2026-11-06T02:17:55+00:00", "2026-11-06"]),
        ("computedPhrase", ["2026-11-05T15:05:00+00:00", "2026-11-06"]),
        ("todayLine", ["2026-11-06", "2026-11-06T02:17:55+00:00"]),
        ("todayLine", ["2026-11-06", None]),
        ("computedPhrase", ["pas une date", "2026-11-06"]),
    )
    assert short == "sam. 7"
    assert same_day == "météo calculée à 3 h"  # 2 h UTC = 3 h à Paris en novembre
    assert day_before == "météo calculée le jeu. 5 nov. à 16 h"
    assert line == "Aujourd'hui, ven. 6 nov. · météo calculée à 3 h"
    assert line_bare == "Aujourd'hui, ven. 6 nov."
    assert bad is None
    # heure d'été : 2 h UTC = 4 h à Paris
    assert (
        call(("computedPhrase", ["2026-07-01T02:00:00+00:00", "2026-07-01"]))[0]
        == "météo calculée à 4 h"
    )


def test_app_line_stays_hidden_until_the_apps_are_published():
    assert call(("esc", [""]))[0] == ""
    driver = (HERE.parent / "site.js").read_text(encoding="utf-8")
    assert "const APP_LINE = null;" in driver


def test_trend_of_a_point_names_the_best_day_ahead_or_says_stable():
    """Étape B2 (6 nov. 2026) : sous les onze jours de la fiche, « mieux samedi 7 » quand un jour à
    venir passe « bon » et dépasse nettement aujourd'hui, sinon « stable » ou « en baisse »."""
    good = 0.55

    def days(values):
        return [{"iso": f"2026-11-{6 + k:02d}", "value": v} for k, v in enumerate(values, start=0)]

    better, small_gain, falling, stable, no_today, no_future = call(
        ("trend", [days([0.30, 0.40, 0.62, 0.50]), "2026-11-06", good]),
        ("trend", [days([0.30, 0.50, 0.33]), "2026-11-06", good]),  # mieux, mais pas « bon »
        ("trend", [days([0.60, 0.40, 0.30]), "2026-11-06", good]),
        ("trend", [days([0.60, 0.62, 0.58]), "2026-11-06", good]),
        ("trend", [days([None, 0.70]), "2026-11-06", good]),
        ("trend", [days([0.40, None, None]), "2026-11-06", good]),
    )
    assert better == {"kind": "better", "iso": "2026-11-08"}
    assert small_gain == {"kind": "stable"}
    assert falling == {"kind": "falling"}
    assert stable == {"kind": "stable"}
    assert no_today == no_future == {"kind": "unknown"}
    phrases = call(
        ("trendPhrase", [better]),
        ("trendPhrase", [stable]),
        ("trendPhrase", [falling]),
        ("trendPhrase", [no_today]),
    )
    assert phrases == ["mieux dimanche 8", "stable toute la semaine", "en baisse", None]


def test_commune_search_uses_the_ign_geocoder():
    """Étape B3 : recherche de commune par le géocodage de l'IGN (même hôte que le fond de carte)."""
    url, found, empty = call(
        ("geocodeUrl", ["Pontarlier"]),
        (
            "geocodeResults",
            [
                {
                    "features": [
                        {
                            "geometry": {"type": "Point", "coordinates": [6.354, 46.904]},
                            "properties": {"label": "Pontarlier", "context": "25, Doubs"},
                        }
                    ]
                }
            ],
        ),
        ("geocodeResults", [{}]),
    )
    assert url.startswith("https://data.geopf.fr/geocodage/search?")
    assert "q=Pontarlier" in url and "type=municipality" in url
    assert found == [{"label": "Pontarlier", "context": "25, Doubs", "lon": 6.354, "lat": 46.904}]
    assert empty == []


def test_forest_status_from_the_onf_public_forests_layer():
    """Étape B5 : forêt domaniale, autre forêt publique, ou sans doute privée ; la requête WFS
    porte sur un carré minuscule autour du point, en latitude puis longitude (EPSG:4326)."""
    url, domaniale, communale, private = call(
        ("forestUrl", [46.9, 6.35]),
        (
            "forestPhrase",
            [
                {
                    "features": [
                        {"properties": {"llib_frt": "Forêt domaniale du Risoux", "cdom_frt": "OUI"}}
                    ]
                }
            ],
        ),
        (
            "forestPhrase",
            [
                {
                    "features": [
                        {"properties": {"llib_frt": "Forêt communale de Mouthe", "cdom_frt": "NON"}}
                    ]
                }
            ],
        ),
        ("forestPhrase", [{"features": []}]),
    )
    assert url.startswith("https://data.geopf.fr/wfs/ows?")
    assert "TYPENAMES=ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES" in url
    bbox = url.split("BBOX=")[1].split(",")
    lat_min, lon_min, lat_max, lon_max = map(float, bbox[:4])
    assert lat_min < 46.9 < lat_max and lon_min < 6.35 < lon_max
    assert lat_max - lat_min < 1e-4
    assert bbox[4] == "urn:ogc:def:crs:EPSG::4326"
    assert (
        domaniale
        == "Forêt domaniale du Risoux : forêt domaniale, cueillette familiale tolérée, sauf arrêté"
    )
    assert communale.startswith("Forêt communale de Mouthe : forêt publique")
    assert private.startswith("Pas une forêt publique connue")


def test_markdown_links_accept_mail_addresses():
    """Étape C, lot C1 : l'adresse de contact des textes légaux est un lien `mailto:` ; un lien
    vers autre chose qu'`http(s)` ou `mailto` reste du texte."""
    mail, other = call(
        ("inline", ["Contact : [hello@champis.app](mailto:hello@champis.app)."]),
        ("inline", ["[clic](javascript:alert(1))"]),
    )
    assert (
        mail == 'Contact : <a href="mailto:hello@champis.app" rel="noopener">hello@champis.app</a>.'
    )
    assert "<a" not in other


def test_contact_address_is_the_one_of_the_legal_notice():
    """Le lien « Contact » du pied de page et les mentions légales donnent la même adresse."""
    source = (HERE.parent / "site.js").read_text(encoding="utf-8")
    assert 'const CONTACT_EMAIL = "hello@champis.app";' in source
    assert 'href="mailto:${CONTACT_EMAIL}"' in source
    legal = (REFERENTIAL / "shared" / "texts" / "mentions-legales.md").read_text(encoding="utf-8")
    assert "hello@champis.app" in legal


def _plain(text: str) -> str:
    """Clé de tri sans accents ni casse, comme `localeCompare(…, "fr")` pour ces noms."""
    return "".join(
        c for c in unicodedata.normalize("NFD", text) if not unicodedata.combining(c)
    ).casefold()


def test_layer_items_for_the_species_picker():
    """Sélecteur d'espèce de la carte (9 nov. 2026) : les groupes d'abord, avec leurs genres
    (« Boletus spp. ») et la planche d'une de leurs espèces, puis les espèces par nom français,
    chacune avec son nom latin et sa propre planche (shared/illustrations/<id>.jpg)."""
    species = [
        json.loads(p.read_text(encoding="utf-8"))
        for p in sorted((REFERENTIAL / "species").glob("*.json"))
    ]
    items = call(("layerItems", [species]))[0]
    groups = [it for it in items if it["spp"]]
    singles = [it for it in items if not it["spp"]]
    assert items == groups + singles
    assert len(singles) == len(species)
    assert {g["value"] for g in groups} == {f"g:{s['group']['id']}" for s in species}
    frs = [it["fr"] for it in singles]
    assert frs == sorted(frs, key=_plain)
    illustrations = REFERENTIAL / "shared" / "illustrations"
    by_id = {s["id"]: s for s in species}
    for it in items:
        assert (illustrations / f"{it['illustration']}.jpg").is_file(), it
        member = by_id[it["illustration"]]
        if it["spp"]:
            assert it["value"] == f"g:{member['group']['id']}"
            genera = sorted(
                {
                    s["names"]["la"].split()[0]
                    for s in species
                    if s["group"]["id"] == member["group"]["id"]
                }
            )
            assert it["la"] == ", ".join(genera)
        else:
            assert it["value"] == f"s:{member['id']}"
            assert (it["fr"], it["la"]) == (member["names"]["fr"], member["names"]["la"])


def test_layer_items_without_group_or_latin_name():
    items = call(
        (
            "layerItems",
            [[{"id": "x_y", "names": {"fr": "Espèce seule", "la": ""}, "group": None}]],
        )
    )[0]
    assert items == [
        {"value": "s:x_y", "fr": "Espèce seule", "la": "", "spp": False, "illustration": "x_y"}
    ]
