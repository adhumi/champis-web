/* MapLibre GL JS n'est plus publié qu'en module ES depuis sa version 6 (plus de `maplibre-gl.js`
 * à charger par une balise classique). Ce module l'importe depuis web/vendor/ et le pose en
 * global, comme avant, pour app.js, qui reste un script classique : carte.html le charge avant
 * les autres scripts, tous différés (`defer`), donc exécutés après lui, dans l'ordre du document.
 * Le worker de MapLibre est le fichier voisin `maplibre-gl-worker.mjs`, chargé par son adresse
 * (même origine) : la CSP du site n'a pas à autoriser `blob:` pour les scripts. */
import * as maplibregl from "./vendor/maplibre-gl-6.18.0/maplibre-gl.mjs";

globalThis.maplibregl = maplibregl;
