# Site champis.app : Caddy sert web/ et le référentiel (sous-module champis/) aux chemins d'avant le
# découpage des dépôts : /web/, /shared/, /species/. Aucun build, aucune dépendance tierce au runtime.
FROM caddy:2-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY web /srv/web
COPY champis/shared /srv/shared
COPY champis/species /srv/species

ENV PORT=8080
EXPOSE 8080
