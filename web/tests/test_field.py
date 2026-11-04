"""web/field.js : la météo de la carte sous et au-dessus du zoom 9, exécutée par node.

Spec › Points ouverts › Carte visible dès l'ouverture, sous le zoom 9 (4 nov. 2026) : sous
FIELD_ZOOM la météo vient de `/weather/field` (un jour, M_eff × Φ déjà multiplié, sans plafond
de cellules), au-dessus de `/weather/bbox` (onze jours). Les deux réponses se fusionnent dans la
même structure de cellules ; la cellule la plus proche se cherche dans un index par casiers de
0,05° ; un pixel sans cellule à moins de 7,5 km n'a pas de météo. Sans réseau : fixtures
synthétiques, et la grille de test est brute-forcée en Python pour contrôler l'index.
"""

from __future__ import annotations

import json
import math
import random
import shutil
import subprocess
from pathlib import Path

import pytest
from champis_pipeline.species import load_palette

HERE = Path(__file__).parent
DRIVER = HERE / "field_driver.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")

ALT = {"class_m": 300, "nodata": 255}


def run(*calls: tuple) -> list:
    """Chaque appel : (fn, args) ou (fn, args, nom) pour réutiliser le résultat par {"$ref": nom}."""
    payload = json.dumps(
        [{"fn": c[0], "args": c[1], "as": c[2] if len(c) > 2 else None} for c in calls]
    )
    proc = subprocess.run(
        ["node", str(DRIVER)], input=payload, capture_output=True, text=True, check=True
    )
    out = json.loads(proc.stdout)
    for item in out:
        assert "error" not in item, item
    return [item["value"] for item in out]


def ref(name: str) -> dict:
    return {"$ref": name}


# ---------------------------------------------------------------- fixtures synthétiques

BBOX = {
    "today": "2026-11-04",
    "cells": [
        {
            "cell": {
                "id": "c_a",
                "lat": 47.0,
                "lon": 6.3,
                "alt_classes": [150.0, 450.0],
                "elevation_m": 222.0,
            },
            "stale": False,
            "species": {
                "boletus_edulis": [
                    {
                        "date": "2026-11-04",
                        "by_alt": {
                            "150": {"M": 0.5, "M_eff": 0.8, "phi": 0.5},
                            "450": {"M": 0.5, "M_eff": 0.6, "phi": 1.0},
                        },
                    },
                    {"date": "2026-11-05", "by_alt": {"150": {"M": 0.5, "M_eff": 0.9, "phi": 1.0}}},
                ]
            },
        },
        {
            "cell": {
                "id": "c_b",
                "lat": 47.0,
                "lon": 6.4,
                "alt_classes": [150.0],
                "elevation_m": 100.0,
            },
            "stale": True,
            "species": {
                "boletus_edulis": [
                    {"date": "2026-11-04", "by_alt": {"150": {"M": 0.2, "M_eff": 0.2, "phi": 1.0}}}
                ]
            },
        },
    ],
    "unavailable": ["c_c"],
    "retry_after": 30,
}

FIELD = {
    "today": "2026-11-04",
    "computed_at": "2026-11-04T14:15:24+00:00",
    "day": "2026-11-06",
    "scoring_version": "1.0.0",
    "cells": [
        {
            "id": "c_a",
            "lat": 47.0,
            "lon": 6.3,
            "elevation_m": 222.0,
            "alt_classes": [150.0, 450.0],
            "f": {"boletus_edulis": {"150": 0.152, "450": 0.118}},
        },
        {
            "id": "c_d",
            "lat": 47.1,
            "lon": 6.3,
            "elevation_m": 300.0,
            "alt_classes": [150.0],
            "stale": True,
            "f": {"boletus_edulis": {"150": 0.79}, "boletus_aereus": {"150": 0.3}},
        },
    ],
    "unavailable": 2,
}


# ---------------------------------------------------------------- source selon le zoom, couverture


def test_field_below_zoom_9_and_bbox_above():
    assert run(("weatherSource", [8.99]), ("weatherSource", [9]), ("weatherSource", [14])) == [
        "field",
        "bbox",
        "bbox",
    ]
    # bloc de pixels partageant une cellule : 16 px dès le zoom 9, moitié par niveau en dessous
    assert run(*(("blockPx", [z]) for z in (6, 6.7, 7, 8, 9, 12))) == [2, 2, 4, 8, 16, 16]


