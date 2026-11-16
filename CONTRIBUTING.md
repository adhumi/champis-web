# Contribuer

Champis est un projet personnel, tenu par une seule personne sur son temps libre. Les pull requests sont bienvenues ; elles sont relues quand l'auteur le peut, parfois après plusieurs semaines. Une fonctionnalité qui contredit la spec du projet sera refusée, même bien écrite : mieux vaut en parler avant.

## Avant de contribuer

- Pour un changement de fond (nouvelle page, nouvelle commande de la carte, nouveau service appelé, dépendance de plus), ouvrez d'abord une issue pour en discuter.
- Pour une correction de bug, une faute ou un test manquant, une pull request directe suffit.
- Pour une faille de sécurité, pas d'issue : voir [`SECURITY.md`](SECURITY.md).

## La spec

Les décisions structurantes du projet (le modèle, les sources de données, le découpage des dépôts, la vie privée) sont consignées dans un document de spécification tenu par l'auteur. Le code et les commentaires y renvoient sous la forme « spec › … ». Une copie de ce document est destinée à être versionnée dans le référentiel `adhumi/champis` : voir le référentiel. Une décision de ce niveau se discute dans une issue et s'inscrit dans la spec avant d'arriver dans le code.

## Ce qui ne se modifie pas ici

- Les fichiers d'espèces, la palette, les textes du Guide (articles, confidentialité, mentions légales), les planches et les photos vivent dans le référentiel `adhumi/champis`, ici en sous-module `champis/`. Ils se modifient par une pull request là-bas. Ce dépôt ne fait qu'avancer le sous-module (`make referential`, puis une pull request ici).
- La météo, le score et les phrases des fiches viennent de l'API (`adhumi/champis-api`). La règle d'interpolation entre cellules se change d'abord là-bas, avec son vecteur de parité, puis dans `web/field.js`.

## Cloner sans clé SSH

Le sous-module est déclaré en SSH (`git@github.com:adhumi/champis.git`). Sans clé SSH chez GitHub, faites-le passer en HTTPS avant de cloner :

```bash
git config --global url."https://github.com/".insteadOf "git@github.com:"
git clone --recurse-submodules https://github.com/adhumi/champis-web
```

Ou, dans un clone déjà fait, sans toucher à la configuration globale :

```bash
git -c url."https://github.com/".insteadOf="git@github.com:" submodule update --init
```

## Règles du dépôt

- Une branche, une pull request, CI verte, puis fusion. Jamais de commit poussé directement sur `main`.
- `make check` lance Ruff (lint et format) et les tests, qui pilotent node et tournent sans réseau. La CI valide en plus le `Caddyfile`, construit l'image et la contrôle (`scripts/smoke.sh`) dans Docker.
- Pas de build : des pages statiques et des fichiers JavaScript servis tels quels. Les fonctions pures (`site.js`, `field.js`, `groups.js`, `png.js`, `comprendre.js`) ont leurs tests dans `web/tests/`.
- Aucune valeur d'espèce ni couleur dans le code : palette et espèces viennent du référentiel (`/shared/`, `/species/`) ou de l'API.
- Aucun script en ligne ni attribut `on…=` dans une page : tout script est un fichier de `web/` (CSP `script-src 'self'`).
- Aucune requête vers un tiers non nécessaire : pas de CDN, pas de police ni de script externe. Les bibliothèques sont copiées dans `web/vendor/` ; la façon de les mettre à jour est dans `web/vendor/README.md`.
- Un hôte nouveau appelé par le code s'ajoute à `connect-src` dans le `Caddyfile` ; un test compare la CSP aux hôtes de `site.js` et `app.js`.
- Un appel nouveau à l'API se vérifie avec le CORS de `adhumi/champis-api` (en-têtes autorisés et exposés).
- `web/tests/pngtiles.py` encode les PNG exactement comme le pipeline : un changement d'encodage dans `adhumi/champis-api` se reporte ici.
- Le dépôt est écrit en français : commentaires, messages de commit, documentation.

Le détail de ces conventions, avec leurs raisons et leurs dates, est dans `CLAUDE.md` ; le détail des pages et du code, dans [`docs/web.md`](docs/web.md).

## Licence des contributions

Le dépôt est sous licence MIT (`LICENSE`). En proposant une contribution, vous acceptez qu'elle soit publiée sous la même licence.
