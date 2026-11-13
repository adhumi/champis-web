# Site champis.app : Caddy sert web/ à la racine et le référentiel (sous-module champis/) sous
# /shared/ et /species/ (Caddyfile). Aucun build, aucune dépendance tierce au runtime.
# Image épinglée par version et par condensé (index multi-architecture de `caddy:2.11.9-alpine`
# sur Docker Hub) : pour monter, changer les deux ensemble.
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0

COPY Caddyfile /etc/caddy/Caddyfile
COPY web /srv/web
COPY champis/shared /srv/shared
COPY champis/species /srv/species

ENV PORT=8080
EXPOSE 8080

# Sans privilège : le port est au-dessus de 1024, les fichiers servis sont lisibles par tous, et
# les seuls dossiers où Caddy écrit (/config/caddy, /data/caddy) sont ouverts à tout utilisateur
# dans l'image officielle. Identifiant numérique : pas de compte à créer.
USER 10001:10001
