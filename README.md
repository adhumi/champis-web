# Champis — le site champis.app

Champis estime où et quand cueillir des champignons en France, à l'échelle de la parcelle forestière : [champis.app](https://champis.app). Ce dépôt est le site : accueil, carte à 25 m, Guide, page de soutien. Des pages statiques, sans build, servies par Caddy.

Il fait partie de quatre dépôts :

| Dépôt | Contenu |
| --- | --- |
| `adhumi/champis` | le référentiel (espèces, palette, textes du Guide), ici en sous-module `champis/` |
| `adhumi/champis-api` | pipeline terrain et API météo, sur `api.champis.app` |
| `adhumi/champis-web` (ce dépôt) | le site, service statique sur `champis.app` |
| `adhumi/champis-ios` | l'app iOS, iPadOS et macOS |

## Prérequis

- git, avec accès au sous-module du référentiel (sans clé SSH chez GitHub : [`CONTRIBUTING.md`](CONTRIBUTING.md) › Cloner sans clé SSH) ;
- Python 3.12 ou plus récent et [uv](https://docs.astral.sh/uv/), pour le serveur local, le lint et les tests ;
- node (la CI utilise la version 22), que les tests pilotent ;
- Docker, seulement pour construire l'image comme le fait la CI.

## Installer et lancer en local

```bash
git clone --recurse-submodules https://github.com/adhumi/champis-web
cd champis-web
make setup        # sous-module champis/ et environnement de test (uv sync --group dev)
make serve        # http://localhost:8080/web/
```

`make serve` est le serveur de fichiers de Python, lancé à la racine du dépôt : les pages sont sous `/web/`, le référentiel sous `/shared/` et `/species/` (liens vers `champis/`). Il n'envoie pas les en-têtes de sécurité, que Caddy pose en production.

Les pages lisent la météo, le catalogue des espèces et les tuiles dans l'API :

- par défaut, en local, l'API attendue est celle de `make serve` dans `adhumi/champis-api`, sur le port 8000 du même hôte ;
- `?api=<adresse>` en indique une autre : une API lancée sur un autre port ou sur une autre machine.

`?api=` et `?tiles=` ne valent que sur un poste local (`localhost`, `127.0.0.1`, `[::1]`) ; ailleurs ils sont ignorés et le site appelle `https://api.champis.app`. Sans API, la carte reste utilisable en mode développement (`carte.html?dev=1`) : on y glisse des fichiers PMTiles produits par le pipeline ([`docs/web.md`](docs/web.md) › Mode développement).

`make help` liste les commandes.

## Tester

```bash
make check        # Ruff (lint et format) puis les tests : Python qui pilote node, sans réseau
```

`make test ARGS="-k field"` filtre les tests. La CI lance les mêmes contrôles, puis valide le `Caddyfile`, construit l'image et la contrôle avec `scripts/smoke.sh`. Ce script contrôle aussi un site qui tourne : `make smoke URL=https://champis.app`.

## Structure du dépôt

```
web/          pages (index, carte, comprendre, soutenir), site.js (fonctions pures testées en node), vendor/
web/tests/    pytest qui pilote node ; referential.py et pngtiles.py remplacent le paquet du pipeline
champis/      sous-module adhumi/champis : shared/ (palette, textes), species/
shared, species   liens vers champis/ pour le serveur local ; le Dockerfile copie les vrais dossiers
Caddyfile     pages de web/ à la racine, /shared/, /species/, /health, en-têtes de sécurité ; tout le reste répond 404
Dockerfile    image Caddy du site, sans privilège
docs/         web.md : détail des pages et du code de web/ (hors de web/, donc non servi)
scripts/      smoke.sh : contrôle d'un site qui tourne
```

Le détail des pages, du rendu des tuiles, du score du jour et des décisions datées qui les expliquent est dans [`docs/web.md`](docs/web.md).

## Déployer

Le site est un service statique Railway : l'image du `Dockerfile` (Caddy, port lu dans `PORT`, 8080 par défaut), contrôle de santé sur `/health` (`railway.toml`). Railway ne récupère pas les sous-modules ; c'est donc la CI qui déploie, après des tests verts sur `main`, avec `railway up --ci --service champis-web` (`.github/workflows/ci.yml`).

Secrets de la CI, sans valeur dans le dépôt :

- `RAILWAY_TOKEN` : jeton de projet Railway ;
- `CHAMPIS_REFERENTIEL_TOKEN` : lecture du référentiel par la CI tant que `adhumi/champis` est privé ; inutile ensuite.

Le site n'a aucune variable secrète à l'exécution et ne relaie rien vers l'API : tout chemin qui n'est pas un fichier servi répond 404. `make referential` amène le sous-module à la dernière version du référentiel ; le commit qui le déplace passe par une pull request ici.

## Contribuer, signaler une faille

- Contribuer : [`CONTRIBUTING.md`](CONTRIBUTING.md). Projet personnel : les pull requests sont bienvenues, relues quand l'auteur le peut.
- Signaler une faille : [`SECURITY.md`](SECURITY.md), par courriel à hello@champis.app, pas par une issue.

## Licences

- Code de ce dépôt : MIT ([`LICENSE`](LICENSE)).
- Fichiers du référentiel (espèces, palette, textes, planches) : CC BY 4.0, sauf les photos des fiches, qui gardent la licence de leur auteur (`LICENSE-DATA.md` du référentiel `adhumi/champis`).
- Bibliothèques de `web/vendor/`, données servies et outils tiers : [`THIRD_PARTY.md`](THIRD_PARTY.md).
