"""Les PNG des tuiles, encodés exactement comme le pipeline (`champis_pipeline.tiles._png` et
`_png_rgba` dans adhumi/champis-api : Pillow, non entrelacé, `compress_level=6`), pour vérifier
que le décodeur du site les lit à l'octet près. Un changement d'encodage côté pipeline se reporte
ici dans la même foulée (contrat entre les deux dépôts depuis le découpage du 6 nov. 2026)."""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

TILE = 256
NODATA = 255


def png(arr: np.ndarray) -> bytes:
    """Gris 8 bits + alpha (0 sur nodata) → PNG."""
    alpha = np.where(arr == NODATA, 0, 255).astype(np.uint8)
    img = Image.fromarray(np.dstack([arr, alpha]), mode="LA")
    buf = io.BytesIO()
    img.save(buf, format="PNG", optimize=False, compress_level=6)
    return buf.getvalue()


def png_rgba(arr: np.ndarray) -> bytes:
    """(256, 256, 4) uint8 → PNG RGBA 8 bits non entrelacé ; chaque canal est une donnée."""
    buf = io.BytesIO()
    Image.fromarray(arr, mode="RGBA").save(buf, format="PNG", optimize=False, compress_level=6)
    return buf.getvalue()
