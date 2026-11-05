"""web/groups.js : la carte lit les PMTiles par groupe (G), exécuté par node.

Spec › Points ouverts › Les clients lisent les PMTiles par groupe (5 nov. 2026) : un PNG RGBA
dont le canal i porte T × 254 de la i-ème espèce du groupe (255 = sans donnée pour ce canal,
l'alpha est une donnée) se sépare en un tableau de T par canal ; une couche lit chaque espèce dans
son G quand elle y a un canal, sinon dans son T. Sans réseau : PNG fabriqués ici avec PIL, les
mêmes octets que `tiles._png_rgba` du pipeline.
"""

from __future__ import annotations

import base64
import json
import shutil
import subprocess
from pathlib import Path

import numpy as np
import pytest
from champis_pipeline.species import load_palette
from champis_pipeline.tiles import NODATA, TILE, _png_rgba

HERE = Path(__file__).parent
DRIVER = HERE / "groups_driver.js"

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")

ENC = load_palette()["group_tile_encoding"]
CEPES = ["boletus_aereus", "boletus_edulis", "boletus_pinophilus", "boletus_reticulatus"]
GIROLLES = ["cantharellus_alborufescens", "cantharellus_cibarius", "cantharellus_pallens"]


def run(*calls: tuple[str, list]) -> list:
    payload = json.dumps([{"fn": fn, "args": args} for fn, args in calls])
    proc = subprocess.run(
        ["node", str(DRIVER)], input=payload, capture_output=True, text=True, check=True
    )
    out = json.loads(proc.stdout)
    for item in out:
        assert "error" not in item, item
    return [item["value"] for item in out]


def b64(png: bytes) -> str:
    return base64.b64encode(png).decode()


def test_palette_encoding_is_rgba_254_255():
    assert ENC == {"channels": "rgba", "scale": 254, "nodata": 255}
    assert run(("channelCount", [ENC]))[0] == 4


def test_channels_to_t_splits_a_pipeline_rgba_png():
    """Quatre canaux, dont un tout à 255 (espèce sans tuile) et un trou de nodata : chaque canal
    revient en T = octet / 254, NaN (null) là où l'octet vaut 255, l'alpha compris."""
    rng = np.random.default_rng(5)
    arr = rng.integers(0, 255, size=(TILE, TILE, 4), dtype=np.uint8)
    arr[..., 2] = NODATA  # troisième espèce : pas de tuile dans son jeu
    arr[3, 7, 0] = NODATA  # un pixel hors forêt pour la première
    arr[0, 0, 3] = 254  # alpha = T de 1,0, pas une transparence
    (ts,) = run(("channelsToT", [b64(_png_rgba(arr)), ENC]))
    assert len(ts) == 4
    for c in range(4):
        got = np.array([np.nan if v is None else v for v in ts[c]], dtype=np.float32)
        want = np.where(arr[..., c] == NODATA, np.nan, arr[..., c] / ENC["scale"]).astype(
            np.float32
        )
        np.testing.assert_array_equal(got.reshape(TILE, TILE), want)
    assert all(v is None for v in ts[2])
    assert ts[3][0] == pytest.approx(1.0)
    assert ts[0][3 * TILE + 7] is None


def test_plan_reads_the_group_once_and_falls_back_to_t():
    g_cepes = {"label": "G-cepes-aaaaaaaa-p1.0.0-d7bb9d4.pmtiles", "species": CEPES}
    g_gir = {"label": "G-girolles-bbbbbbbb-p1.0.0-d7bb9d4.pmtiles", "species": GIROLLES}
    groups = [g_cepes, g_gir]
    whole, single, mixed, none = run(
        ("plan", [CEPES, groups]),
        ("plan", [["boletus_edulis"], groups]),
        ("plan", [["boletus_edulis", "cantharellus_cibarius", "autre_espece"], groups]),
        ("plan", [CEPES, []]),
    )
    # un groupe entier : un seul fichier, les quatre canaux dans l'ordre du manifeste
    assert whole == {
        "grouped": [
            {
                "label": g_cepes["label"],
                "picks": [{"sid": s, "channel": i} for i, s in enumerate(CEPES)],
            }
        ],
        "single": [],
    }
    # une espèce seule : son canal dans le G, pas son T
    assert single["grouped"][0]["picks"] == [{"sid": "boletus_edulis", "channel": 1}]
    assert single["single"] == []
    # mixte : deux G (un canal chacun) et une espèce hors groupe dans son T
    assert [g["label"] for g in mixed["grouped"]] == [g_cepes["label"], g_gir["label"]]
    assert mixed["grouped"][1]["picks"] == [{"sid": "cantharellus_cibarius", "channel": 1}]
    assert mixed["single"] == ["autre_espece"]
    # sans G dans le manifeste (la production aujourd'hui) : tout en T
    assert none == {"grouped": [], "single": CEPES}


def test_plan_takes_the_first_file_that_carries_a_species():
    one = {"label": "G-cepes-aaaaaaaa-p1.0.0-d7bb9d4.pmtiles", "species": CEPES[:2]}
    two = {"label": "G-cepes-aaaaaaaa-p1.0.0-d7bb9d4-2.pmtiles", "species": CEPES[2:]}
    (plan,) = run(("plan", [CEPES, [one, two]]))
    assert [g["label"] for g in plan["grouped"]] == [one["label"], two["label"]]
    assert plan["grouped"][1]["picks"] == [
        {"sid": s, "channel": i} for i, s in enumerate(CEPES[2:])
    ]


def test_channel_order_matches_the_pipeline():
    """Glisser-déposer : l'ordre des canaux est l'ordre alphabétique des identifiants du groupe
    (`species.species_groups`), découpé par fichier de quatre."""
    from champis_pipeline.species import group_sets, list_species, load_species

    metas = [{"id": sid, "group": load_species(sid)["group"]} for sid in list_species()]
    shuffled = list(reversed(metas))
    calls = [("channelOrder", [gid, shuffled, part, 4]) for gid, part, _ in group_sets()]
    got = run(*calls)
    assert got == [ids for _, _, ids in group_sets()]
    (empty,) = run(("channelOrder", ["inconnu", shuffled, 1, 4]))
    assert empty == []


def test_parse_name():
    a, b, c, d = run(
        ("parseName", ["G-cepes-1a2b3c4d-p1.0.0-d7bb9d4.pmtiles"]),
        ("parseName", ["data/tiles/G-girolles-1a2b3c4d-p1.0.0-d7bb9d4-2.pmtiles"]),
        ("parseName", ["T-boletus_edulis-1a2b3c4d-p1.0.0-d7bb9d4.pmtiles"]),
        ("parseName", ["A-300m-d7bb9d4.pmtiles"]),
    )
    assert a == {"group": "cepes", "part": 1}
    assert b == {"group": "girolles", "part": 2}
    assert c is None and d is None
