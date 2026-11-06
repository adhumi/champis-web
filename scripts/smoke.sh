#!/bin/sh
# Contrôle d'un site champis-web qui tourne : santé, redirection, pages, référentiel, relais vers
# l'API. Usage : scripts/smoke.sh [URL] (défaut http://localhost:8080). La CI le lance sur l'image
# construite (fausse API locale) ; `make smoke URL=…` après un déploiement.
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
check / "302 $BASE/web/" "%{http_code} %{redirect_url}"
check /web/ 200
check /web/carte.html 200
check /web/comprendre.html 200
check /web/soutenir.html 200
check /web/site.js 200
check /web/vendor/README.md 200
check /shared/palette.json 200
check /shared/texts/index.json 200
check /species/boletus_edulis.json 200
check /web/absent.html 404
# relais : GET /species (sans barre finale) et /health de l'API passent par le site
check /species 200

body=$(curl -sS "$BASE/health")
[ "$body" = "ok" ] || { echo "ECHEC   /health répond « $body » au lieu de « ok » (relayé ?)"; FAIL=1; }

cache=$(curl -sS -o /dev/null -D - "$BASE/web/vendor/README.md" | tr -d '\r' | grep -i '^cache-control:' || true)
case "$cache" in
	*immutable*) echo "ok      cache immuable de web/vendor/" ;;
	*) echo "ECHEC   web/vendor/ sans cache immuable : « $cache »"; FAIL=1 ;;
esac

exit $FAIL
