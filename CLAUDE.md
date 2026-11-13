# Champis — le site champis.app

Site de Champis : accueil, carte, Guide, soutenir. Pages statiques sans build, MapLibre et PMTiles servis depuis `web/vendor/`. La spec vit dans le doc « Spec — Champis » ; le référentiel `adhumi/champis` (espèces, palette, textes du Guide) est le sous-module `champis/`, et ses skills (`champis-model`, `scoring-parity`, `spec-sync`) sont dans `.claude/skills/` par lien.

Découpage des dépôts (spec › Produit › Étape C, lot C7, 6 nov. 2026) : ce dépôt est `adhumi/champis-web`, servi par un service statique Railway (Caddy) sur `champis.app` ; l'API est `adhumi/champis-api` sur `api.champis.app` ; l'app est `adhumi/champis-ios`.

## Structure

```
web/          pages (index, carte, comprendre, soutenir), site.js (fonctions pures testées en node), vendor/
web/tests/    pytest qui pilote node ; referential.py et pngtiles.py remplacent le paquet du pipeline
champis/      sous-module adhumi/champis : shared/ (palette, textes), species/
shared, species   liens vers champis/ pour le serveur local ; le Dockerfile copie les vrais dossiers
Caddyfile     pages de web/ à la racine (/, /carte.html… ; les anciennes adresses /web/*.html y redirigent, les fichiers de /web/ restent servis), /shared/, /species/, /health ; tout le reste répond 404 (le relais vers l'API est retiré depuis le 13 nov. 2026)
scripts/      smoke.sh : contrôle d'un site qui tourne (CI sur l'image, `make smoke URL=…` après un déploiement)
```

## Outillage

- Premier clone : `git clone --recurse-submodules` ; `make setup` ; `make serve` puis http://localhost:8080/web/ (API locale de champis-api sur :8000, ou `?api=`).
- `make check` = la CI (ruff, tests) ; la CI valide aussi le Caddyfile, construit l'image et la contrôle (`scripts/smoke.sh`) dans Docker.
- Le site ne relaie rien vers l'API (relais retiré le 13 nov. 2026) : une version de l'app qui appelle encore `champis.app` pour l'API reçoit 404.
- `make referential` amène `champis/` à la dernière version du référentiel ; le commit qui le déplace se fait ici, par PR.

## Règles

- Jamais de commit poussé sur `main` sans PR : branche, PR, CI verte, fusion (règle du 30 oct. 2026).
- Aucune valeur d'espèce ni couleur dans le code : palette et espèces viennent du référentiel (`/shared/`, `/species/`) ou de l'API.
- La carte n'affiche que les espèces servies par `GET /species` (le catalogue de l'API : espèces complètes, bloc `about`, photo, planche, **et** dont les tuiles T France sont publiées ; décisions du 9 nov. 2026) ; sans API, tout ce qui est chargé s'affiche (mode dev, glisser-déposer).
- La météo d'un pixel est interpolée entre les centres des cellules voisines (`web/field.js`, portage de `champis_api/interp.py` validé par `champis/shared/vectors/interp.json` ; spec › Scoring, 13 nov. 2026) : un changement de la règle se fait d'abord dans champis-api et le vecteur.
- L'API est sur une autre origine : un appel nouveau se vérifie avec le CORS de champis-api (en-têtes autorisés et exposés).
- En-têtes de sécurité dans le `Caddyfile` (13 nov. 2026) : HSTS, `Permissions-Policy` (géolocalisation seule) et une CSP stricte. Aucun script en ligne ni attribut `on…=` dans une page (`script-src 'self'`) : tout script est un fichier de `web/`. Un hôte nouveau appelé par le code s'ajoute à `connect-src` (un test compare la CSP aux hôtes de `site.js` et `app.js`).
- Aucune requête vers un tiers non nécessaire (spec › Mesure minimale) : pas de CDN, pas de police ou de script externe ; seuls l'IGN (fond Plan IGN, recherche, forêts publiques) et OpenStreetMap si on le choisit.
- `web/tests/pngtiles.py` encode les PNG exactement comme le pipeline : un changement d'encodage côté champis-api se reporte ici.
- Toute décision structurante passe par la spec avant le code (skill `spec-sync`) ; en cas de doute, demander à Adrien.
