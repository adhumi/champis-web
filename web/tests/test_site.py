"""web/site.js (lot 5) : les fonctions pures du site, exécutées par node (sauté sans node).

Dates en français sans dépendre de la locale, classes depuis la palette du dépôt, phrase de saison
de l'accueil (aucune valeur inventée), rendu du Markdown de shared/texts/, adresse de l'API.
"""

from __future__ import annotations

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
    assert cls[1]["rgb"] == [0x4C, 0xA6, 0x4C]
    hi, lo, acc = call(
        ("classify", [cls, 0.8]), ("classify", [cls, 0.0]), ("accentHex", [load_palette()])
    )
    assert hi["fr"] == "Excellent" and lo["label"] == "tres_faible"
    assert acc == next(t["hex"] for t in load_palette()["thresholds"] if t["label"] == "bon")


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
    page = {"hostname": "champis.adhumi.fr", "port": "", "origin": "https://champis.adhumi.fr"}
    local = {"hostname": "localhost", "port": "3000", "origin": "http://localhost:3000"}
    same, override, other_port, dev, nodev = call(
        ("apiBase", [{**page, "search": ""}]),
        ("apiBase", [{**local, "search": "?api=https://x.test/"}]),
        ("apiBase", [{**local, "search": ""}]),
        ("isDev", ["?dev=1&x=2"]),
        ("isDev", ["?x=2"]),
    )
    assert same == "https://champis.adhumi.fr"
    assert override == "https://x.test"
    assert other_port == "http://localhost:3000"  # l'API sert la page, quel que soit le port
    assert (dev, nodev) == (True, False)