def test_coverage_rule_same_layer_contained_box_and_ttl():
    c = {"box": [5.0, 46.0, 7.0, 48.0], "key": "g:cepes", "at": 1000}
    ttl = 30 * 60 * 1000
    inside, other_key, outside, expired, none = run(
        ("covers", [c, [5.5, 46.5, 6.5, 47.5], "g:cepes", 2000, ttl]),
        ("covers", [c, [5.5, 46.5, 6.5, 47.5], "s:boletus_edulis", 2000, ttl]),
        ("covers", [c, [4.9, 46.5, 6.5, 47.5], "g:cepes", 2000, ttl]),
        ("covers", [c, [5.5, 46.5, 6.5, 47.5], "g:cepes", 1000 + ttl + 1, ttl]),
        ("covers", [None, [5.5, 46.5, 6.5, 47.5], "g:cepes", 2000, ttl]),
    )
    assert (inside, other_key, outside, expired, none) == (True, False, False, False, False)


def test_local_today_is_an_iso_day():
    (day,) = run(("localToday", []))
    assert len(day) == 10 and day[4] == "-" and day[7] == "-"


# ---------------------------------------------------------------- fusion bbox + field


def test_bbox_and_field_merge_into_the_same_cells_and_factor_reads_both():
    _, got_bbox, got_field, n, a, d, *factors = run(
        ("@map", [], "cells"),
        ("mergeBbox", [ref("cells"), BBOX]),
        ("mergeField", [ref("cells"), FIELD]),
        ("@size", [ref("cells")]),
        ("@get", [ref("cells"), "c_a"], "a"),
        ("@get", [ref("cells"), "c_d"], "d"),
        # bbox : M_eff × Φ, par classe ; jour sans la classe 450 → null ; jour inconnu → null
        ("factor", [ref("a"), "boletus_edulis", "2026-11-04", 150]),
        ("factor", [ref("a"), "boletus_edulis", "2026-11-04", 450]),
        ("factor", [ref("a"), "boletus_edulis", "2026-11-05", 450]),
        ("factor", [ref("a"), "boletus_edulis", "2026-11-07", 150]),
        ("factor", [ref("a"), "cantharellus_cibarius", "2026-11-04", 150]),
        # field : le facteur tel quel, ajouté aux jours de bbox sans les effacer
        ("factor", [ref("a"), "boletus_edulis", "2026-11-06", 150]),
        ("factor", [ref("a"), "boletus_edulis", "2026-11-06", 450]),
        ("factor", [ref("d"), "boletus_aereus", "2026-11-06", 150]),
        # classe que l'API n'a pas calculée pour la cellule
        ("factor", [ref("d"), "boletus_edulis", "2026-11-06", 450]),
    )
    assert got_bbox == {"count": 2, "stale": 1, "missing": 1, "day": None}
    assert got_field == {"count": 2, "stale": 1, "missing": 2, "day": "2026-11-06"}
    assert n == 3  # c_a fusionnée, c_b (bbox seul), c_d (field seul) ; c_c manquante n'existe pas
    assert factors == [
        pytest.approx(0.4),
        pytest.approx(0.6),
        None,
        None,
        None,
        pytest.approx(0.152),
        pytest.approx(0.118),
        pytest.approx(0.3),
        None,
    ]
    assert a["stale"] is False and d["stale"] is True
    assert a["alt_classes"] == [150.0, 450.0] and a["elevation_m"] == 222.0
    assert set(a["f"]["boletus_edulis"]) == {"2026-11-04", "2026-11-05", "2026-11-06"}


def test_a_fresher_bbox_replaces_the_days_of_a_species_but_keeps_other_cells():
    later = {
        **BBOX,
        "cells": [{**BBOX["cells"][0], "stale": True}],
        "unavailable": [],
    }
    _, _, _, got, n, f_unknown, stale = run(
        ("@map", [], "cells"),
        ("mergeField", [ref("cells"), FIELD]),
        ("mergeBbox", [ref("cells"), BBOX]),
        ("mergeBbox", [ref("cells"), later]),
        ("@size", [ref("cells")]),
        ("factor", [{"alt_classes": [150.0], "f": {}}, "x", "2026-11-04", 150]),
        ("@get", [ref("cells"), "c_a"]),
    )
    assert got["missing"] == 0 and n == 3
    assert f_unknown is None
    assert stale["stale"] is True
    # le jour du champ (J+2) n'est pas dans cette réponse bbox : il est remplacé pour l'espèce
    assert "2026-11-06" not in stale["f"]["boletus_edulis"]


# ---------------------------------------------------------------- classe d'altitude du pixel


