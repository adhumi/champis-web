"""Vue de la carte (16 nov. 2026) : la France au premier lancement, puis la dernière vue mémorisée.

Fonctions pures de web/site.js exécutées par node (sauté sans node) : lecture, validation et
écriture de la vue gardée dans le `localStorage` du navigateur, choix de la vue d'ouverture (URL,
puis mémoire, puis France), stockage absent ou qui lève. Et un contrôle du code : le site n'écrit
dans le navigateur que cette clé, et aucun cookie.
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest
from test_site import call

HERE = Path(__file__).parent
WEB = HERE.parent
DRIVER = HERE / "vue_driver.js"
KEY = "champis.carte.vue"
BESANCON = {"zoom": 10.5, "lat": 47.24, "lon": 6.02}
STORED = '{"v":1,"zoom":10.5,"lat":47.24,"lon":6.02}'

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")


def storage(*cases: dict) -> list:
    proc = subprocess.run(
        ["node", str(DRIVER)], input=json.dumps(cases), capture_output=True, text=True, check=True
    )
    out = json.loads(proc.stdout)
    for item in out:
        assert "error" not in item, item
    return out


def consts() -> dict:
    """Constantes de site.js, lues par node."""
    script = (
        "const S = require(process.argv[1]);"
        "process.stdout.write(JSON.stringify({ key: S.VIEW_KEY, version: S.VIEW_VERSION,"
        " france: S.FRANCE_BOUNDS, limits: S.VIEW_LIMITS }));"
    )
    proc = subprocess.run(
        ["node", "-e", script, str(WEB / "site.js")], capture_output=True, text=True, check=True
    )
    return json.loads(proc.stdout)


def test_one_clearly_named_key_with_a_version():
    c = consts()
    assert (c["key"], c["version"]) == (KEY, 1)


def test_france_bounds_hold_the_whole_mainland_and_corsica():
    """L'emprise d'ouverture contient les extrémités de la métropole, Corse comprise, sans
    déborder de plus d'un demi-degré."""
    west, south, east, north = consts()["france"]
    points = {
        "Ouessant": (-5.15, 48.46),
        "Bray-Dunes": (2.55, 51.09),
        "Lauterbourg": (8.23, 48.97),
        "Cerbère": (3.17, 42.43),
        "Bonifacio": (9.16, 41.36),
        "Corse, côte orientale": (9.56, 42.28),
    }
    for name, (lon, lat) in points.items():
        assert west <= lon <= east and south <= lat <= north, name
    assert west >= -5.15 - 0.5 and east <= 9.56 + 0.5
    assert south >= 41.33 - 0.5 and north <= 51.09 + 0.5


def test_view_is_rounded_and_holds_nothing_else():
    text, roundtrip = call(
        (
            "serializeView",
            [
                {
                    "zoom": 10.123456,
                    "lat": 47.123456789,
                    "lon": 6.987654321,
                    "espece": "x",
                    "fond": 1,
                }
            ],
        ),
        ("parseView", [STORED]),
    )
    assert json.loads(text) == {"v": 1, "zoom": 10.12, "lat": 47.1235, "lon": 6.9877}
    assert roundtrip == BESANCON


def test_invalid_or_out_of_range_view_is_never_written():
    limits = consts()["limits"]
    bad = [
        None,
        "texte",
        {},
        {"zoom": 9, "lat": 47},
        {"zoom": "9", "lat": 47, "lon": 6},
        {"zoom": None, "lat": 47, "lon": 6},
        {"zoom": limits["minZoom"] - 0.01, "lat": 47, "lon": 6},
        {"zoom": limits["maxZoom"] + 0.01, "lat": 47, "lon": 6},
        {"zoom": 9, "lat": 85.06, "lon": 6},
        {"zoom": 9, "lat": -85.06, "lon": 6},
        {"zoom": 9, "lat": 47, "lon": 180.5},
        {"zoom": 9, "lat": 47, "lon": -181},
    ]
    assert call(*[("serializeView", [v]) for v in bad]) == [None] * len(bad)
    edge = {"zoom": limits["minZoom"], "lat": -85.05, "lon": 180}
    assert call(("serializeView", [edge]))[0] is not None


def test_stored_text_is_validated_before_use():
    """Texte absent, illisible, d'une autre version ou hors bornes : ignoré, jamais une erreur.
    Infinity et NaN ne s'écrivent pas en JSON : `1e999` (lu Infinity) et `null` les remplacent."""
    bad = [
        None,
        "",
        "pas du json",
        "null",
        "[]",
        "12",
        '"texte"',
        '{"zoom":10.5,"lat":47.24,"lon":6.02}',
        '{"v":2,"zoom":10.5,"lat":47.24,"lon":6.02}',
        '{"v":"1","zoom":10.5,"lat":47.24,"lon":6.02}',
        '{"v":1,"zoom":"10.5","lat":47.24,"lon":6.02}',
        '{"v":1,"zoom":10.5,"lat":null,"lon":6.02}',
        '{"v":1,"zoom":10.5,"lat":47.24}',
        '{"v":1,"zoom":1e999,"lat":47.24,"lon":6.02}',
        '{"v":1,"zoom":3.9,"lat":47.24,"lon":6.02}',
        '{"v":1,"zoom":23,"lat":47.24,"lon":6.02}',
        '{"v":1,"zoom":10.5,"lat":91,"lon":6.02}',
        '{"v":1,"zoom":10.5,"lat":47.24,"lon":999}',
        '{"v":1,"zoom":10.5,"lat":[47.24],"lon":6.02}',
    ]
    assert call(*[("parseView", [t]) for t in bad]) == [None] * len(bad)
    # ce qui est relu est arrondi et réduit aux trois nombres, quoi que porte le texte
    extra = '{"v":1,"zoom":10.50001,"lat":47.24,"lon":6.02,"__proto__":{"x":1},"autre":"x"}'
    assert call(("parseView", [extra]))[0] == BESANCON


