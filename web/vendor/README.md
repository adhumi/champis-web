# Bibliothèques servies par Champis

Étape C, lot C1 (6 nov. 2026) : la carte ne charge plus rien depuis un CDN tiers (unpkg). Les deux
bibliothèques sont copiées telles quelles depuis le registre npm, empreintes vérifiées contre
`npm view <paquet> dist.integrity`.

| Dossier | Paquet | Licence | Empreinte de l'archive npm |
| --- | --- | --- | --- |
| `maplibre-gl-4.7.1/` | `maplibre-gl@4.7.1` (`dist/maplibre-gl.js`, `dist/maplibre-gl.css`) | BSD-3-Clause, `LICENSE.txt` joint | `sha512-lgL7XpIwsgICiL82ITplfS7IGwrB1OJIw/pCvprDp2dhmSSEBgmPzYRvwYYYvJGJD7fxUv1Tvpih4nZ6VrLuaA==` |
| `pmtiles-3.2.1/` | `pmtiles@3.2.1` (`dist/pmtiles.js`) | BSD-3-Clause (champ `license` du paquet ; texte : https://github.com/protomaps/PMTiles/blob/main/LICENSE) | `sha512-3R4fBwwoli5mw7a6t1IGwOtfmcSAODq6Okz0zkXhS1zi9sz1ssjjIfslwPvcWw5TNhdjNBUg9fgfPLeqZlH6ng==` |

Mettre à jour : télécharger l'archive (`npm pack <paquet>@<version>`), vérifier son empreinte, copier
les mêmes fichiers dans un dossier au nouveau numéro de version, changer les trois chemins de
`carte.html`, supprimer l'ancien dossier.
