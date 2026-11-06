# web — le site champis.app

Quatre pages statiques, sans build (MapLibre GL et PMTiles par CDN), servies par champis-api sous `/web/` (`CHAMPIS_SERVE_WEB=1`, le défaut) avec `/shared/` et `/species/` à côté : la page lit `shared/palette.json`, `shared/texts/` et `species/<id>.json` aux mêmes chemins qu'en local. Refonte UX, lot 5 (1er nov. 2026) : même structure et même vocabulaire que l'app, sans l'identité Apple.

| Page | Rôle |
| --- | --- |
| `index.html` | Redirige vers `carte.html` : le site s'ouvre sur la carte (il n'y a plus d'onglet Aujourd'hui, 5 nov. 2026). |
| `carte.html` (Carte) | La carte à la parcelle de la phase 1, alignée sur l'app : panneau fixe à droite (360 px) sur ordinateur, plein écran sur téléphone (panneau replié en haut, fiche fixe au-dessus de la barre d'onglets). La carte montre toujours aujourd'hui : une ligne en bas à gauche le dit, avec l'heure de calcul de la météo en heure de Paris (étape A, 6 nov. 2026). Opacité fixe, fond de carte dans le panneau, fiche en clair avec ses onze jours, leur tendance (« mieux samedi 7 », « stable toute la semaine », « en baisse ») et le statut de la forêt, puis « Détails » (étape B, 6 nov. 2026). Recherche de commune en tête du panneau (« Rechercher » sur téléphone) et bouton « me localiser » de MapLibre. |
| `comprendre.html` (Guide) | Les articles de `shared/texts/` (Markdown rendu par `Site.renderMarkdown`) et les fiches d'espèces du bloc `about` de `GET /species` (`?article=especes&espece=<id>`), en colonne de lecture de 680 px. |
| `soutenir.html` | Page de dons sobre. Le lien de paiement est `Site.SUPPORT_URL` dans `site.js` (`null` tant qu'Adrien ne l'a pas renseigné : la page explique en attendant). |

Navigation : en-tête sur ordinateur (Carte, Guide, et Soutenir à droite), barre à trois entrées en bas sur téléphone (Carte, Guide, Soutenir ; `Site.renderNav`). `noindex` sur toutes les pages jusqu'à la publication des apps. La ligne qui renvoie vers l'app (`Site.APP_LINE`) est vide tant que l'app n'est pas publiée : rien ne s'affiche.

## Identité (`site.css`)

Fond papier clair ou sombre selon le système, accent = le vert « Bon » de la palette, posé en variable CSS par `site.js` après lecture de `shared/palette.json` ; `system-ui`, coins arrondis, aucune ombre portée. Le logo (`logo.svg`) reprend les formes de l'icône de l'app.

## Services de l'IGN (étapes B3 et B5)

Même hôte que le fond Plan IGN (`data.geopf.fr`, CORS ouvert, sans clé) : aucun tiers nouveau.

- **Recherche de commune** : `Site.geocodeUrl(q)` (`/geocodage/search`, `type=municipality`, 5 résultats, autocomplétion), lancée 250 ms après la dernière frappe, à partir de 3 caractères ; `Site.geocodeResults` lit les résultats, un clic centre la carte au zoom 12.
- **Statut de la forêt** : `Site.forestUrl(lat, lon)` interroge le WFS `ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES` sur un carré de ≈ 4 m autour du point cliqué (BBOX en latitude puis longitude, `urn:ogc:def:crs:EPSG::4326`) ; `Site.forestPhrase` en fait la ligne de la fiche (domaniale, autre forêt publique, ou sans doute privée). La requête part en même temps que la météo du point ; la fiche ne l'attend pas, et n'affiche rien si le service ne répond pas.
- **Me localiser** : `maplibregl.GeolocateControl`, la position reste dans le navigateur.

Ce qui part chez l'IGN est dit dans `shared/texts/confidentialite.md`.

## Lancer

```bash
make serve                           # champis-api sert /web/, /shared/, /species et l'API
open http://localhost:8000/web/
```

Les pages appellent l'API à leur propre origine (`Site.apiBase`). En statique depuis la racine du dépôt (`python3 -m http.server 8080`), indiquer l'API : `?api=http://127.0.0.1:8000`.

## Mode développement : `?dev=1`

Sur la carte, `?dev=1` affiche l'adresse de l'API, le glisser-déposer de fichiers PMTiles (`data/tiles/T-*.pmtiles`, `G-*.pmtiles` et le `A-300m-*.pmtiles`, l'espèce ou le groupe est déduit du nom ; pour un G, l'ordre des canaux est celui du pipeline, les espèces du groupe triées par identifiant d'après `GET /species` ou, sans API, les T déjà glissés) et les diagnostics (fichiers chargés depuis le bucket, « jeu … : N T, M G, A », ce que la couche lit — « Lecture : G cepes (4 canaux) + A » —, nombre de cellules météo). Avec un serveur qui gère `Range`, les tuiles passent aussi en URL : `carte.html?tiles=../data/tiles/T-….pmtiles,…`.

## Score du jour (API)

La page colorise `T × M_eff × Φ` avec la météo de l'emprise visible (plus 0,1° de marge), prise à deux sources selon le zoom MapLibre (`Field.FIELD_ZOOM = 9`, spec › Points ouverts › Carte visible dès l'ouverture, sous le zoom 9, 4 nov. 2026) :

