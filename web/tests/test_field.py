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

from referential import REFERENTIAL, load_palette

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
    # bloc de pixels partageant les mêmes poids d'interpolation : 16 px dès le zoom 12 (≈ 430 m),
    # moitié par niveau en dessous, jamais moins de 2 px
    assert run(*(("blockPx", [z]) for z in (6, 8, 9, 9.7, 10, 11, 12, 15))) == [
        2,
        2,
        2,
        2,
        4,
        8,
        16,
        16,
    ]


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
    assert got_bbox == {"count": 2, "stale": 1, "missing": 1, "day": None, "unavailable": ["c_c"]}
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


# ---------------------------------------------------------------- interpolation entre cellules

VECTORS = json.loads((REFERENTIAL / "shared" / "vectors" / "interp.json").read_text("utf-8"))


def test_interp_vectors():
    """Parité avec champis_api/interp.py (skill scoring-parity) : coins, poids et valeur."""
    cases = VECTORS["cases"]
    assert len(cases) >= 50
    out = run(*(("corners", [c["lat"], c["lon"]]) for c in cases))
    values = run(*(("interpolate", [k, c["values"]]) for k, c in zip(out, cases, strict=True)))
    for c, k, v in zip(cases, out, values, strict=True):
        exp = c["expected"]
        assert k["containing"] == exp["containing"] and k["ids"] == exp["ids"], c
        assert k["weights"] == pytest.approx(exp["weights"], abs=1e-6)
        if exp["value"] is None:
            assert v is None, c
        else:
            assert v == pytest.approx(exp["value"], abs=1e-6), c


def _cell(cid: str, lat: float, lon: float, f: float | None = None) -> dict:
    days = {} if f is None else {"e": {"2026-11-13": [f]}}
    return {
        "id": cid,
        "lat": lat,
        "lon": lon,
        "elevation_m": 150,
        "alt_classes": [150.0],
        "f": days,
    }


def test_point_factor_interpolates_loaded_neighbours():
    # premier cas du vecteur : quatre coins, valeurs 0,8 / 0,1 / 0,4 / 0,6
    c = VECTORS["cases"][0]
    cells = [_cell(cid, c["lat"], c["lon"], v) for cid, v in c["values"].items()]
    args = ["e", "2026-11-13", c["lat"], c["lon"], None, ALT]
    home = [x for x in cells if x["id"] == c["expected"]["containing"]]
    _, got, _, alone, unknown_day = run(
        ("buildIndex", [cells], "all"),
        ("pointFactor", [ref("all"), *args]),
        ("buildIndex", [home], "one"),
        ("pointFactor", [ref("one"), *args]),
        ("pointFactor", [ref("all"), "e", "2026-11-14", c["lat"], c["lon"], None, ALT]),
    )
    assert unknown_day is None
    assert got == pytest.approx(c["expected"]["value"], abs=1e-6)
    # sans voisine chargée, la valeur de la cellule se prolonge à plat
    assert alone == pytest.approx(c["values"][c["expected"]["containing"]])


def test_point_without_weather_in_its_cell_stays_empty():
    c = VECTORS["cases"][0]
    home = c["expected"]["containing"]
    others = [_cell(cid, c["lat"], c["lon"], 0.5) for cid in c["expected"]["ids"] if cid != home]
    args = ["e", "2026-11-13", c["lat"], c["lon"], None, ALT]
    closed, off_grid, no_day = run(
        # cellule du point listée sans météo par l'API : jamais la météo des voisines
        ("buildIndex", [others, [home]], "closed"),
        ("pointFactor", [ref("closed"), *args]),
        # hors grille (ni chargée ni listée) : cellule la plus proche à moins de 7,5 km
        ("buildIndex", [others], "open"),
        ("pointFactor", [ref("open"), *args]),
        # cellule du point chargée mais sans ce jour : rien, même si les voisines l'ont
        ("buildIndex", [[*others, _cell(home, c["lat"], c["lon"])]], "noday"),
        ("pointFactor", [ref("noday"), *args]),
    )[1::2]
    assert closed is None and no_day is None
    assert off_grid == pytest.approx(0.5)


