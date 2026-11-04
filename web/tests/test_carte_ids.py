"""Les identifiants que `app.js` cherche par `$("…")` existent tous dans `carte.html`.

Un identifiant manquant plante le gestionnaire au premier `null` (le 4 nov. 2026, `$("weather")`
cassait la bascule « potentiel toute saison » et laissait un patchwork T/S à l'écran).
"""

from __future__ import annotations

import re
from pathlib import Path

WEB = Path(__file__).parent.parent


def test_every_id_used_by_app_js_exists_in_carte_html():
    html = (WEB / "carte.html").read_text(encoding="utf-8")
    js = (WEB / "app.js").read_text(encoding="utf-8")
    present = set(re.findall(r'id="([^"]+)"', html))
    # identifiants créés dynamiquement par app.js ou site.js, hors du HTML statique
    dynamic = {"probe-close"}
    used = set(re.findall(r'\$\("([^"]+)"\)', js))
    assert used - present - dynamic == set()