- **à partir du zoom 9** : `GET /weather/bbox`, `M_eff` et `Φ` par cellule, classe d'altitude et jour (11 jours d'un coup ; la carte n'en montre qu'un, aujourd'hui) ;
- **en dessous** : `GET /weather/field?day=…`, le champ compact du seul jour affiché, aujourd'hui (`f` = `M_eff × Φ` par cellule et classe, sans plafond de cellules : la France entière fait ≈ 20 000 cellules, 300–500 Ko gzip), servi depuis le précalcul. Changer de jour sous le seuil demande le champ de ce jour, puis recolorise depuis le cache de tuiles ; un jour déjà reçu (`weather.fieldCovered`, même règle de couverture que bbox : emprise contenue, même couche, moins de 30 min) ne redemande rien. Les cellules manquantes du précalcul (`unavailable`, un compte) sont dites en clair et reviennent avec le TTL.

Les deux réponses sont fusionnées par `field.js` dans la même structure de cellules (par cellule : position, classes d'altitude, `stale`, puis par espèce et par jour le facteur `M_eff × Φ` par classe), lue par une seule fonction `Field.factor(cellule, espèce, jour, classe)` : la colorisation et la sonde au clic ne savent pas d'où vient la météo (sous le seuil, la sonde a le facteur du jour ; les phrases et les facteurs détaillés viennent toujours de `GET /weather?cell=`). Pour un groupe, le score est le max sur les espèces (règle 9). Un pixel sans cellule météo à moins de 7,5 km, ou dont la cellule n'a pas le jour demandé, reste transparent, jamais 0,5 inventé ; une météo que le serveur n'a pas pu rafraîchir est dite en clair.

**Classe d'altitude du pixel** : l'API renvoie `M_eff` et `Φ` par classe de 300 m ; la page choisit la classe du pixel grâce à la couche `A-300m-….pmtiles` quand elle est chargée, sinon repli sur l'altitude médiane de la forêt de la cellule (`elevation_m`), indiqué « (médiane cellule) » dans Détails. Largeur de classe et nodata viennent de `shared/palette.json` (`alt_encoding`).

**Plus de vue France** (décision du 4 nov. 2026, spec › Points ouverts › Vue France et indice par département) : la couche de tuiles reste visible à tout zoom ≥ 6, la carte ne colore plus les départements. Le bandeau des jours, dernier lecteur de `GET /departements`, est retiré à son tour (étape A, 6 nov. 2026) : la page ne lit plus l'indice par département ni `web/departements.geojson` (Admin Express IGN simplifié via [france-geojson](https://github.com/gregoiredavid/france-geojson), Licence ouverte), que l'app iOS lit encore pour nommer le département d'un coin. Les onze jours d'un point sont dans sa fiche : une requête `GET /weather?cell=&species=…` avec toutes les espèces de la couche, valeur d'un jour = max sur les espèces de T × M_eff × Φ à la classe d'altitude du pixel. À l'ouverture, la carte garde sa vue de départ (ou celle de l'URL) si le jeu publié la couvre, sinon elle cadre le jeu ; le champ compact colorant tout sous le zoom 9, ce cadrage n'est plus borné au zoom 9, seulement au `minZoom` de la carte (6, le premier niveau des tuiles).

## Ce que fait le code