def test_tile_samples_one_per_block():
    # tuile z12 autour du premier point du vecteur : chaque bloc de 16 px a son échantillon,
    # null quand aucune cellule n'est à moins de 7,5 km
    c = VECTORS["cases"][0]
    z = 12
    n = 2**z
    x = int((c["lon"] + 180) / 360 * n)
    lat = math.radians(c["lat"])
    y = int((1 - math.log(math.tan(lat) + 1 / math.cos(lat)) / math.pi) / 2 * n)
    cells = [_cell(cid, c["lat"], c["lon"], v) for cid, v in c["values"].items()]
    (_, samples, _, empty) = run(
        ("buildIndex", [cells], "index"),
        ("tileSamples", [ref("index"), z, x, y, 256, 16]),
        ("buildIndex", [[_cell("c_0100_6000", 43.0, -1.0, 0.5)]], "far"),
        ("tileSamples", [ref("far"), z, x, y, 256, 16]),
    )
    assert len(samples) == 256 and all(s is not None for s in samples)
    assert all(abs(sum(s["weights"]) - 1) < 1e-9 for s in samples if s["weights"])
    assert all(s is None for s in empty)


# ---------------------------------------------------------------- interpolation entre classes d'altitude

ALT_VECTORS = json.loads((REFERENTIAL / "shared" / "vectors" / "alt.json").read_text("utf-8"))
ELEV = {"step_m": 20, "nodata": 255}


def test_alt_vectors():
    """Parité avec `interp.between_classes` (champis-api) : altitude de la tranche, valeur."""
    cases = ALT_VECTORS["cases"]
    assert len(cases) >= 50
    calls = []
    for c in cases:
        centers = sorted(float(k) for k in c["values"])
        values = [c["values"][str(int(k))] for k in centers]
        calls.append(("elevation", [c["index"], c["step_m"]]))
        calls.append(("betweenClasses", [c["expected"]["alt_m"], centers, values]))
    out = run(*calls)
    for c, alt, value in zip(cases, out[0::2], out[1::2], strict=True):
        assert alt == c["expected"]["alt_m"], c
        if c["expected"]["value"] is None:
            assert value is None, c
        else:
            assert value == pytest.approx(c["expected"]["value"], abs=1e-6), c


def test_cell_factor_reads_altitude_from_the_fine_layer_or_the_class():
    cell = {
        "id": "c_0950_6670",
        "lat": 47.12,
        "lon": 6.32,
        "elevation_m": 500,
        "alt_classes": [450.0, 750.0, 1050.0],
        "f": {"e": {"d": [0.8, 0.5, None]}},
    }
    fine_mid, fine_centre, fine_low, fine_unknown, coarse, other_day = run(
        ("cellFactor", [cell, "e", "d", 29, ELEV]),  # 590 m : entre 450 et 750
        ("cellFactor", [cell, "e", "d", 22, ELEV]),  # 450 m : le centre de la classe
        ("cellFactor", [cell, "e", "d", 3, ELEV]),  # 70 m : à plat sous la première classe
        ("cellFactor", [cell, "e", "d", 255, ELEV]),  # inconnu : classe de l'altitude médiane
        ("cellFactor", [cell, "e", "d", 2, ALT]),  # couche A, classe 750
        ("cellFactor", [cell, "e", "x", 29, ELEV]),
    )
    assert fine_mid == pytest.approx(0.8 + (590 - 450) / 300 * (0.5 - 0.8))
    assert fine_centre == pytest.approx(0.8) and fine_low == pytest.approx(0.8)
    assert fine_unknown == pytest.approx(0.8)
    assert coarse == pytest.approx(0.5)
    assert other_day is None
    # la classe 1050 n'a pas de valeur : à plat au-dessus de 750
    assert run(("cellFactor", [cell, "e", "d", 60, ELEV])) == [pytest.approx(0.5)]
    # classe utilisée pour les phrases : la plus proche de l'altitude du pixel
    assert run(("altCenter", [cell, 29, ELEV]), ("altCenter", [cell, 31, ELEV])) == [450.0, 750.0]
