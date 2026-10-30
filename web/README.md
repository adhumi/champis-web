# web

Carte web jetable des phases 1–2 : une page statique (MapLibre GL + PMTiles, chargés par CDN, aucun build) qui affiche le potentiel terrain T produit par le pipeline, ou le score du jour `S = T × M_eff × Φ` avec la météo de l'API. Deviendra champis.adhumi.fr en phase 3.

## Lancer

Les tuiles sont des PNG de données (gris = T × 254, alpha 0 = hors forêt) : la page lit `shared/palette.json` pour les seuils et les couleurs, et `species/<id>.json` pour les noms et les groupes. Il faut donc servir **la racine du dépôt** :

```bash
python3 -m http.server 8000          # depuis la racine du dépôt
open http://localhost:8000/web/
```

Puis glisser un ou plusieurs `data/tiles/T-*.pmtiles`, et le `data/tiles/A-300m-*.pmtiles` (classes d'altitude), dans la zone prévue (ou cliquer dessus). L'espèce est déduite du nom du fichier (`T-<espèce>-…`) ; `A-…` est reconnu comme la couche d'altitude.

Quand l'API est joignable et qu'un bucket est configuré (`GET /tiles`, voir `api/README.md`), la page charge toute seule les PMTiles publiés ; le glisser-déposer sert alors de complément ou de repli.

Avec un serveur qui gère les requêtes `Range` (`npx serve .`, nginx, un bucket…), on peut aussi passer les tuiles en URL :

```
http://localhost:3000/web/?tiles=../data/tiles/T-boletus_edulis-…pmtiles,../data/tiles/T-boletus_aereus-…pmtiles
```

(`python -m http.server` ne gère pas `Range`, d'où le glisser-déposer.)

## Score du jour (API)

```bash
uv run uvicorn champis_api.app:app          # dans un autre terminal, voir api/README.md
```

Affichage → « Score du jour » : la page appelle `GET /weather/bbox` sur l'emprise visible (URL de l'API modifiable dans le panneau : l'origine de la page quand elle est servie par champis-api, sinon `http://127.0.0.1:8000`) et colorise `T × M_eff × Φ`. Le curseur de jour va de J−3 à J+7 sans nouvel appel : l'API renvoie les 11 jours d'un coup. Pour un groupe, le score est le max sur les espèces de `T_e × M_eff_e × Φ_e` (règle 9). Un pixel sans cellule météo reste transparent (jamais 0,5 inventé) ; « cache périmé » s'affiche quand l'API sert son cache faute d'Open-Meteo.

**Classe d'altitude du pixel** : l'API renvoie `M_eff` et `Φ` par classe de 300 m ; la page choisit la classe du pixel grâce à la couche `A-300m-….pmtiles` (classes d'altitude, un seul fichier pour toutes les espèces, produite par `champis-pipeline tiles`) quand elle est glissée avec les T. Sans elle, repli sur la classe de l'altitude médiane de la forêt de la cellule (`elevation_m`), et le gel « seulement en altitude » n'est pas visible à l'intérieur d'une cellule ; la sonde l'indique par « (médiane cellule) ». Largeur de classe et nodata viennent de `shared/palette.json` (`alt_encoding`).

## Ce que fait la page

- Couche par espèce, ou **max du groupe** (cèpes, girolles) quand plusieurs espèces d'un groupe sont chargées — règle 9 du modèle.
- Colorisation côté client selon `shared/palette.json` (seuils et hex lus tels quels, rien en dur).
- Les PNG de données sont décodés par `png.js` (lecture des octets, inflate natif), jamais par canvas : `getImageData` passe par la gestion des couleurs du navigateur et Safari trame les gris, ce qui faisait basculer des pixels isolés de classe près des seuils (et de classe d'altitude pour A). Test : `web/tests/test_png_decoder.py` (pytest, exécute node).
- Fonds : Plan IGN, orthophoto IGN (WMTS Géoplateforme, sans clé) ou OpenStreetMap.
- Clic sur la carte : T (ou S, T, M_eff × Φ, cellule, jour) et classe au point cliqué, et l'espèce qui porte le score du groupe.
- **Vue France** : en mode « Score du jour », sous le zoom 9, la carte colore les départements par l'indice de `GET /departements` (même palette, même curseur de jour, 11 jours chargés d'un coup) au lieu d'appeler `/weather/bbox` (plafonné à 40 cellules). Contours : `web/departements.geojson`, Admin Express IGN simplifié via [france-geojson](https://github.com/gregoiredavid/france-geojson), Licence ouverte. La sonde donne l'indice, la classe, l'espèce qui le porte et la couverture météo.
- Position dans l'URL (`#zoom/lat/lon`) pour partager une vue.
- Panneau repliable (clic sur son en-tête) : replié par défaut sur les écrans de moins de 600 px, le choix est mémorisé dans `localStorage` (`champis.panel`).

## Pas de portage du scoring

La page prend `M_eff` et `Φ` tels que l'API les renvoie pour les 11 jours et ne les recalcule pas. Décision du 30 oct. 2026 : le site n'a pas de hors ligne, donc pas de portage JS du scoring ; la parité (skill `scoring-parity`) ne concerne que Python et Swift. Seule la palette est lue dans `shared/`.
