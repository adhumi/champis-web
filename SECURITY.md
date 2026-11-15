# Signaler une faille de sécurité

Champis est un projet personnel, tenu par une seule personne sur son temps libre. Un signalement est toujours le bienvenu.

## Comment signaler

Par courriel à **hello@champis.app**. Pas d'issue publique ni de pull request pour une faille : elles la rendraient visible avant sa correction.

À joindre, autant que possible :

- ce qui est touché : une page, un script de `web/`, le `Caddyfile`, avec le commit ou la date de l'essai ;
- l'adresse complète qui déclenche le problème, ou les étapes pour le reproduire, et le navigateur utilisé ;
- ce qu'un attaquant obtiendrait : exécution de script dans la page, lecture de données, contournement d'un en-tête de sécurité ;
- le nom à citer dans le correctif, si vous souhaitez être crédité.

## À quoi s'attendre

- Un accusé de réception sous quelques jours.
- Un correctif dès que possible, selon la gravité et le temps disponible. Aucun délai n'est garanti.
- Pas de prime.
- Merci d'attendre le correctif avant d'en parler publiquement.

## Périmètre

- Le code de ce dépôt : les pages et les scripts de `web/`, le `Caddyfile`, le `Dockerfile` et la CI.
- Le service qu'il fait tourner : `https://champis.app`.

L'API `api.champis.app` relève de `adhumi/champis-api`, l'app de `adhumi/champis-ios`, les fichiers d'espèces et les textes de `adhumi/champis`. La même adresse reçoit les signalements pour les quatre dépôts. Une faille dans une bibliothèque de `web/vendor/` (MapLibre GL JS, PMTiles) se signale d'abord à son auteur ; écrivez ici si Champis l'expose d'une façon particulière ou sert une version touchée.

Seule la branche `main`, celle qui est déployée, reçoit des correctifs.

## Ce qui n'est pas une faille

Ces points sont des choix, décrits dans `docs/web.md` et dans le `Caddyfile` :

- **Le site est statique et sans compte.** Il ne pose aucun cookie et ne stocke aucune donnée d'un visiteur. Tout ce qu'il sert est public, fichiers du référentiel compris (`/shared/`, `/species/`).
- **`?api=` et `?tiles=` changent la source des données sur un poste local seulement** (`localhost`, `127.0.0.1`, `[::1]`). Sur `champis.app` ils sont ignorés ; qu'ils le soient est voulu, qu'ils ne le soient pas serait une faille.
- **La CSP autorise les styles en ligne** (`style-src 'unsafe-inline'`), pour les blocs `<style>` des pages et le rendu de la légende. Les scripts en ligne, eux, sont interdits.
- **Le navigateur appelle des tiers nommés** : la Géoplateforme de l'IGN et, si on choisit ce fond, OpenStreetMap. L'article « Confidentialité » du site le dit.
- Le serveur local de `make serve` n'envoie pas les en-têtes de sécurité : ils sont posés par Caddy, en production.

## Ce qu'il ne faut pas faire

- Ne testez pas la production en charge : pas d'outil de balayage à haut débit, pas d'essai de déni de service. Le service tourne sur une petite infrastructure financée par des dons. Le site se lance en local en une commande (`README.md` › Installer et lancer en local).
- Ne touchez pas aux données d'autrui, et ne ciblez pas d'autres visiteurs.