def test_alt_center_picks_the_pixel_class_or_the_cell_median():
    cell = {"alt_classes": [150.0, 450.0], "elevation_m": 222.0}
    assert run(
        ("altCenter", [cell, 0, ALT]),
        ("altCenter", [cell, 1, ALT]),
        ("altCenter", [cell, 3, ALT]),  # 1 050 m : la classe calculée la plus proche
        ("altCenter", [cell, None, ALT]),  # sans couche A : médiane de la cellule
        ("altCenter", [cell, 255, ALT]),  # nodata de la couche A : idem
    ) == [150.0, 450.0, 450.0, 150.0, 150.0]
    enc = load_palette()["alt_encoding"]
    assert (enc["class_m"], enc["nodata"]) == (ALT["class_m"], ALT["nodata"])


# ---------------------------------------------------------------- index spatial


def grid_cells(n_lat: int, n_lon: int, lat0=46.0, lon0=5.0, step_km=5.0) -> list[dict]:
    cells = []
    for i in range(n_lat):
        for j in range(n_lon):
            lat = lat0 + i * step_km / 111.2
            lon = lon0 + j * step_km / (111.2 * math.cos(math.radians(lat)))
            cells.append(
                {"id": f"c_{i}_{j}", "lat": lat, "lon": lon, "alt_classes": [150.0], "f": {}}
            )
    return cells


def brute_nearest(cells: list[dict], lat: float, lon: float, max_km=7.5) -> str | None:
    k = math.cos(math.radians(lat))
    best, best_d = None, (max_km / 111.2) ** 2
    for c in cells:
        d = (c["lat"] - lat) ** 2 + ((c["lon"] - lon) * k) ** 2
        if d < best_d:
            best, best_d = c["id"], d
    return best


def test_nearest_cell_matches_brute_force_and_stops_at_7_5_km():
    cells = grid_cells(12, 12)
    # trous dans la grille (pas de forêt, ou cellule `unavailable` absente de la réponse)
    cells = [c for c in cells if c["id"] not in {"c_5_5", "c_5_6", "c_6_5", "c_6_6"}]
    rng = random.Random(4)
    points = [(46.0 + rng.random() * 0.6, 4.9 + rng.random() * 0.9) for _ in range(200)]
    # un point juste sous 7,5 km d'une cellule isolée, un juste au-delà
    far = grid_cells(1, 1, lat0=48.0, lon0=1.0)[0]
    cells.append(far)
    points += [(far["lat"] + 7.4 / 111.2, far["lon"]), (far["lat"] + 7.6 / 111.2, far["lon"])]
    index_size, *found = run(
        ("buildIndex", [cells], "index"),
        *(("nearestCell", [ref("index"), lat, lon]) for lat, lon in points),
    )
    assert index_size == {"size": len(cells)}
    got = [c["id"] if c else None for c in found]
    assert got == [brute_nearest(cells, lat, lon) for lat, lon in points]
    assert got[-2] == far["id"] and got[-1] is None
    assert None in got  # le trou de 10 km au centre de la grille reste sans météo


def test_nearest_cell_without_index_is_null():
    assert run(("nearestCell", [None, 47.0, 6.3])) == [None]


def test_tile_cells_share_one_lookup_per_block():
    # tuile z9 contenant 6,3° E 47° N ; la seule cellule est au centre d'un bloc : les blocs à
    # moins de 7,5 km l'ont, les coins de la tuile (≈ 35 km) non
    z = 9
    n = 2**z
    x = int((6.3 + 180) / 360 * n)
    lat = math.radians(47.0)
    y = int((1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * n)
    (lon_c, lat_c), (lon_tl, lat_tl), (lon_br, lat_br) = run(
        ("tilePixelToLngLat", [z, x, y, 128, 128, 256]),
        ("tilePixelToLngLat", [z, x, y, 0, 0, 256]),
        ("tilePixelToLngLat", [z, x, y, 256, 256, 256]),
    )
    assert lon_tl < lon_c < lon_br and lat_br < lat_c < lat_tl
    cell = {"id": "c", "lat": lat_c, "lon": lon_c, "alt_classes": [150.0], "f": {}}
    (_, blocks) = run(
        ("buildIndex", [[cell]], "index"), ("tileCells", [ref("index"), z, x, y, 256, 16])
    )
    assert len(blocks) == 256
    assert blocks[8 * 16 + 8]["id"] == "c"
    assert blocks[0] is None and blocks[-1] is None
    assert 0 < sum(b is not None for b in blocks) < 256
