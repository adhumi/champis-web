# web — le site champis.adhumi.fr

Quatre pages statiques, sans build (MapLibre GL et PMTiles par CDN), servies par champis-api sous `/web/` (`CHAMPIS_SERVE_WEB=1`, le défaut) avec `/shared/` et `/species/` à côté : la page lit `shared/palette.json`, `shared/texts/` et `species/<id>.json` aux mêmes chemins qu'en local. Refonte UX, lot 5 (1er nov. 2026) : même structure et même vocabulaire que l'app, sans l'identité Apple.

| Page | Rôle |
| --- | --- |
| `index.html` (Aujourd'hui) | La France colorée par l'indice du jour de `GET /departements` pour le groupe choisi (Cèpes par défaut), le bandeau des onze jours (pastille = meilleure classe atteinte en France ce jour-là), une phrase de saison (`Site.seasonSentence`), la légende, trois liens. Un clic sur un département donne son libellé et un lien vers la carte. |
| `carte.html` (Carte) | La carte à la parcelle de la phase 1, alignée sur l'app : panneau fixe à droite (360 px) sur ordinateur, plein écran sur téléphone (panneau replié en haut, bandeau en bas, fiche en panneau coulissant). Opacité fixe, fond de carte dans le panneau, fiche en clair avec « Détails ». |
| `comprendre.html` (Comprendre) | Les articles de `shared/texts/` (Markdown rendu par `Site.renderMarkdown`) et les fiches d'espèces du bloc `about` de `GET /species` (`?article=especes&espece=<id>`), en colonne de lecture de 680 px. |
| `soutenir.html` | Page de dons sobre. Le lien de paiement est `Site.SUPPORT_URL` dans `site.js` (`null` tant qu'Adrien ne l'a pas renseigné : la page explique en attendant). |

Navigation : en-tête sur ordinateur, barre à trois entrées en bas sur téléphone (`Site.renderNav`). `noindex` sur toutes les pages. Sous la carte et les fiches, la ligne « Pour garder vos coins et être prévenu quand c'est bon : l'app Champis sur iPhone ».

## Identité (`site.css`)

Fond papier clair ou sombre selon le système, accent = le vert « Bon » de la palette, posé en variable CSS par `site.js` après lecture de `shared/palette.json` ; `system-ui`, coins arrondis, aucune ombre portée. Le logo (`logo.svg`) reprend les formes de l'icône de l'app.

## Lancer

```bash
make serve                           # champis-api sert /web/, /shared/, /species et l'API
open http://localhost:8000/web/
```

Les pages appellent l'API à leur propre origine (`Site.apiBase`). En statique depuis la racine du dépôt (`python3 -m http.server 8080`), indiquer l'API : `?api=http://127.0.0.1:8000`.

## Mode développement : `?dev=1`

Sur la carte, `?dev=1` affiche l'adresse de l'API, le glisser-déposer de fichiers PMTiles (`data/tiles/T-*.pmtiles` et le `A-300m-*.pmtiles`, l'espèce est déduite du nom) et les diagnostics (fichiers chargés depuis le bucket, nombre de cellules météo). Avec un serveur qui gère `Range`, les tuiles passent aussi en URL : `carte.html?tiles=../data/tiles/T-….pmtiles,…`.

## Score du jour (API)

La page appelle `GET /weather/bbox` sur l'emprise visible et colorise `T × M_eff × Φ` ; le bandeau de jour va de J−3 à J+7 sans nouvel appel (11 jours d'un coup). Pour un groupe, le score est le max sur les espèces (règle 9). Un pixel sans cellule météo reste transparent, jamais 0,5 inventé ; une météo que le serveur n'a pas pu rafraîchir est dite en clair.

**Classe d'altitude du pixel** : l'API renvoie `M_eff` et `Φ` par classe de 300 m ; la page choisit la classe du pixel grâce à la couche `A-300m-….pmtiles` quand elle est chargée, sinon repli sur l'altitude médiane de la forêt de la cellule (`elevation_m`), indiqué « (médiane cellule) » dans Détails. Largeur de classe et nodata viennent de `shared/palette.json` (`alt_encoding`).

**Vue France** : sous le zoom 9 en mode score, la carte colore les départements par l'indice de `GET /departements` (même palette, même bandeau). Contours : `web/departements.geojson`, Admin Express IGN simplifié via [france-geojson](https://github.com/gregoiredavid/france-geojson), Licence ouverte.

## Ce que fait le code

- `site.js` : fonctions pures partagées (dates en français sans locale, classes de la palette, phrase de saison, Markdown, adresse de l'API) exportées pour node, plus la navigation, la légende et le bandeau des jours côté navigateur. Testé par `web/tests/test_site.py`.
- `app.js` : la carte (couche par espèce ou max du groupe, colorisation côté client, météo, vue France, fiche en clair). `png.js` décode les PNG de données octet par octet, jamais par canvas (Safari trame les gris) ; testé par `web/tests/test_png_decoder.py`.
- `today.js`, `comprendre.js` : l'accueil et Comprendre.
- Position de la carte dans l'URL (`#zoom/lat/lon`) pour partager une vue.

## Rendu des tuiles (étude du 4 nov. 2026)

- **Cache mémoire des tuiles décodées** (`T` par espèce et `A`, LRU de 600 entrées, clé = nom du fichier PMTiles + z/x/y) : changer de jour, de mode ou de météo ne relit rien sur le réseau, seule la colorisation est refaite.
- **La source MapLibre n'est jamais recréée** : `setTiles` avec une nouvelle version recharge les tuiles en gardant l'image précédente à l'écran (plus de carte vidée carré par carré).
- **Lectures en parallèle** (espèces du groupe + `A`) avec trois réessais (1,5 / 3 / 6 s) sur 429 ou erreur réseau ; après quoi la tuile est rendue transparente et relue au prochain rendu, parce que MapLibre ne redemande jamais une tuile en erreur.
- **Cellule météo à moins de 7,5 km** (une cellule et demie de la grille de 5 km) ; au-delà, pixel transparent : jamais la météo d'une cellule chargée pour une autre emprise.
- **Vue France sans tuiles** : sous le zoom 9 en mode score, la couche est masquée (`visibility: none`), aucune requête.
- **Météo** : une emprise contenue dans la dernière réponse complète de la même couche, de moins de 30 min, ne redemande rien (comme l'app).
- Côté API, le relais `/tiles/<nom>` et les fichiers statiques sont hors limitation de débit (`RATE_LIMIT_EXEMPT` dans `app.py`) : un écran vaut 75 à 150 requêtes Range.

## Pas de portage du scoring

La page prend `M_eff` et `Φ` tels que l'API les renvoie et ne les recalcule pas (décision du 30 oct. 2026 : pas de hors ligne sur le web, donc pas de portage JS ; la parité ne concerne que Python et Swift). Les phrases en clair viennent de `GET /weather` › `summary`, les mêmes que l'app.
