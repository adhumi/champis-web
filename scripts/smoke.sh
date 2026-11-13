#!/bin/sh
# Contrôle d'un site champis-web qui tourne : santé, pages à la racine, anciennes adresses /web/,
# référentiel, 404 hors du site (plus de relais vers l'API). Usage : scripts/smoke.sh [URL] (défaut
# http://localhost:8080). La CI le lance sur l'image construite ; `make smoke URL=…` après un
# déploiement.
set -eu
BASE="${1:-http://localhost:8080}"
FAIL=0

CODE='%{http_code}'

# check <chemin> <attendu> [format curl] : attendu est comparé à la sortie de curl -w
check() {
	fmt=${3:-$CODE}
	got=$(curl -sS -o /dev/null -w "$fmt" "$BASE$1" || echo "erreur")
	if [ "$got" = "$2" ]; then
		echo "ok      $1 ($got)"
	else
		echo "ECHEC   $1 : attendu « $2 », obtenu « $got »"
		FAIL=1
	fi
}

check /health 200
check / 200
check /carte.html 200
check /comprendre.html 200
check /soutenir.html 200
check /site.js 200
check /vendor/README.md 200
check /shared/palette.json 200
check /shared/texts/index.json 200
check /species/boletus_edulis.json 200
# anciennes adresses /web/… : les pages sont redirigées (requête comprise), les fichiers restent servis
check /web/ "301 $BASE/" "%{http_code} %{redirect_url}"
check /web/index.html "301 $BASE/" "%{http_code} %{redirect_url}"
check "/web/comprendre.html?article=confidentialite" "301 $BASE/comprendre.html?article=confidentialite" "%{http_code} %{redirect_url}"
check /web/departements.geojson 200
check /web/site.js 200
check /web/absent.css 404
# la documentation du dépôt n'est pas servie (docs/web.md, l'ancien web/README.md)
check /README.md 404
check /web/README.md 404
# plus de relais vers l'API (13 nov. 2026) : ses routes n'existent pas sur le site
check /species 404
check "/weather?cell=42" 404
check /tiles 404
check /admin/ 404

body=$(curl -sS "$BASE/health")
[ "$body" = "ok" ] || { echo "ECHEC   /health répond « $body » au lieu de « ok »"; FAIL=1; }

# MapLibre est un module ES : un navigateur refuse un module servi sans type JavaScript
for path in /maplibre.js /vendor/maplibre-gl-6.18.0/maplibre-gl.mjs /vendor/maplibre-gl-6.18.0/maplibre-gl-worker.mjs; do
	ctype=$(curl -sS -o /dev/null -w '%{http_code} %{content_type}' "$BASE$path" || echo "erreur")
	case "$ctype" in
		"200 text/javascript"*|"200 application/javascript"*) echo "ok      $path ($ctype)" ;;
		*) echo "ECHEC   $path : module attendu en JavaScript, obtenu « $ctype »"; FAIL=1 ;;
	esac
done

for path in /vendor/README.md /web/vendor/README.md; do
	cache=$(curl -sS -o /dev/null -D - "$BASE$path" | tr -d '\r' | grep -i '^cache-control:' || true)
	case "$cache" in
		*immutable*) echo "ok      cache immuable de $path" ;;
		*) echo "ECHEC   $path sans cache immuable : « $cache »"; FAIL=1 ;;
	esac
done

exit $FAIL
