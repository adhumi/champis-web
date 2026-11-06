# Champis — le site champis.app

Site de Champis : accueil, carte, Guide, soutenir. Pages statiques sans build, MapLibre et PMTiles servis depuis `web/vendor/`. La spec vit dans le doc « Spec — Champis » ; le référentiel `adhumi/champis` (espèces, palette, textes du Guide) est le sous-module `champis/`, et ses skills (`champis-model`, `scoring-parity`, `spec-sync`) sont dans `.claude/skills/` par lien.

Découpage des dépôts (spec › Produit › Étape C, lot C7, 6 nov. 2026) : ce dépôt est `adhumi/champis-web`, servi par un service statique Railway (Caddy) sur `champis.app` ; l'API est `adhumi/champis-api` sur `api.champis.app` ; l'app est `adhumi/champis-ios`.

## Structure

```
web/          pages (index, carte, comprendre, soutenir), site.js (fonctions pures testées en node), vendor/
web/tests/    pytest qui pilote node ; referential.py et pngtiles.py remplacent le paquet du pipeline
champis/      sous-module adhumi/champis : shared/ (palette, textes), species/
shared, species   liens vers champis/ pour le serveur local ; le Dockerfile copie les vrais dossiers
Caddyfile     /web/, /shared/, /species/, / → /web/, /health ; le reste est relayé vers api.champis.app (anciennes versions de l'app)
scripts/      smoke.sh : contrôle d'un site qui tourne (CI sur l'image, `make smoke URL=…` après un déploiement)
```

## Outillage

- Premier clone : `git clone --recurse-submodules` ; `make setup` ; `make serve` puis http://localhost:8080/web/ (API locale de champis-api sur :8000, ou `?api=`).
- `make check` = la CI (ruff, tests) ; la CI valide aussi le Caddyfile, construit l'image et la contrôle (`scripts/smoke.sh`, fausse API locale) dans Docker.
- Le relais vers l'API (`handle` final du Caddyfile) sert les versions de l'app qui appellent encore `champis.app` : à retirer quand plus aucune ne le fait.
- `make referential` amène `champis/` à la dernière version du référentiel ; le commit qui le déplace se fait ici, par PR.

## Règles

- Jamais de commit poussé sur `main` sans PR : branche, PR, CI verte, fusion (règle du 30 oct. 2026).
- Aucune valeur d'espèce ni couleur dans le code : palette et espèces viennent du référentiel (`/shared/`, `/species/`) ou de l'API.
- L'API est sur une autre origine : un appel nouveau se vérifie avec le CORS de champis-api (en-têtes autorisés et exposés).
- Aucune requête vers un tiers non nécessaire (spec › Mesure minimale) : pas de CDN, pas de police ou de script externe ; seuls l'IGN (fond Plan IGN, recherche, forêts publiques) et OpenStreetMap si on le choisit.
- `web/tests/pngtiles.py` encode les PNG exactement comme le pipeline : un changement d'encodage côté champis-api se reporte ici.
- Toute décision structurante passe par la spec avant le code (skill `spec-sync`) ; en cas de doute, demander à Adrien.
