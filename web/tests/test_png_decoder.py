"""web/png.js décode exactement les PNG de données (tuiles T et A) : comparé octet à octet.

Le décodeur est exécuté par node (présent sur les runners CI ; test sauté sinon). Les PNG de
référence sont ceux du pipeline (`tiles._png`) et des PNG encodés ici avec chacun des cinq
filtres de ligne, pour gris, gris + alpha, RGB et RGBA.
"""

from __future__ import annotations

import base64
import json
import shutil
import struct
import subprocess
import zlib
from pathlib import Path

import numpy as np
import pytest
from champis_pipeline.tiles import NODATA, _png

HERE = Path(__file__).parent
DRIVER = HERE / "decode_driver.js"
COLOR_TYPE = {1: 0, 2: 4, 3: 2, 4: 6}  # canaux → type de couleur PNG

pytestmark = pytest.mark.skipif(shutil.which("node") is None, reason="node absent")


def _chunk(kind: bytes, payload: bytes) -> bytes:
    crc = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", crc)


def _filter_row(ftype: int, row: np.ndarray, prev: np.ndarray, bpp: int) -> np.ndarray:
    """Applique le filtre PNG `ftype` à une ligne (entiers, modulo 256)."""
    x = row.astype(np.int32)
    a = np.concatenate([np.zeros(bpp, np.int32), x[:-bpp]])
    b = prev.astype(np.int32)
    c = np.concatenate([np.zeros(bpp, np.int32), b[:-bpp]])
    if ftype == 0:
        pred = 0
    elif ftype == 1:
        pred = a
    elif ftype == 2:
        pred = b
    elif ftype == 3:
        pred = (a + b) >> 1
    else:
        p = a + b - c
        pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
        pred = np.where((pa <= pb) & (pa <= pc), a, np.where(pb <= pc, b, c))
    return ((x - pred) & 255).astype(np.uint8)


def encode_png(pixels: np.ndarray, ftype: int) -> bytes:
    """PNG 8 bits, non entrelacé, un seul filtre sur toutes les lignes ; `pixels` : (h, w, canaux)."""
    h, w, ch = pixels.shape
    stride = w * ch
    flat = pixels.reshape(h, stride)
    prev = np.zeros(stride, np.uint8)
    raw = bytearray()
    for y in range(h):
        raw.append(ftype)
        raw += _filter_row(ftype, flat[y], prev, ch).tobytes()
        prev = flat[y]
    ihdr = struct.pack(">IIBBBBB", w, h, 8, COLOR_TYPE[ch], 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", ihdr)
        + _chunk(b"IDAT", zlib.compress(bytes(raw), 6))
        + _chunk(b"IEND", b"")
    )


def decode_with_js(pngs: list[bytes]) -> list[dict]:
    payload = json.dumps([{"png": base64.b64encode(p).decode()} for p in pngs])
    res = subprocess.run(
        ["node", str(DRIVER)], input=payload, capture_output=True, text=True, check=True
    )
    return json.loads(res.stdout)


def test_pipeline_tiles_decode_exactly():
    """Les PNG LA du pipeline (valeurs 0–254, 255 → alpha 0) reviennent octet pour octet."""
    rng = np.random.default_rng(1)
    arrays = [
        rng.integers(0, 255, size=(256, 256), dtype=np.uint8),  # bruit : filtres variés
        np.tile(np.arange(256, dtype=np.uint8), (256, 1)),  # rampe horizontale
        np.full((256, 256), NODATA, np.uint8),  # tout nodata
    ]
    arrays[0][::7, ::5] = NODATA
    out = decode_with_js([_png(a) for a in arrays])
    for a, r in zip(arrays, out, strict=True):
        assert "error" not in r, r
        assert (r["width"], r["height"], r["channels"]) == (256, 256, 2)
        data = np.frombuffer(base64.b64decode(r["data"]), np.uint8).reshape(256, 256, 2)
        np.testing.assert_array_equal(data[..., 0], a)
        np.testing.assert_array_equal(data[..., 1], np.where(a == NODATA, 0, 255))


@pytest.mark.parametrize("channels", [1, 2, 3, 4])
def test_every_filter_type(channels: int):
    """Filtres None, Sub, Up, Average, Paeth sur un contenu aléatoire 37 × 23 (tailles impaires)."""
    rng = np.random.default_rng(channels)
    pixels = rng.integers(0, 256, size=(23, 37, channels), dtype=np.uint8)
    out = decode_with_js([encode_png(pixels, f) for f in range(5)])
    for f, r in enumerate(out):
        assert "error" not in r, (f, r)
        assert (r["width"], r["height"], r["channels"]) == (37, 23, channels)
        data = np.frombuffer(base64.b64decode(r["data"]), np.uint8).reshape(pixels.shape)
        np.testing.assert_array_equal(data, pixels, err_msg=f"filtre {f}")


def test_rejects_unsupported():
    """16 bits, palette ou signature fausse → erreur explicite, jamais des valeurs silencieuses."""
    good = encode_png(np.zeros((2, 2, 1), np.uint8), 0)
    sixteen = bytearray(good)
    sixteen[8 + 8 + 8] = 16  # IHDR.depth
    out = decode_with_js([b"not a png", bytes(sixteen)])
    assert "signature" in out[0]["error"]
    assert "16 bits" in out[1]["error"]
