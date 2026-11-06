"""Le référentiel adhumi/champis (sous-module `champis/`) tel que les tests du site le lisent.

Depuis le découpage des dépôts (spec › Produit › Étape C, lot C7, 6 nov. 2026), le site n'a plus
le paquet du pipeline sous la main : ces fonctions relisent les mêmes fichiers que
`champis_pipeline.species` (palette, espèces, groupes), avec les mêmes règles.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]
REFERENTIAL = Path(os.environ.get("CHAMPIS_REFERENTIAL") or ROOT / "champis")
GROUP_CHANNELS = 4  # espèces par fichier G : un canal RGBA chacune (comme le pipeline)


def _read(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_palette() -> dict[str, Any]:
    return _read(REFERENTIAL / "shared" / "palette.json")


def list_species() -> list[str]:
    return sorted(p.stem for p in (REFERENTIAL / "species").glob("*.json"))


def load_species(species_id: str) -> dict[str, Any]:
    return _read(REFERENTIAL / "species" / f"{species_id}.json")


def species_groups() -> dict[str, list[str]]:
    """`group.id` → identifiants triés : l'ordre des canaux des PMTiles G."""
    groups: dict[str, list[str]] = {}
    for sid in list_species():
        groups.setdefault(load_species(sid)["group"]["id"], []).append(sid)
    return dict(sorted(groups.items()))


def group_sets() -> list[tuple[str, int, list[str]]]:
    """Fichiers G : `(groupe, partie, espèces)`, au plus quatre espèces par fichier."""
    out = []
    for gid, ids in species_groups().items():
        for i in range(0, len(ids), GROUP_CHANNELS):
            out.append((gid, i // GROUP_CHANNELS + 1, ids[i : i + GROUP_CHANNELS]))
    return out
