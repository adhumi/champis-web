# Étude — pourquoi la carte du site s'affiche mal

4 novembre 2026, sur champis-production.up.railway.app (fichiers servis identiques à `main` @ 0d485cf). Vue France (indice par département) exclue, comme demandé. Aucun code modifié.

## Résumé

Les données sont saines : les huit PMTiles du jeu France (7 espèces + couche A) sont valides, les requêtes Range fonctionnent et `/weather/bbox` répond en une à deux secondes. Ce qui casse l'affichage, c'est la chaîne entre le bucket et l'écran, dans cet ordre d'importance :

1. **La limitation de débit de l'API (120 lectures par minute et par IP) s'applique au relais de tuiles.** Un écran d'ordinateur en couche « Cèpes » coûte 120 à 175 requêtes Range ; la première vue épuise déjà le seau, chaque déplacement en redemande autant. Une tuile refusée (429) reste blanche : ni pmtiles.js ni MapLibre ne la réessaient.
2. **La page jette tout son cache de tuiles à chaque déplacement, changement de jour ou de mode** (`setLayer` recrée la source avec `v${++tileVersion}`). Tout est retéléchargé via le relais, ce qui aggrave le point 1, et la couche disparaît puis revient carré par carré.
3. **Chaque tuile enchaîne cinq requêtes Range en série** (quatre espèces puis la couche A) à 0,3–0,8 s chacune via le relais : 1,5 à 3 s par tuile, une dizaine de secondes par écran mesurées.
4. **En vue France, la couche de tuiles reste dessinée par-dessus les départements**, colorée avec la météo de cellules à des centaines de kilomètres (`nearestCell` sans rayon maximal) : moucheté sur toute la France et 170 requêtes inutiles par vue.
5. **La case « Afficher le potentiel toute saison » plante** (`$("weather")` n'existe pas dans `carte.html`) : la couche n'est pas re-rendue, et les tuiles chargées ensuite sont en T pendant que les anciennes restent en S (patchwork).
6. **Traits blancs fins aux coutures de tuiles** au zoom 14 et plus : dernière ligne ou colonne de certaines tuiles z15 en nodata.
7. **Pendant la pré-chauffe (3 h et 15 h Paris) l'API ne répond plus** : la passe de calcul (≈ 36 min CPU France) bloque la boucle d'événements du seul processus, qui est aussi le relais de tuiles et le serveur du site.
8. Hors affichage, deux points qui donnent l'impression d'une carte « fausse » : T sature (93 % des pixels de forêt d'une tuile du Doubs sont ≥ 0,75 pour le cèpe de Bordeaux, la carte du jour est donc surtout une carte météo par cellules de 5 km), et l'indice départemental n'est pas à l'échelle du score pixel (il ne contient pas T).

## Méthode

- Lecture de `web/app.js`, `web/png.js`, `web/site.js`, `carte.html`, `api/champis_api/routers/tiles.py`, `routers/weather.py`, `ratelimit.py`, `app.py`, `pipeline/champis_pipeline/tiles.py`, les skills `swiftui-mapkit` et `offline` de l'app, la spec (hébergement des PMTiles, limitation de débit, météo d'une emprise).
- Sondes HTTP sur la production : `/tiles`, `/health`, `/departements`, `/weather/bbox` (deux emprises Doubs), requêtes Range sur les PMTiles, décodage de l'en-tête et de tuiles z6 à z15 avec la bibliothèque `pmtiles`.
- Test de la limite de débit : 300 requêtes `/health` sur une seule connexion ; 150 requêtes Range sur 16 connexions.
- Chromium headless (Playwright) sur `carte.html?dev=1`, bureau 1440 × 900 et téléphone 390 × 844, avec journal de toutes les requêtes et de la console, captures à chaque étape : vue initiale, zoom 12, 14, retour vue France, zoom 11, bascule T, déplacement. MapLibre et pmtiles.js servis en local (unpkg et data.geopf.fr sont bloqués depuis le conteneur : fond IGN absent des captures, sans effet sur la couche).

Captures et journal : `/tmp/claude-0/-home-user/15980e90-e5bc-5b1e-98c7-6f872d75c62b/scratchpad/pw/desktop2/` (`01…07.png`, `log.json`) et `…/scratchpad/pw/phone/`.

## Ce qui va bien

| Point | Constat |
| --- | --- |
| Site servi | Les six fichiers `web/` de production sont identiques au dépôt. |
| Manifeste `/tiles` | 776 fichiers, mode `proxy`, jeu France `d7bb9d4` (96 départements) choisi par la page, 8/8 chargés. |
| PMTiles | En-tête v3 valide, 955 361 tuiles, PNG gris + alpha 256 px non compressés, répertoires feuilles 1,8 Mo, `clustered`. Tuile z13 Doubs : 46 % hors forêt (alpha 0), le reste bien encodé. |
| Relais Range | 206 avec `Content-Range`, `ETag` fort, `cache-control: public, max-age=86400, immutable`, pas de gzip sur les plages. 0,25–0,85 s par requête depuis le conteneur (`/health` seul : 0,3 s, le relais lui-même ajoute peu). |
| `/weather/bbox` | Emprise Doubs zoom 10 (4 espèces) : 280 cellules, 2 Mo JSON, 1,05 s. Zoom 9 avec marge : 925 cellules, 6 Mo, 2,2 s (gzip). 0 `unavailable`, 0 `stale`. |
| Hashes | Les tuiles T publiées portent les hashes courants des sept fichiers d'espèces ; `af34c16e` de `/departements` est le hash global, pas une incohérence. |
| Décodage PNG | `png.js` lit les octets (pas de canvas), conforme à la règle ; aucune erreur de décodage dans la console. |

## Constats détaillés

### 1. La limite de débit frappe le relais de tuiles

`RateLimitMiddleware` (app.py) enveloppe toute l'application : routes API, mais aussi `GET /tiles/{name}` et les fichiers statiques `/web`, `/shared`, `/species`. Seau de 120 jetons par IP, recharge de 2 par seconde, 429 « trop de requêtes » avec `Retry-After` au-delà.

Mesuré en production : sur une seule connexion, 300 requêtes `/health` en 39 s donnent 198 × 200 et 102 × 429, premier 429 à la 161ᵉ (120 + ≈ 40 rechargés). Le même test en parallèle sur 16 connexions depuis ce conteneur ne donne aucun 429, parce que la sortie du conteneur passe par plusieurs adresses ; un navigateur réel n'a qu'une adresse et compte tout.

Ce que coûte un écran, mesuré en Chromium (journal `log.json`) :

| Vue | Requêtes Range | Durée du lot |
| --- | --- | --- |
| Bureau 1440 × 900, zoom 12, Cèpes | 120 | 9,5 s |
| Bureau, zoom 14 | 115 | 9,4 s |
| Bureau, zoom 11 | 150 | 9,6 s |
| Bureau, vue France zoom 6,5 (tuiles inutiles, voir 4) | 170 | 11,8 s |
| Téléphone 390 × 844, zoom 12, Cèpes (deux passes, voir 2) | 125 | — |
| Téléphone, zoom 14 | 75 | — |
| Téléphone, zoom 11 | 125 | — |
| Chargement de la page (statique + manifeste + 7 JSON d'espèces + répertoires PMTiles) | ≈ 75 | — |

Avec les 20 requêtes de la page et les 24 lectures de répertoires (en-tête, racine, feuille × 8 fichiers), la première vue en Cèpes dépasse 120 sur ordinateur comme sur téléphone : une partie des tuiles est refusée dès l'ouverture, puis chaque déplacement ou changement de jour en refuse davantage. `FetchSource.getBytes` de pmtiles.js lève `Bad response code: 429`, MapLibre marque la tuile `errored` et ne la redemande pas tant qu'elle reste à l'écran. Résultat : trous blancs persistants, carte qui « ne finit pas de charger » après deux ou trois déplacements.

La spec avait identifié ce risque pour l'app (« extraction côté app par requêtes Range : centaines de requêtes, limitation de débit de l'API en mode proxy », 31 oct.) ; le site fait exactement cela. La limitation (30 oct.) est postérieure au passage en mode proxy (19 oct.) : c'est une régression d'intégration, pas un défaut d'origine.

### 2. Le cache de tuiles est vidé à chaque geste

`setLayer(key)` supprime la source et la recrée avec une URL `champis://…/v${++tileVersion}/…`. Il est appelé par `moveend` (via `fetchWeather`, après la réponse `/weather/bbox`), par le bandeau des jours, par la bascule T/S, par le chargement de la couche A. pmtiles.js ne met en cache que les répertoires, jamais les tuiles ; le cache HTTP du navigateur sur des réponses 206 n'est pas garanti (Chrome le fait parfois, Safari et Firefox rarement). Donc :

- chaque déplacement rejoue toutes les requêtes Range de l'écran, même pour les tuiles déjà vues ;
- changer de jour, qui ne change aucune donnée de tuile (règle 6 du skill `swiftui-mapkit` : « changer de jour ne recharge aucune tuile »), rejoue tout ;
- entre la suppression et la fin du rechargement, la couche disparaît et réapparaît tuile par tuile (le même symptôme que `reloadData()` dans l'app, corrigé là-bas le 1ᵉʳ nov.) ;
- au premier affichage d'une emprise, une première passe de rendu part sans météo (toutes les tuiles transparentes), puis la réponse `/weather/bbox` déclenche une seconde passe complète : le premier lot est gaspillé.

### 3. Cinq requêtes en série par tuile

`speciesT` boucle `for … await` sur les espèces de la couche, puis `altTile` attend la couche A. Pour Cèpes : 4 + 1 requêtes à la suite, 0,3–0,8 s chacune via le relais, soit 1,5 à 3 s par tuile. MapLibre lance 16 tuiles en parallèle, d'où ≈ 10 s par écran mesurés. Rien n'empêche de lancer les cinq lectures en parallèle (l'app le fait : `TileRenderer` lit T de chaque espèce et A « en parallèle »).

### 4. Vue France : la couche de tuiles reste dessinée, avec une météo fausse

Sous le zoom 9 en mode S, `paintDepts` colore les départements mais la couche raster `T` n'est ni masquée ni retirée ; elle est au-dessus de `depts-fill` dans l'ordre des couches. Le protocole `champis://` continue de rendre des tuiles z6–z9 pour toute la France, et `combine` leur applique `weatherRow` → `nearestCell`, qui renvoie la cellule la plus proche parmi celles déjà chargées **sans borne de distance**. Après un passage sur le Doubs, tout pixel de forêt de France prend donc la météo d'une cellule du Doubs. Capture `04-france-z6.png` : moucheté vert/jaune/orange sur les départements, 170 requêtes Range pour rien, bandeau des jours vide (le département sous le centre n'est pas trouvé tant que le GeoJSON n'est pas rendu).

Même mécanisme à la parcelle : une cellule `unavailable` n'est pas transparente mais prend la météo de la voisine, contrairement au README (« un pixel sans cellule météo reste transparent »).

### 5. La bascule « potentiel toute saison » plante

`app.js` ligne 442 : `$("weather").hidden = …`, mais aucun élément n'a l'identifiant `weather` dans `carte.html` (il s'appelle `weather-status`). Console : `TypeError: Cannot set properties of null (setting 'hidden')`. Le gestionnaire s'arrête avant `setLayer` et `fetchWeather`. La case se coche, `mode()` renvoie « T », mais rien n'est re-rendu : capture `06-after-potential-click.png` (0 requête). Au déplacement suivant, les nouvelles tuiles sortent en T (vert foncé) à côté des anciennes en S (jaune/orange) : capture `07-T-moved.png`. Le passage inverse (décocher) a le même défaut.

### 6. Coutures fines au zoom 14 et plus

Capture `03-z14.png` : traits blancs d'un pixel le long de certaines limites de tuiles. Vérifié sur douze tuiles z15 de production autour de 47,1 N 6,35 E : la fraction de pixels valides de la dernière ligne ou colonne est souvent inférieure à celle de l'avant-dernière (0,87 contre 0,93 ; 0,86 contre 0,92 ; 0,92 contre 1,0 ; 0,45 contre 0,5). La réduction 2 × 2 des niveaux inférieurs (moyenne des valides) efface le défaut sous le zoom 14, ce qui explique qu'on ne le voie qu'à la parcelle.

Cause probable : les tuiles publiées sont antérieures au correctif. Le code courant (`_source_window` avec `WINDOW_MARGIN`, commit 12980d7 du 30 oct.) rend des bords pleins sur une mosaïque synthétique (90 tuiles z15 vérifiées, test `pipeline/tests/test_tiles_edges.py`), mais `_done` saute un PMTiles existant : le jeu France, rendu avant le 30 oct., n'a jamais été refait. Action : `make tiles` avec `--force` sur le jeu France puis `make release`, sans changement de code.

### 6 bis. Téléphone : la carte n'occupe pas l'écran

Capture `phone/02-z12.png` (390 × 844) : `main.carte` fait `100vh − nav-h`, mais le pied de page (`footer.site-footer`) reste en dessous, donc la page défile et la carte n'occupe que ≈ 600 px ; le bandeau des jours chevauche l'attribution. Sur iOS Safari, `100vh` inclut la barre d'adresse (préférer `100dvh`). Masquer le pied de page sur la carte en largeur mobile, comme l'en-tête l'est déjà.

### 7. L'API est muette pendant la pré-chauffe

La spec le note (2 nov.) : la passe `compute_dept_index` + `cell_weather` (≈ 36 min CPU France) bloque la boucle d'événements. Comme le relais de tuiles, le site statique et `/weather/bbox` sont servis par ce même processus unique (`uvicorn` sans `--workers`, `Dockerfile`), la carte est vide ou gelée pendant la pré-chauffe de 3 h et celle de 15 h Paris (le `dept_index_at` du jour est 15 h 15 Paris). Un test à 15 h tombe pile dedans.

### 8. Ce qui rend la carte « peu lisible » sans être un bug d'affichage

- Sur la tuile z13 du Doubs décodée, 93 % des pixels de forêt ont T ≥ 0,75 pour le cèpe de Bordeaux. En mode T, presque tout est « Excellent » (capture `07-T-moved.png`, zones vert foncé). En mode S, la couleur du pixel est donc décidée par M_eff × Φ de sa cellule de 5 km : la carte montre des aplats au contour des cellules météo (blocs de 16 px au plus proche voisin), pas la parcelle. C'est une question de modèle (plages pH, poids des facteurs) à traiter via le skill `species-file` et la spec, pas dans `app.js`.
- L'indice par département vaut Σ T × M_eff × Φ / Σ T : une moyenne de M_eff × Φ pondérée par T, sans T lui-même. Il affiche « Bon » (0,6) là où les pixels, à T ≈ 0,8, sont « Moyen » (0,5). Deux échelles pour une même palette. Point à retirer avec la vue France, ou à redéfinir dans la spec.

## Recommandations

Par ordre de rapport effet / effort. Les trois premières règlent l'essentiel.

### A. Immédiat, sans changer l'architecture

1. **Sortir le relais de tuiles et les statiques du seau de 120 lectures.** Soit exempter `GET /tiles/{name}`, `/web`, `/shared`, `/species` dans `RateLimitMiddleware`, soit leur donner un seau dédié dimensionné pour un écran (≈ 2 000 par minute). Garder 120 pour les routes de calcul. À noter dans la spec (section limitation de débit) : la limite protège le CPU et Open-Meteo, pas la sortie réseau du bucket, qui se suit déjà par la facture.
2. **Ne plus recréer la source à chaque météo, jour ou mode.** Garder dans `app.js` un cache mémoire des tuiles décodées (clé `fichier/z/x/y` → `Float32Array` T, `Uint8Array` A, ≈ 260 Ko par tuile, LRU de quelques centaines) et ne refaire que `combine` + `colorize` quand la météo, le jour ou le mode change. Pour forcer MapLibre à redemander les images sans retirer la couche : `map.getSource("T").setTiles([url v+1])` (MapLibre ≥ 3), qui garde l'ancienne image affichée jusqu'à la nouvelle. Attendre la réponse `/weather/bbox` avant la première passe de rendu d'une nouvelle emprise, ou rendre depuis les cellules déjà connues et ne rafraîchir qu'après. C'est la transposition web de la décision du 1ᵉʳ nov. côté app (renderer maison, `settingsChanged()` au lieu de `reloadData()`).
3. **Lire T des espèces et A en parallèle** (`Promise.all` dans le gestionnaire de protocole). Latence par tuile divisée par quatre ou cinq.
4. **Réessayer une tuile refusée** : dans le gestionnaire `champis://`, sur erreur 429 ou réseau, attendre `Retry-After` (ou 2 s) et retenter une à deux fois avant de laisser la tuile en erreur ; MapLibre ne le fait pas.
5. **Vue France propre** : `map.setLayoutProperty("T", "visibility", "none")` sous `DEPT_ZOOM` en mode S (plus aucune requête de tuile en vue France), et borner `nearestCell` à un rayon d'une cellule et demie (≈ 0,07°) : au-delà, pixel transparent, conforme à la règle « jamais une météo inventée ». Appliquer le même rayon à la sonde au clic.
6. **Corriger la bascule T/S** : `$("weather")` → `$("weather-status")` (ou supprimer la ligne), et ajouter dans `web/tests` un test qui vérifie que tous les identifiants utilisés par `app.js` existent dans `carte.html` (le driver node existe déjà).
7. **Coutures** : ajouter au pipeline un test qui compare la dernière ligne de la tuile (x, y) à la première de (x, y+1) sur un échantillon, puis corriger `_render_tile` (rendre 258 × 258 depuis la fenêtre élargie et rogner, ou arrondir la fenêtre source une ligne plus loin). Vérifiable sans regénérer la France : un département suffit.

### B. Structure, à décider dans la spec

8. **Sortir les tuiles du processus Python.** Le relais applicatif met un processus unique, à boucle d'événements partagée avec le calcul, sur le chemin de chaque pixel. Deux options déjà listées dans la spec : (a) URL présignées directes si Railway finit par offrir le CORS sur les buckets ; (b) Cloudflare R2 ou un CDN devant le bucket (plages Range mises en cache en bordure, en Europe, sortie gratuite). Dans les deux cas le limiteur et la pré-chauffe sortent du chemin des tuiles, et le cache HTTP des 206 devient fiable. C'est aussi ce que la décision du 30 oct. (« bascule vers R2 si la sortie dérape ») prévoyait.
9. **Un fichier par groupe au lieu d'un par espèce.** Les quatre T des cèpes tiennent dans les quatre canaux d'un PNG RGBA (255 = nodata par canal, ordre des espèces dans le manifeste) : une requête au lieu de quatre par tuile, même taille totale à peu près. Les girolles (trois espèces) tiennent aussi. La couche A reste à part ou prend le quatrième canal des girolles. Gain : 2 requêtes par tuile au lieu de 5, sans toucher au modèle (le max du groupe se calcule toujours côté client, espèce par espèce). Changement de format : `tile_encoding` dans `palette.json`, pipeline, site, app, et la spec.
10. **Pré-chauffe hors de la boucle d'événements** : `run_in_executor` sur un processus, ou un service Railway cron séparé qui écrit la table `cell_weather` sur le volume partagé. Point déjà ouvert dans la spec, il devient pressant dès que le site a des visiteurs à 15 h.
11. **Alléger `/weather/bbox` pour le site** : ne redemander que si l'emprise sort de la dernière réponse (comme `MapModel.weatherAlreadyCovers` dans l'app), et accepter que le site ne charge que le jour choisi (`day=`) quand on change d'emprise, les onze jours ne servant qu'au bandeau.

### C. Hors affichage, pour la spec

12. Regarder la distribution de T par espèce sur quelques départements (`champis-pipeline check` donne déjà l'AUC et les quantiles) : si 90 % de la forêt est « Excellent », les seuils ou les poids ne discriminent pas et la carte du jour est une carte météo. À trancher par Adrien avec le skill `species-file`.
13. Retirer la vue France et le bandeau par département, ou redéfinir l'indice à la même échelle que S (par exemple la moyenne de S sur la forêt, ou la part de forêt « bonne ou mieux »).

## Mise en œuvre (même PR, 4 nov. 2026, après accord d'Adrien)

Bloc A appliqué : relais de tuiles et statiques hors limiteur (`RATE_LIMIT_EXEMPT`, test), cache mémoire des tuiles décodées et `setTiles` au lieu de recréer la source, lectures en parallèle avec trois réessais puis tuile transparente, rayon de 7,5 km sur `nearestCell`, couche masquée en vue France, bascule T/S réparée avec un test sur les identifiants, pied de page masqué et `100dvh` sur téléphone, météo non redemandée pour une emprise déjà couverte. Coutures : pas de correctif de code, les tuiles publiées sont antérieures au correctif du 30 oct. ; test de non-régression ajouté, et le jeu France est à régénérer avec `--force` puis republier. Blocs B et C : décisions de spec, non tranchées ici.

## Décisions d'Adrien (4 nov. 2026, reportées dans la spec)

- Tout reste sur Railway. Dans l'ordre : vérifier la région du service et du bucket et passer en Europe si besoin ; sortir la pré-chauffe dans un service cron Railway ; puis plusieurs workers uvicorn ; un cache disque des plages lues par le relais ; un PMTiles par groupe (une espèce par canal) seulement si la latence reste gênante ensuite.
- La vue France est retirée de la carte, site et app ; sur le web, l'accueil perd aussi sa carte des départements. `GET /departements` reste pour le bandeau des jours, la phrase de saison et les coins.

## Ce que je n'ai pas pu vérifier

- Le 429 dans un vrai navigateur : la sortie de ce conteneur répartit les connexions sur plusieurs adresses, Chromium n'a donc jamais été limité ici ; la limite est prouvée sur une connexion unique. À confirmer dans l'inspecteur réseau de Safari ou dans les journaux Railway (compter les 429).
- La région du service Railway et la latence depuis la France (d'ici, 0,3 s par requête, proxy de sortie compris).
- Le rendu Safari et iOS (seul Chromium est disponible ici) ; les décisions `DecompressionStream` / `OffscreenCanvas` demandent Safari 16.4 ou plus.
- Le fond IGN (data.geopf.fr bloqué depuis le conteneur) : absent des captures, sans incidence sur l'analyse.
