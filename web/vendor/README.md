# Bibliothèques servies par Champis

Étape C, lot C1 (6 nov. 2026) : la carte ne charge plus rien depuis un CDN tiers (unpkg). Les deux
bibliothèques sont copiées telles quelles depuis le registre npm, empreintes vérifiées contre
`npm view <paquet> dist.integrity`.

| Dossier | Paquet | Licence | Empreinte de l'archive npm |
| --- | --- | --- | --- |
| `maplibre-gl-6.18.0/` | `maplibre-gl@6.18.0` (`dist/maplibre-gl.mjs`, `dist/maplibre-gl-worker.mjs`, `dist/maplibre-gl.css`) | BSD-3-Clause, `LICENSE.txt` joint | `sha512-8ucT+RhJtEZGFvWGPioVQwvOPMAIuUehEgxl2dELw9aJmX4SpUi+OCHHAD33B9EuohNC7kC/gccJacUgTMQfQQ==` |
| `pmtiles-3.2.1/` | `pmtiles@3.2.1` (`dist/pmtiles.js`) | BSD-3-Clause (champ `license` du paquet ; texte : https://github.com/protomaps/PMTiles/blob/main/LICENSE) | `sha512-3R4fBwwoli5mw7a6t1IGwOtfmcSAODq6Okz0zkXhS1zi9sz1ssjjIfslwPvcWw5TNhdjNBUg9fgfPLeqZlH6ng==` |

MapLibre GL JS 6 (13 nov. 2026, montée depuis 4.7.1 : l'avis GHSA-jrc7-96c5-q579 touche toutes les
versions jusqu'à 6.4.0) n'est plus publié qu'en module ES : `web/maplibre.js` importe
`maplibre-gl.mjs` et le pose en global pour `app.js` ; le worker est `maplibre-gl-worker.mjs`, que
MapLibre charge par son adresse, à côté du module (même origine, pas de `blob:`). WebGL 2 est requis.
Les fichiers `.map` et les variantes `-dev` du paquet ne sont pas copiés.

Mettre à jour : télécharger l'archive (`npm pack <paquet>@<version>`), vérifier son empreinte, copier
les mêmes fichiers dans un dossier au nouveau numéro de version, changer les chemins (`carte.html`
pour la feuille de style et PMTiles, `maplibre.js` pour le module MapLibre), supprimer l'ancien
dossier.