def test_hash_position_follows_the_map_rule():
    ok, with_bearing, negative = call(
        ("hashView", ["#11/47.1/6.35"]),
        ("hashView", ["#11/47.1/6.35/20/45"]),
        ("hashView", ["#6.5/-12.5/-3"]),
    )
    assert ok == with_bearing == {"zoom": 11, "lat": 47.1, "lon": 6.35}
    assert negative == {"zoom": 6.5, "lat": -12.5, "lon": -3}
    bad = ["", "#", "#11/47.1", "#carte", "#a/b/c", "#11/47.1/x", None]
    assert call(*[("hashView", [h]) for h in bad]) == [None] * len(bad)


def test_initial_view_priority_url_then_memory_then_france():
    france = {"source": "france", "bounds": consts()["france"]}
    url, url_over_memory, memory, first, invalid, not_a_position = call(
        ("initialView", ["#11/44.1/3.58", None]),
        ("initialView", ["#11/44.1/3.58", STORED]),
        ("initialView", ["", STORED]),
        ("initialView", ["", None]),
        ("initialView", ["", '{"v":1,"zoom":99,"lat":47.24,"lon":6.02}']),
        ("initialView", ["#ancre", STORED]),
    )
    assert url == url_over_memory == {"source": "url"}
    assert memory == {"source": "memoire", **BESANCON}
    assert first == invalid == france
    # un hash qui n'est pas une position ne masque pas la vue mémorisée
    assert not_a_position == memory


def test_storage_reads_and_writes_only_the_view_key():
    empty, known, written = storage(
        {"storage": "ok"},
        {"storage": "ok", "initial": {KEY: STORED, "autre": "x"}},
        {"storage": "ok", "initial": {"autre": "x"}, "view": BESANCON},
    )
    assert empty["read"] is None
    assert known["read"] == STORED
    assert written["written"] == STORED
    assert written["data"] == {"autre": "x", KEY: STORED}
    for case in (empty, known, written):
        assert {c[1] for c in case["calls"]} == {KEY}
    # une vue invalide n'atteint pas le stockage
    (bad,) = storage({"storage": "ok", "view": {"zoom": 99, "lat": 47, "lon": 6}})
    assert bad["written"] is None and bad["data"] == {}
    assert [c[0] for c in bad["calls"]] == ["getItem"]


@pytest.mark.parametrize("kind", ["absent", "leve", "lecture", "quota"])
def test_missing_or_throwing_storage_is_silent(kind):
    """Navigation privée, quota, réglages : ni erreur ni écriture, la carte s'ouvre sur la France."""
    (case,) = storage({"storage": kind, "initial": {KEY: STORED}, "view": BESANCON})
    if kind in ("absent", "leve", "lecture"):
        assert case["read"] is None
        assert call(("initialView", ["", case["read"]]))[0]["source"] == "france"
    if kind != "lecture":
        assert case["written"] is None
    assert case["data"] == {KEY: STORED}


def test_site_stores_nothing_but_the_map_view():
    """Le site ne garde dans le navigateur que la vue de la carte : `localStorage` n'est nommé qu'à
    un endroit du code (site.js, derrière `Site.readStoredView` et `Site.storeView`, qui ne
    connaissent que VIEW_KEY), et il n'y a ni cookie, ni `sessionStorage`, ni IndexedDB, ni cache
    de service worker. Les commentaires ne comptent pas."""
    forbidden = re.compile(r"document\.cookie|sessionStorage|indexedDB|cookieStore|serviceWorker")
    uses: dict[str, int] = {}
    sources = [*sorted(WEB.glob("*.js")), *sorted(WEB.glob("*.html"))]
    assert len(sources) >= 10
    for path in sources:
        code = re.sub(r"/\*.*?\*/|<!--.*?-->", "", path.read_text(encoding="utf-8"), flags=re.S)
        code = "\n".join(re.sub(r"(^|\s)//.*$", "", line) for line in code.splitlines())
        assert not forbidden.search(code), path.name
        n = len(re.findall(r"localStorage", code))
        if n:
            uses[path.name] = n
    assert uses == {"site.js": 1}
    site = (WEB / "site.js").read_text(encoding="utf-8")
    assert "const browserStorage = () => root.localStorage;" in site
    # les deux seuls accès passent par la clé de la vue
    assert re.findall(r"storage\(\)\.(\w+)\(([^,)]+)", site) == [
        ("getItem", "VIEW_KEY"),
        ("setItem", "VIEW_KEY"),
    ]
    # et la carte ne mémorise qu'à la fin d'un déplacement
    app = (WEB / "app.js").read_text(encoding="utf-8")
    assert app.count("Site.storeView(") == 1 and app.count("Site.readStoredView(") == 1
    (handler,) = re.findall(r'map\.on\("moveend", \(e\) => \{(.*?)\n\}\);', app, flags=re.S)
    assert "rememberView(e)" in handler
    assert not re.search(r'map\.on\("(move|zoom|drag)",[^)]*rememberView', app)
