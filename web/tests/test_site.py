"""web/site.js (lot 5) : les fonctions pures du site, exécutées par node (sauté sans node).

Dates en français sans dépendre de la locale, classes depuis la palette du dépôt, phrase de saison
de l'accueil (aucune valeur inventée), rendu du Markdown de shared/texts/, adresse de l'API.
"""

from __future__ import annotations

import itertools
import json
import shutil
import subprocess
from pathlib import Path

import pytest
from champis_pipeline.species import load_palette

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
    hi, lo, day, night = call(
        ("classify", [cls, 0.8]),
        ("classify", [cls, 0.0]),
        ("accentHex", [load_palette()]),
        ("accentHex", [load_palette(), True]),
    )
    assert hi["fr"] == "Excellent" and lo["label"] == "tres_faible"
    # étape B1 : accent foncé en mode clair (la classe du haut), clair en mode sombre, sans alpha
    excellent = next(t["hex"] for t in load_palette()["thresholds"] if t["label"] == "excellent")
    assert day == excellent[:7] and len(night) == 7


def test_palette_carries_its_opacity_and_very_low_is_transparent():
    """Étape B1 (6 nov. 2026) : l'opacité de chaque classe est dans le hex (#RRGGBBAA), elle
    croît avec le score, et « très faible » est transparent : la carte ne montre que le signal."""
    cls = classes()
    alphas = {c["label"]: c["rgba"][3] for c in cls}
    assert alphas["tres_faible"] == 0
    order = ["faible", "moyen", "bon", "excellent"]
    assert all(alphas[a] < alphas[b] for a, b in itertools.pairwise(order))
    assert call(("hexToRgba", ["#112233"]))[0] == [0x11, 0x22, 0x33, 255]
    assert call(("hexToRgba", ["#11223380"]))[0] == [0x11, 0x22, 0x33, 0x80]


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
    texts = ROOT / "shared" / "texts"
    index = json.loads((texts / "index.json").read_text(encoding="utf-8"))
    bodies = [(texts / a["file"]).read_text(encoding="utf-8") for a in index["articles"]]
    rendered = call(*[("renderMarkdown", [b]) for b in bodies])
    titles = call(*[("markdownTitle", [b]) for b in bodies])
    assert titles == [a["title"] for a in index["articles"]]
    for html in rendered:
        assert html.startswith("<p>") or html.startswith("<h2>"), html[:40]
        assert "<h1>" not in html


def test_api_base_and_dev_flag():
    page = {"hostname": "champis.app", "port": "", "origin": "https://champis.app"}
    local = {"hostname": "localhost", "port": "3000", "origin": "http://localhost:3000"}
    same, override, other_port, dev, nodev = call(
        ("apiBase", [{**page, "search": ""}]),
        ("apiBase", [{**local, "search": "?api=https://x.test/"}]),
        ("apiBase", [{**local, "search": ""}]),
        ("isDev", ["?dev=1&x=2"]),
        ("isDev", ["?x=2"]),
    )
    assert same == "https://champis.app"
    assert override == "https://x.test"
    assert other_port == "http://localhost:3000"  # l'API sert la page, quel que soit le port
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