- `site.js` : fonctions pures partagées (dates en français sans locale, classes de la palette, phrase de saison, Markdown, adresse de l'API) exportées pour node, plus la navigation, la légende, la ligne « Aujourd'hui · météo calculée à … » et les pastilles de la fiche côté navigateur. Testé par `web/tests/test_site.py`.
- `app.js` : la carte (couche par espèce ou max du groupe, colorisation côté client, météo, ligne du jour, fiche en clair avec ses onze jours). `field.js` : fonctions pures de la météo de la carte (source selon le zoom, fusion bbox/field, index spatial, classe d'altitude et facteur d'un pixel), exportées pour node et testées par `web/tests/test_field.py`. `groups.js` : fonctions pures des PMTiles par groupe (séparation des canaux d'un G en T par espèce, plan de lecture d'une couche, ordre des canaux d'un G glissé-déposé), testées par `web/tests/test_groups.py`. `png.js` décode les PNG de données octet par octet, jamais par canvas (Safari trame les gris) ; testé par `web/tests/test_png_decoder.py`.
- `comprendre.js` : le Guide.
- Position de la carte dans l'URL (`#zoom/lat/lon`) pour partager une vue.

## Rendu des tuiles (étude du 4 nov. 2026)

- **G si présent, sinon T** (spec › Points ouverts › Les clients lisent les PMTiles par groupe, 5 nov. 2026). Dès qu'un fichier `G-<groupe>-…` du jeu choisi (même `depts_hash` que les T) est dans le manifeste `GET /tiles`, la carte lit T de chaque espèce du groupe dans les canaux de sa tuile RGBA (ordre des canaux = `species` de l'entrée du manifeste, jamais deviné ; encodage `group_tile_encoding` de la palette : canal = T × 254, 255 = sans donnée pour ce canal, l'alpha est une donnée, jamais une transparence) ; une couche « espèce seule » lit son canal dans le même G. Deux requêtes Range par tuile (G + A) au lieu de cinq pour les cèpes. Une espèce sans canal dans un G chargé (hors groupe, ou G absent du manifeste) est lue dans son T : mixte possible, et sans aucun G (la production tant que les G ne sont pas publiés) la page marche comme avant, puis bascule sans autre changement quand ils apparaissent. Les T restent chargés dans les deux cas. `speciesT` renvoie la même forme (`[{ sid, t }]`) quel que soit le chemin : `combine`, la colorisation et la sonde au clic ne changent pas.
- **Cache mémoire des tuiles décodées** (`T` par espèce, `G` et `A`, LRU de 600 unités, clé = nom du fichier PMTiles + z/x/y ; une tuile G garde ses quatre tableaux T ensemble dans une entrée qui compte autant d'unités que de canaux) : changer de jour, de mode ou de météo ne relit rien sur le réseau, seule la colorisation est refaite.
- **La source MapLibre n'est jamais recréée** : `setTiles` avec une nouvelle version recharge les tuiles en gardant l'image précédente à l'écran (plus de carte vidée carré par carré).
- **Lectures en parallèle** (`G`, ou T des espèces du groupe, + `A`) avec trois réessais (1,5 / 3 / 6 s) sur 429 ou erreur réseau ; après quoi la tuile est rendue transparente et relue au prochain rendu, parce que MapLibre ne redemande jamais une tuile en erreur.
- **Cellule météo à moins de 7,5 km** (une cellule et demie de la grille de 5 km) ; au-delà, pixel transparent : jamais la météo d'une cellule chargée pour une autre emprise. Une cellule absente de la réponse (`unavailable`) n'existe pas pour la page : ses pixels prennent la voisine si elle est à moins de 7,5 km, sinon rien (ni bbox ni le champ ne donnent la position des cellules manquantes).
- **Index spatial** (`Field.buildIndex`, casiers de 0,05°, reconstruit à chaque fusion) : la cellule la plus proche se cherche dans les seuls casiers que le rayon de 7,5 km peut toucher, une fois par bloc de pixels et par tuile, pour toutes les espèces. Bloc de 16 px à partir du zoom 9 (≈ 5 km), moitié moins par niveau en dessous, jamais moins de 2 px (z6 : ≈ 3,5 km, la cellule). Mesuré en node sur la grille réelle (22 672 cellules) : index construit en 50 ms ; 16 tuiles au zoom 6 × 256 blocs × 4 espèces en 28 ms (4,2 s en parcours linéaire) ; avec les blocs de 2 px, 15 ms par tuile. Dans Chromium, un écran de 24 tuiles au zoom 6 pour les cèpes (4 espèces, couche A) se colorise en ≈ 320 ms de processeur, encodage PNG non compris ; la ligne « Colorisation : N tuiles, X ms » du mode dev le mesure.
- **Vue France retirée** (4 nov. 2026), **champ compact sous le zoom 9** : plus de départements colorés, la couche de tuiles reste visible à tout zoom ≥ 6 (`minZoom` de la carte : les PMTiles commencent au niveau 6) et `/weather/field` la colore en dessous du zoom 9. Dézoomer au niveau 6 colore la France entière avec le champ du jour.
- **Météo** : une emprise contenue dans la dernière réponse complète de bbox (à tout zoom) ou, sous le seuil, dans le champ du jour courant, pour la même couche et de moins de 30 min, ne redemande rien (comme l'app). Au-dessus du seuil, un champ déjà reçu colore en attendant bbox, qui apporte les autres jours.
- Côté API, le relais `/tiles/<nom>` et les fichiers statiques sont hors limitation de débit (`RATE_LIMIT_EXEMPT` dans `app.py`) : un écran vaut 75 à 150 requêtes Range en T, deux à trois fois moins en G.

## Pas de portage du scoring

La page prend `M_eff` et `Φ` tels que l'API les renvoie et ne les recalcule pas (décision du 30 oct. 2026 : pas de hors ligne sur le web, donc pas de portage JS ; la parité ne concerne que Python et Swift). Les phrases en clair viennent de `GET /weather` › `summary`, les mêmes que l'app.
