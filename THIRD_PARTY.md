# Composants tiers

Ce que le site `champis.app` distribue ou utilise et qui n'est pas de Champis. Le code de ce dépôt est sous licence MIT (`LICENSE`) ; les fichiers du référentiel (`champis/`, sous-module `adhumi/champis` : espèces, palette, textes, illustrations) sous licence CC BY 4.0, sauf les photos des fiches (`shared/photos/`), copies de Wikimedia Commons qui gardent la licence de leur auteur (`champis/LICENSE-DATA.md`).

## Bibliothèques servies par le site (`web/vendor/`)

Copiées telles quelles depuis le registre npm, sans build ; provenance et empreintes dans [`web/vendor/README.md`](web/vendor/README.md).

| Bibliothèque | Version | Licence | Texte de la licence |
| --- | --- | --- | --- |
| [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) (`maplibre-gl`) | 6.18.0 | BSD-3-Clause | `web/vendor/maplibre-gl-6.18.0/LICENSE.txt` (avec les mentions des composants que MapLibre embarque) |
| [PMTiles](https://github.com/protomaps/PMTiles) (`pmtiles`) | 3.2.1 | BSD-3-Clause | `web/vendor/pmtiles-3.2.1/LICENSE` |
| [fflate](https://github.com/101arrowz/fflate), inclus dans `pmtiles.js` | 0.8.x (dépendance `^0.8.0` de `pmtiles@3.2.1`) | MIT | `web/vendor/pmtiles-3.2.1/LICENSE-fflate` |

## Données servies par le site

| Fichier | Source | Licence |
| --- | --- | --- |
| `web/departements.geojson` | Limites des départements : Admin Express de l'IGN, simplifié par [france-geojson](https://github.com/gregoiredavid/france-geojson) (Grégoire David) | Licence Ouverte 2.0 (Etalab) |

Les fonds de carte et les services appelés par la carte (Plan IGN, photographies aériennes, recherche de commune et forêts publiques de la Géoplateforme de l'IGN ; OpenStreetMap si on le choisit) ne sont pas redistribués : le navigateur les lit chez leur éditeur, crédité sur la carte. Les sources des données du modèle (forêts, relief, sols, météo) sont décrites dans le Guide, article « Les données et leurs sources » (`shared/texts/` du référentiel).

## Serveur et outils (non servis aux visiteurs)

| Composant | Version | Licence | Usage |
| --- | --- | --- | --- |
| [Caddy](https://github.com/caddyserver/caddy) (image `caddy`) | 2.11.9 | Apache-2.0 | serveur statique de l'image (`Dockerfile`) |
| pytest, NumPy, Pillow, Ruff | celles de `uv.lock` | MIT, BSD-3-Clause, MIT-CMU, MIT | tests et lint (`pyproject.toml`, groupe `dev`) |
