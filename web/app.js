/* Page Carte du site (carte.html) : potentiel terrain T (PMTiles gris 8 bits) colorisé côté
 * client avec shared/palette.json, et score du jour S = T × M_eff × Φ avec les valeurs de l'API
 * (/weather/bbox : M_eff et Φ par cellule 5 km, jour et classe d'altitude). Aucune valeur de
 * modèle ici : palette, seuils, encodage des tuiles et noms d'espèces sont lus depuis le dépôt,
 * M et Φ depuis l'API (servir la racine du dépôt, voir README). Dates, légende, bandeau et
 * navigation viennent de site.js (lot 5) ; le glisser-déposer et l'adresse de l'API sont des
 * outils de développement (`?dev=1`). */

const TILE = 256;
const MIN_ZOOM = 6;
const MAX_ZOOM = 15;
// En dessous de ce zoom, en mode S, la carte passe à la vue France : départements colorés par
// l'indice `GET /departements` (section Scoring) au lieu des cellules météo (plafond de 40 par emprise).
const DEPT_ZOOM = 9;

const BASEMAPS = {
  plan: {
    tiles: [
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM" +
        "&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    ],
    attribution: "© IGN — Plan IGN",
    maxzoom: 19,
  },
  ortho: {
    tiles: [
      "https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0" +
        "&LAYER=ORTHOIMAGERY.ORTHOPHOTOS&STYLE=normal&TILEMATRIXSET=PM" +
        "&FORMAT=image/jpeg&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}",
    ],
    attribution: "© IGN — Orthophotos",
    maxzoom: 19,
  },
  osm: {
    tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
    attribution: "© OpenStreetMap contributors",
    maxzoom: 19,
  },
};

const $ = (id) => document.getElementById(id);

let palette; // shared/palette.json
let classes; // seuils triés décroissants avec rgb pré-parsé
const species = new Map(); // id → { pm, names, group }
let altLayer = null; // PMTiles A (classes d'altitude) : { pm, label }, commun à toutes les espèces
let currentKey = null; // "s:<id>" ou "g:<group>"
let tileVersion = 0; // incrémenté pour forcer le rendu quand la météo ou le jour change
const transparentTile = makeTransparentTile();

// Météo : réponse de /weather/bbox pour l'emprise courante.
// cells : id → { lat, lon, elevation_m, alt_classes, stale, species: { sid: { date: { alt: {M_eff, phi} } } } }
// covered : dernière emprise entièrement reçue (avec sa marge), sa couche et son heure
const weather = { today: null, cells: new Map(), error: null, covered: null };
// Vue France : réponse de /departements pour la couche courante.
// byDept : code → { species: { sid: { date: {value, coverage} } }, groups: { gid: { date: {value, leading, coverage} } } }
const deptIndex = { today: null, key: null, byDept: new Map(), error: null };
const franceView = () => mode() === "S" && map.getZoom() < DEPT_ZOOM;
// refonte UX, lot 2 : le potentiel toute saison est une option, le score du jour la règle
const mode = () => ($("potential").checked ? "T" : "S"); // "T" ou "S"
let selectedDay = 0; // J−3 → J+7, choisi dans le bandeau des jours
const dayOffset = () => selectedDay;
const DAY_RANGE = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
const WEATHER_BLOCK = 16; // la cellule météo est cherchée par bloc de 16 px, pas par pixel
const OPACITY = 0.75; // opacité fixe de l'overlay (décision du 1er nov. 2026 : plus de réglage)
// Au-delà de cette distance de la cellule la plus proche (grille de 5 km, `cell_m` de
// weather_grid.json : une cellule et demie), le pixel n'a pas de météo et reste transparent,
// plutôt que de prendre celle d'une cellule chargée pour une autre emprise (étude du 4 nov. 2026).
const MAX_CELL_KM = 7.5;
const KM_PER_DEG = 111.2;
// Tuiles décodées gardées en mémoire (T par espèce et A, ≈ 260 Ko chacune) : changer de jour, de
// mode ou de météo ne relit rien sur le réseau, seule la colorisation est refaite.
const TILE_CACHE_MAX = 600;
// Lecture d'une tuile en échec (429 du limiteur, réseau) : réessais avant d'abandonner, MapLibre
// ne réessaie jamais de lui-même et laisserait la tuile blanche.
const TILE_RETRY_MS = [1500, 3000, 6000];
const WEATHER_TTL_MS = 30 * 60 * 1000; // une emprise contenue dans la dernière réponse ne redemande rien
const DEV = Site.isDev(location.search);

// ---------------------------------------------------------------- navigation et panneau

Site.renderNav("carte.html");
$("app-line").textContent = Site.APP_LINE;
$("dev").hidden = !DEV;

// Sur téléphone le panneau se replie sur une ligne (couche courante + bouton) ; sur ordinateur il
// est fixe à droite et la classe n'a aucun effet.
function setPanel(open) {
  $("panel").classList.toggle("collapsed", !open);
  $("toggle").setAttribute("aria-expanded", String(open));
  $("toggle").textContent = open ? "Fermer" : "Calque et légende";
}
setPanel(false);
$("toggle").addEventListener("click", () => setPanel($("panel").classList.contains("collapsed")));

// ---------------------------------------------------------------- palette

async function loadPalette() {
  const r = await fetch("../shared/palette.json");
  if (!r.ok) throw new Error("palette.json introuvable : servir la racine du dépôt");
  palette = await r.json();
  classes = [...palette.thresholds]
    .sort((a, b) => b.min - a.min)
    .map((t) => ({ ...t, rgb: hexToRgb(t.hex) }));
  Site.applyAccent(palette);
  Site.renderLegend($("legend"), classes);
}

function hexToRgb(hex) {
  const n = parseInt(hex.slice(1, 7), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function classify(t) {
  return classes.find((c) => t >= c.min) ?? classes[classes.length - 1];
}

// ---------------------------------------------------------------- tuiles

function makeTransparentTile() {
  const c = new OffscreenCanvas(TILE, TILE);
  c.getContext("2d");
  return c.convertToBlob({ type: "image/png" }).then((b) => b.arrayBuffer());
}

/** PNG de données → { v: valeur (premier canal), a: alpha (255 si le PNG n'en a pas) } par pixel.
 *  Décodage par `png.js`, jamais par canvas : getImageData passe par la gestion des couleurs du
 *  navigateur et Safari trame les gris (±1 niveau → points isolés près des seuils). */
async function pngPixels(buf) {
  const { width, height, channels, data } = await decodePng(buf);
  if (width !== TILE || height !== TILE) throw new Error(`Tuile ${width}×${height}, attendu ${TILE}`);
  const n = TILE * TILE;
  const v = new Uint8Array(n);
  const a = new Uint8Array(n).fill(255);
  const hasAlpha = channels === 2 || channels === 4;
  for (let i = 0; i < n; i++) {
    v[i] = data[i * channels];
    if (hasAlpha) a[i] = data[i * channels + channels - 1];
  }
  return { v, a };
}

/** PNG gris+alpha → Float32Array de T (NaN = nodata). */
async function decodeT(buf) {
  const { v, a } = await pngPixels(buf);
  const { scale, nodata } = palette.tile_encoding;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = a[i] === 0 || v[i] === nodata ? NaN : v[i] / scale;
  return out;
}

/** PNG de la couche A → indice de classe par pixel (nodata de la palette si inconnu). */
async function decodeAlt(buf) {
  const { v, a } = await pngPixels(buf);
  const { nodata } = palette.alt_encoding;
  const out = new Uint8Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = a[i] === 0 ? nodata : v[i];
  return out;
}

// ---------------------------------------------------------------- cache et lecture des tuiles

const tileCache = new Map(); // "<fichier>|z/x/y" → Promise<Float32Array | Uint8Array | null>, ordre LRU
let tileFailures = 0; // tuiles abandonnées après réessais (affiché en mode dev)

/** Promesse mise en cache par clé ; une lecture en échec est retirée pour être retentée plus tard. */
function cachedTile(key, load) {
  let p = tileCache.get(key);
  if (p) {
    tileCache.delete(key); // remis en fin de Map : le plus ancien est évincé en premier
    tileCache.set(key, p);
    return p;
  }
  p = load().catch((e) => {
    tileCache.delete(key);
    throw e;
  });
  tileCache.set(key, p);
  if (tileCache.size > TILE_CACHE_MAX) tileCache.delete(tileCache.keys().next().value);
  return p;
}

/** Octets d'une tuile d'un PMTiles (null si absente), avec réessais sur erreur réseau ou 429. */
async function tileBytes(pm, z, x, y) {
  for (let i = 0; ; i++) {
    try {
      return (await pm.getZxy(z, x, y))?.data ?? null;
    } catch (e) {
      if (i >= TILE_RETRY_MS.length) throw e;
      await new Promise((r) => setTimeout(r, TILE_RETRY_MS[i]));
    }
  }
}

/** Indices de classe d'altitude de la tuile, ou null sans couche A (ou hors de son emprise). */
function altTile(z, x, y) {
  if (!altLayer) return Promise.resolve(null);
  return cachedTile(`${altLayer.label}|${z}/${x}/${y}`, async () => {
    const data = await tileBytes(altLayer.pm, z, x, y);
    return data ? decodeAlt(data) : null;
  });
}

function layerSpecies(key) {
  const [kind, name] = key.split(":");
  if (kind === "s") return [species.get(name)].filter(Boolean);
  return [...species.values()].filter((s) => s.group?.id === name);
}

/** T de chaque espèce de la couche sur une tuile, lues en parallèle : [{ sid, t: Float32Array }]. */
async function speciesT(key, z, x, y) {
  const list = layerSpecies(key);
  const ts = await Promise.all(
    list.map((s) =>
      cachedTile(`${s.label}|${z}/${x}/${y}`, async () => {
        const data = await tileBytes(s.pm, z, x, y);
        return data ? decodeT(data) : null;
      })
    )
  );
  return list.map((s, i) => ({ sid: s.id, t: ts[i] })).filter((e) => e.t);
}

/** Valeur affichée par pixel : T (max du groupe) ou S = T × M_eff × Φ (max du groupe, règle 9). */
function combine(arrays, z, x, y, alt) {
  if (arrays.length === 0) return null;
  const out = new Float32Array(TILE * TILE).fill(NaN);
  const useWeather = mode() === "S";
  const blocks = TILE / WEATHER_BLOCK;
  for (const { sid, t } of arrays) {
    // cellule météo par bloc de 16 × 16 px (une cellule fait 5 km : largement assez fin) ;
    // la classe d'altitude, elle, est lue par pixel dans la couche A quand elle est chargée
    let w = null;
    if (useWeather) {
      w = [];
      for (let by = 0; by < blocks; by++) {
        for (let bx = 0; bx < blocks; bx++) {
          const [lon, lat] = tilePixelToLngLat(z, x, y, (bx + 0.5) * WEATHER_BLOCK, (by + 0.5) * WEATHER_BLOCK);
          const r = weatherRow(sid, lat, lon);
          w.push(r ? { ...r, byClass: new Map() } : null);
        }
      }
    }
    for (let i = 0; i < t.length; i++) {
      let v = t[i];
      if (Number.isNaN(v)) continue;
      if (w) {
        const r = w[Math.floor(i / TILE / WEATHER_BLOCK) * blocks + Math.floor((i % TILE) / WEATHER_BLOCK)];
        if (!r) continue; // pas de météo pour ce pixel : transparent, jamais 0,5
        const k = alt ? alt[i] : null;
        let f = r.byClass.get(k);
        if (f === undefined) {
          f = factorAt(r, k);
          r.byClass.set(k, f);
        }
        if (f === null) continue;
        v *= f;
      }
      if (Number.isNaN(out[i]) || v > out[i]) out[i] = v;
    }
  }
  return out;
}

function tilePixelToLngLat(z, x, y, px, py) {
  const n = 2 ** z;
  const lon = ((x + px / TILE) / n) * 360 - 180;
  const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / TILE)) / n))) * 180) / Math.PI;
  return [lon, lat];
}

/** Cellule météo la plus proche et sa ligne (par classe d'altitude) pour l'espèce et le jour ; null si inconnu. */
function weatherRow(sid, lat, lon) {
  const cell = nearestCell(lat, lon);
  const row = cell?.species[sid]?.[currentDate()];
  return row ? { cell, row } : null;
}

/** Centre (m) de la classe d'altitude à utiliser parmi celles que l'API a calculées pour la cellule :
 *  celle du pixel (indice k de la couche A) ; sans couche A ou altitude inconnue, celle de
 *  l'altitude médiane de la forêt de la cellule. */
function altCenter(cell, k) {
  const { class_m, nodata } = palette.alt_encoding;
  const alt = k === null || k === undefined || k === nodata ? cell.elevation_m : (k + 0.5) * class_m;
  const target = Math.floor(alt / class_m) * class_m + class_m / 2;
  return cell.alt_classes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
}

/** M_eff × Φ d'une ligne météo pour la classe d'altitude du pixel ; null si l'API ne l'a pas. */
function factorAt({ cell, row }, k) {
  const v = row[String(altCenter(cell, k))];
  return v ? v.M_eff * v.phi : null;
}

/** M_eff × Φ de l'espèce pour un point et un indice de classe d'altitude (null = inconnu). */
function weatherFactor(sid, lat, lon, k) {
  const r = weatherRow(sid, lat, lon);
  return r ? factorAt(r, k) : null;
}

/** Cellule météo la plus proche à moins de MAX_CELL_KM, sinon null (pixel sans météo : transparent). */
function nearestCell(lat, lon) {
  let best = null;
  let bestD = (MAX_CELL_KM / KM_PER_DEG) ** 2;
  const k = Math.cos((lat * Math.PI) / 180);
  for (const c of weather.cells.values()) {
    const d = (c.lat - lat) ** 2 + ((c.lon - lon) * k) ** 2;
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

function currentDate() {
  if (!weather.today) return null;
  const d = new Date(weather.today + "T12:00:00");
  d.setDate(d.getDate() + dayOffset());
  return d.toISOString().slice(0, 10);
}

async function colorize(t) {
  const c = new OffscreenCanvas(TILE, TILE);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < t.length; i++) {
    if (Number.isNaN(t[i])) continue;
    const [r, g, b] = classify(t[i]).rgb;
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return (await c.convertToBlob({ type: "image/png" })).arrayBuffer();
}

if (typeof maplibregl === "undefined" || typeof pmtiles === "undefined") {
  $("weather-status").textContent = "La carte ne s'est pas chargée : vérifiez la connexion puis rechargez la page.";
  throw new Error("MapLibre ou PMTiles absent (CDN injoignable)");
}

maplibregl.addProtocol("champis", async (params) => {
  const m = params.url.match(/^champis:\/\/([^/]+)\/v\d+\/(\d+)\/(\d+)\/(\d+)$/);
  if (!m) throw new Error(`URL invalide : ${params.url}`);
  const [z, x, y] = [+m[2], +m[3], +m[4]];
  let arrays;
  let alt;
  try {
    // T des espèces et A en parallèle (cache mémoire : une lecture réseau par fichier et par tuile)
    [arrays, alt] = await Promise.all([speciesT(m[1], z, x, y), mode() === "S" ? altTile(z, x, y) : null]);
  } catch (e) {
    // Après les réessais : tuile transparente plutôt qu'en erreur. MapLibre ne redemande jamais une
    // tuile en erreur ; celle-ci sera relue au prochain rendu (déplacement, jour, météo).
    ++tileFailures;
    console.warn(`tuile ${z}/${x}/${y} abandonnée : ${e.message}`);
    if (DEV) $("status").textContent = $("status").textContent.replace(/\n?\d+ tuile\(s\) en échec$/, "") + `\n${tileFailures} tuile(s) en échec`;
    return { data: await transparentTile };
  }
  const v = combine(arrays, z, x, y, alt);
  return { data: v ? await colorize(v) : await transparentTile };
});

// ---------------------------------------------------------------- carte

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [6.35, 47.1], // Doubs
  zoom: 9,
  hash: true,
  attributionControl: { compact: false },
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-right");

function setBasemap(name) {
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  map.addSource("basemap", { type: "raster", tileSize: TILE, ...BASEMAPS[name] });
  const above = ["depts-fill", "T"].find((id) => map.getLayer(id));
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, above);
}

/** Départements (contours IGN Admin Express simplifiés, Licence ouverte) colorés par l'indice du jour. */
function addDeptLayers() {
  map.addSource("depts", { type: "geojson", data: "departements.geojson", promoteId: "code" });
  // toujours présent, invisible hors vue France : sert aussi à trouver le département sous le centre
  map.addLayer({
    id: "depts-fill",
    type: "fill",
    source: "depts",
    paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0 },
  });
  map.addLayer({
    id: "depts-line",
    type: "line",
    source: "depts",
    maxzoom: DEPT_ZOOM,
    layout: { visibility: "none" },
    paint: { "line-color": "rgba(0,0,0,.35)", "line-width": 0.8 },
  });
}

function deptSeries(code) {
  const d = deptIndex.byDept.get(code);
  if (!d || !currentKey) return null;
  const [kind, name] = currentKey.split(":");
  return (kind === "g" ? d.groups[name] : d.species[name]) ?? null;
}

/** Recolore les départements pour la couche et le jour courants (aucun appel réseau). */
function paintDepts() {
  updateTileVisibility();
  const show = franceView() && deptIndex.key === currentKey && deptIndex.byDept.size > 0;
  if (map.getLayer("depts-line")) map.setLayoutProperty("depts-line", "visibility", show ? "visible" : "none");
  if (!show) {
    if (map.getLayer("depts-fill")) map.setPaintProperty("depts-fill", "fill-opacity", 0);
    paintDays();
    return;
  }
  const date = currentDate();
  const expr = ["match", ["get", "code"]];
  for (const code of deptIndex.byDept.keys()) {
    const v = deptSeries(code)?.[date]?.value;
    if (v === null || v === undefined) continue;
    expr.push(code, classify(v).hex);
  }
  expr.push("rgba(0,0,0,0)"); // département sans indice : transparent, jamais une valeur inventée
  map.setPaintProperty("depts-fill", "fill-color", expr.length > 3 ? expr : "rgba(0,0,0,0)");
  map.setPaintProperty("depts-fill", "fill-opacity", OPACITY);
  paintDays();
}

/** Département sous le centre de la carte, par les polygones déjà rendus (couche invisible). */
function centerDept() {
  if (!map.getLayer("depts-fill")) return null;
  const f = map.queryRenderedFeatures(map.project(map.getCenter()), { layers: ["depts-fill"] })[0];
  return f?.properties?.code ?? null;
}

/** Jour ISO pour un décalage J+k. */
const dateFor = (k) => Site.dateFor(weather.today, k);

/** Bandeau des onze jours (lot 2, rendu par site.js au lot 5) : une pastille par jour, colorée par
 *  l'indice du département sous le centre de la carte (GET /departements). */
function buildDays() {
  paintDays();
}

function paintDays() {
  const code = deptIndex.byDept.size > 0 && deptIndex.key === currentKey ? centerDept() : null;
  Site.renderDays($("days"), {
    today: weather.today,
    selected: selectedDay,
    classes: classes ?? [],
    valueFor: (iso) => (code ? deptSeries(code)?.[iso]?.value ?? null : null),
    onSelect: (k) => {
      selectedDay = k;
      updateDayLabel();
      setLayer(currentKey);
      paintDepts();
    },
  });
  const layer = $("layer");
  $("mobile-layer").textContent = layer.disabled ? "Carte" : layer.options[layer.selectedIndex]?.text ?? "Carte";
}

const frenchDate = Site.frenchDate;

/** Couche de tuiles à (re)rendre pour la clé, le jour, le mode et la météo courants. La source
 *  n'est jamais recréée : `setTiles` avec une nouvelle version fait recharger les tuiles en gardant
 *  l'image précédente à l'écran jusqu'à la suivante (plus de carte vidée carré par carré), et les
 *  octets viennent du cache mémoire. */
function setLayer(key) {
  currentKey = key;
  if (!key) {
    updateTileVisibility();
    return;
  }
  const url = `champis://${key}/v${++tileVersion}/{z}/{x}/{y}`;
  const src = map.getSource("T");
  if (src) {
    src.setTiles([url]);
  } else {
    map.addSource("T", { type: "raster", tiles: [url], tileSize: TILE, minzoom: MIN_ZOOM, maxzoom: MAX_ZOOM });
    map.addLayer({
      id: "T",
      type: "raster",
      source: "T",
      paint: { "raster-opacity": OPACITY, "raster-resampling": "nearest" },
    });
  }
  updateTileVisibility();
}

/** En vue France (mode S sous le zoom 9), la couche de tuiles est cachée : aucune requête de tuile
 *  et rien de dessiné par-dessus les départements. */
function updateTileVisibility() {
  if (!map.getLayer("T")) return;
  map.setLayoutProperty("T", "visibility", currentKey && !franceView() ? "visible" : "none");
}

map.on("load", () => {
  setBasemap($("basemap").value);
  addDeptLayers();
  buildDays();
  loadPalette()
    .then(() => loadFromQuery() || loadFromApi())
    .catch((e) => ($("status").textContent = e.message));
});

$("basemap").addEventListener("change", (e) => setBasemap(e.target.value));
$("layer").addEventListener("change", (e) => {
  setLayer(e.target.value);
  deptIndex.byDept.clear();
  deptIndex.key = null;
  fetchWeather();
  fetchDeptIndex(); // le bandeau des jours en a besoin à tout zoom
});
$("potential").addEventListener("change", () => {
  $("weather-status").hidden = mode() !== "S";
  $("potential-note").hidden = mode() !== "T";
  setLayer(currentKey);
  fetchWeather();
});
// API : même origine (la page est servie par champis-api), ou `?api=` en dev statique (Site.apiBase).
$("api").value = Site.apiBase(location);
$("api").addEventListener("change", fetchWeather);
let moveTimer = null;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(() => {
    fetchWeather();
    paintDays();
  }, 300);
});

// ---------------------------------------------------------------- météo (API)

function updateDayLabel() {
  const d = currentDate();
  $("day-label").textContent = d ? (dayOffset() === 0 ? `Aujourd'hui, ${frenchDate(d)}` : frenchDate(d)) : "";
  paintDays();
}

/** L'emprise demandée tient-elle dans la dernière réponse complète, pour la même couche, de
 *  moins de WEATHER_TTL_MS ? (même règle que `MapModel.weatherAlreadyCovers` dans l'app) */
function weatherCovers(box) {
  const c = weather.covered;
  if (!c || c.key !== currentKey || Date.now() - c.at > WEATHER_TTL_MS) return false;
  return box[0] >= c.box[0] && box[1] >= c.box[1] && box[2] <= c.box[2] && box[3] <= c.box[3];
}

let weatherAbort = null;
let retryTimer = null;
async function fetchWeather() {
  if (mode() !== "S" || !currentKey) {
    paintDepts();
    return;
  }
  if (franceView()) {
    weatherAbort?.abort();
    await fetchDeptIndex();
    return;
  }
  paintDepts(); // cache la vue France si on vient de zoomer
  const ids = layerSpecies(currentKey).map((s) => s.id);
  if (ids.length === 0) return;
  const b = map.getBounds();
  const pad = 0.1; // ~ une cellule de marge pour le voisin le plus proche en bord d'écran
  const box = [b.getWest() - pad, b.getSouth() - pad, b.getEast() + pad, b.getNorth() + pad];
  if (weatherCovers(box)) {
    setLayer(currentKey); // zoom avant ou petit déplacement : les cellules sont déjà là
    return;
  }
  weatherAbort?.abort();
  weatherAbort = new AbortController();
  const q = new URLSearchParams({ min_lon: box[0], min_lat: box[1], max_lon: box[2], max_lat: box[3] });
  for (const id of ids) q.append("species", id);
  $("weather-status").textContent = "Météo : chargement…";
  try {
    const r = await fetch(`${$("api").value.replace(/\/$/, "")}/weather/bbox?${q}`, {
      signal: weatherAbort.signal,
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.json()).detail ?? ""}`);
    const body = await r.json();
    weather.today = body.today;
    weather.error = null;
    for (const c of body.cells) {
      const entry = weather.cells.get(c.cell.id) ?? {
        ...c.cell,
        species: {},
      };
      entry.stale = c.stale;
      for (const [sid, rows] of Object.entries(c.species)) {
        entry.species[sid] = Object.fromEntries(rows.map((row) => [row.date, row.by_alt]));
      }
      weather.cells.set(c.cell.id, entry);
    }
    const stale = body.cells.some((c) => c.stale);
    const missing = body.unavailable?.length ?? 0;
    weather.covered = missing ? null : { box, key: currentKey, at: Date.now() };
    const notes = [
      stale ? "Météo du dernier passage : le serveur n'a pas pu la rafraîchir." : "",
      missing ? `Météo manquante sur une partie de l'emprise${body.retry_after ? `, nouvel essai dans ${body.retry_after} s` : ""}.` : "",
    ].filter(Boolean);
    $("weather-status").textContent = DEV
      ? [`Météo : ${body.cells.length} cellule(s) dans l'emprise`, ...notes].join(" — ")
      : notes.join(" ");
    if (missing && body.retry_after && body.retry_after <= 120) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(fetchWeather, body.retry_after * 1000 + 500);
    }
    updateDayLabel();
    setLayer(currentKey);
  } catch (e) {
    if (e.name === "AbortError") return;
    weather.error = e.message;
    $("weather-status").textContent = `Météo indisponible : ${e.message}`;
  }
}

/** `GET /departements` pour la couche courante : 11 jours d'un coup, le curseur de jour ne
 *  recharge rien. Les espèces demandées sont celles de la couche (espèce seule ou groupe). */
let deptAbort = null;
async function fetchDeptIndex() {
  const ids = layerSpecies(currentKey).map((s) => s.id);
  if (ids.length === 0) return;
  if (deptIndex.key === currentKey && deptIndex.byDept.size > 0) {
    paintDepts();
    $("weather-status").textContent = deptStatus();
    return;
  }
  deptAbort?.abort();
  deptAbort = new AbortController();
  const q = new URLSearchParams();
  for (const id of ids) q.append("species", id);
  $("weather-status").textContent = "Vue France : chargement de l'indice par département…";
  try {
    const r = await fetch(`${$("api").value.replace(/\/$/, "")}/departements?${q}`, {
      signal: deptAbort.signal,
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.json()).detail ?? ""}`);
    const body = await r.json();
    deptIndex.today = body.today;
    deptIndex.key = currentKey;
    deptIndex.error = null;
    deptIndex.byDept.clear();
    for (const [code, d] of Object.entries(body.departements)) {
      const toMap = (rows) => Object.fromEntries(rows.map((row) => [row.date, row]));
      deptIndex.byDept.set(code, {
        species: Object.fromEntries(Object.entries(d.species).map(([sid, rows]) => [sid, toMap(rows)])),
        groups: Object.fromEntries(Object.entries(d.groups).map(([gid, rows]) => [gid, toMap(rows)])),
      });
    }
    if (!weather.today) weather.today = body.today; // le bandeau des jours a besoin de J
    updateDayLabel();
    paintDepts();
    if (franceView()) $("weather-status").textContent = deptStatus();
  } catch (e) {
    if (e.name === "AbortError") return;
    deptIndex.error = e.message;
    $("weather-status").textContent = `Vue France indisponible : ${e.message}`;
  }
}

function deptStatus() {
  const n = deptIndex.byDept.size;
  const date = currentDate();
  const covered = [...deptIndex.byDept.keys()].filter((c) => deptSeries(c)?.[date]?.value != null).length;
  return DEV
    ? `Vue France : indice par département (${covered}/${n} couverts) — zoomez pour la parcelle`
    : "Vue par département : zoomez pour voir la parcelle.";
}

// ---------------------------------------------------------------- chargement des PMTiles

async function addSource(src, label) {
  if (/(?:^|\/)A-\d+m-/.test(label)) {
    const pm = new pmtiles.PMTiles(src);
    await pm.getHeader(); // échoue tout de suite (CORS, 403…) plutôt qu'au premier rendu
    altLayer = { pm, label };
    ++tileVersion;
    return "A";
  }
  const id = label.match(/(?:^|\/)T-([a-z_]+)-/)?.[1];
  if (!id) throw new Error(`Nom inattendu (T-<espèce>-… ou A-…pmtiles) : ${label}`);
  const pm = new pmtiles.PMTiles(src);
  const header = await pm.getHeader();
  const meta = await fetch(`../species/${id}.json`).then((r) => (r.ok ? r.json() : null));
  species.set(id, {
    id,
    pm,
    label, // clé du cache de tuiles : le nom du fichier porte le hash de l'espèce et du jeu
    names: meta?.names ?? { fr: id, la: "" },
    group: meta?.group ?? null,
    bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
  });
  return id;
}

async function addMany(items) {
  const first = species.size === 0;
  const errors = [];
  let loaded = 0;
  for (const { src, label } of items) {
    try {
      await addSource(src, label);
      ++loaded;
    } catch (e) {
      errors.push(`${label} : ${e.message}`);
    }
  }
  refreshLayerList();
  if (first && species.size > 0) {
    const b = [...species.values()][0].bounds;
    map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 20, duration: 0 });
  }
  $("status").textContent = [
    `${species.size} espèce(s) : ${[...species.values()].map((s) => s.names.fr).join(", ")}`,
    altLayer
      ? "Classes d'altitude : couche A chargée (gel et phénologie par pixel)"
      : "Sans couche A : classe d'altitude = altitude médiane de la cellule météo",
    ...errors,
  ].join("\n");
  if (!DEV && species.size === 0) {
    $("weather-status").textContent = "Aucune carte publiée pour le moment.";
  }
  if (currentKey) setLayer(currentKey); // une couche A ajoutée après coup change le rendu S
  fetchWeather();
  return loaded;
}

function refreshLayerList() {
  const sel = $("layer");
  sel.innerHTML = "";
  const groups = new Map();
  for (const s of species.values()) if (s.group) groups.set(s.group.id, s.group.fr);
  for (const [gid, fr] of groups) {
    sel.add(new Option(fr, `g:${gid}`));
  }
  for (const [id, s] of [...species].sort((a, b) => a[1].names.fr.localeCompare(b[1].names.fr))) {
    sel.add(new Option(s.names.fr, `s:${id}`));
  }
  sel.disabled = species.size === 0;
  if (species.size > 0 && (!currentKey || ![...sel.options].some((o) => o.value === currentKey))) {
    sel.value = sel.options[0].value;
    setLayer(sel.value);
  }
}

function loadFromQuery() {
  const q = new URLSearchParams(location.search).get("tiles");
  if (!q) return null;
  return addMany(q.split(",").map((u) => ({ src: u, label: u })));
}

/** PMTiles publiés dans le bucket : `GET /tiles` renvoie une URL par fichier (présignée, ou
 *  relais /tiles/<nom> en mode proxy). Sans bucket configuré, on garde le glisser-déposer. */
async function loadFromApi() {
  const base = $("api").value.replace(/\/$/, "");
  let body;
  try {
    const r = await fetch(`${base}/tiles`);
    if (!r.ok) return;
    body = await r.json();
  } catch {
    return; // API absente : page statique seule
  }
  if (!body.configured || body.tiles.length === 0) return;
  // Plusieurs jeux de départements peuvent coexister dans le bucket (Doubs seul, France…) ; une
  // espèce n'a qu'une couche à la fois : on garde le jeu qui couvre le plus de départements.
  const dh = pickDeptsHash(body);
  const tiles = body.tiles.filter((t) => t.depts_hash === dh);
  const items = tiles.map((t) => ({
    src: /^https?:/.test(t.url) ? t.url : `${base}${t.url}`,
    label: t.name,
  }));
  const loaded = await addMany(items);
  const hint =
    loaded < items.length && body.mode === "presign"
      ? " — si le navigateur bloque les URL présignées (CORS), passer l'API en CHAMPIS_TILES_MODE=proxy"
      : "";
  const nDepts = body.depts_by_hash?.[dh]?.length;
  const jeu = nDepts ? `jeu d${dh} (${nDepts} département${nDepts > 1 ? "s" : ""})` : `jeu d${dh}`;
  $("status").textContent +=
    `\n${loaded}/${items.length} fichier(s) chargés depuis le bucket (${body.mode}), ${jeu}`;
}

/** Hash de départements à afficher : le plus de départements d'après le manifeste, sinon le plus
 *  de fichiers ; à égalité, le dernier par ordre alphabétique (souvent le plus récent). */
function pickDeptsHash(body) {
  const counts = new Map();
  for (const t of body.tiles) counts.set(t.depts_hash, (counts.get(t.depts_hash) ?? 0) + 1);
  const score = (h) => [body.depts_by_hash?.[h]?.length ?? 0, counts.get(h), h];
  return [...counts.keys()].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2]);
  }).at(-1);
}

const drop = $("drop");
drop.addEventListener("click", () => $("files").click());
$("files").addEventListener("change", (e) => addFiles(e.target.files));
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  addFiles(e.dataTransfer.files);
});

function addFiles(files) {
  return addMany(
    [...files].map((f) => ({ src: new pmtiles.FileSource(f), label: f.name }))
  );
}

// ---------------------------------------------------------------- sonde au clic

const probe = $("probe");
/** Phrase de terrain depuis le libellé de palette de T : l'API ne connaît pas le pixel (lot 2). */
function terrainPhrase(t) {
  const label = classify(t).label;
  if (label === "excellent") return "terrain très favorable";
  if (label === "bon") return "terrain favorable";
  if (label === "moyen") return "terrain moyen";
  return "terrain peu favorable";
}

const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

/** Fiche en clair (lot 2) : libellé et jour, espèce, phrases, puis les chiffres derrière Détails. */
function renderProbe({ value, name, phrases, details }) {
  const cls = classify(value);
  const when = currentDate() ? Site.whenWord(currentDate(), weather.today) : "";
  const sub = [name, currentDate() ? frenchDate(currentDate()) : ""].filter(Boolean).join(" · ");
  probe.innerHTML =
    `<h2><span class="dot" style="background:${cls.hex}"></span>${esc(cls.fr)} ${mode() === "S" ? esc(when) : "toute saison"}</h2>` +
    `<div class="sub">${esc(sub)}</div>` +
    (phrases.length ? `<ul>${phrases.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "") +
    `<details><summary>Détails</summary><div>${esc(details)}</div></details>` +
    `<button type="button" class="button quiet small" id="probe-close">Fermer</button>`;
  $("probe-close").addEventListener("click", () => (probe.style.display = "none"));
}

/** Phrases météo et saison de `GET /weather` › `summary` pour une cellule, une espèce, un jour, une classe. */
async function fetchSummary(cellId, sid, altKey) {
  const q = new URLSearchParams({ cell: cellId, species: sid });
  const r = await fetch(`${$("api").value.replace(/\/$/, "")}/weather?${q}`);
  if (!r.ok) return { summary: [], factors: null };
  const body = await r.json();
  const row = body.species?.[sid]?.find((d) => d.date === currentDate())?.by_alt?.[altKey];
  return { summary: row?.summary ?? [], factors: row?.factors ?? null, triggerDays: row?.trigger_days ?? null };
}

map.on("click", async (e) => {
  if (!currentKey) return;
  if (franceView()) {
    const f = map.queryRenderedFeatures(e.point, { layers: ["depts-fill"] })[0];
    probe.style.display = "block";
    if (!f) {
      probe.textContent = "Hors département";
      return;
    }
    const row = deptSeries(f.properties.code)?.[currentDate()];
    if (!row || row.value === null) {
      probe.textContent = `${f.properties.nom} (${f.properties.code}) : pas d'indice (météo manquante)`;
      return;
    }
    const lead = row.leading ? species.get(row.leading)?.names.fr ?? row.leading : "";
    renderProbe({
      value: row.value,
      name: `${f.properties.nom} (${f.properties.code})${lead ? ` · ${lead}` : ""}`,
      phrases: [`indice du département, pour la forêt entière`, `météo connue sur ${(row.coverage * 100).toFixed(0)} % de la forêt`],
      details: `indice ${row.value.toFixed(3)} · couverture ${(row.coverage * 100).toFixed(0)} % · ${currentDate()}`,
    });
    return;
  }
  const z = MAX_ZOOM;
  const n = TILE * 2 ** z;
  const lat = (e.lngLat.lat * Math.PI) / 180;
  const px = ((e.lngLat.lng + 180) / 360) * n;
  const py = ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n;
  const tx = Math.floor(px / TILE);
  const ty = Math.floor(py / TILE);
  const i = Math.floor(py % TILE) * TILE + Math.floor(px % TILE);
  const arrays = await speciesT(currentKey, z, tx, ty);
  const altIdx = (await altTile(z, tx, ty))?.[i] ?? null;
  probe.style.display = "block";
  // meilleure espèce du groupe au point cliqué (T seul, ou S si la météo est affichée)
  let best = null;
  for (const { sid, t } of arrays) {
    const T = t[i];
    if (Number.isNaN(T)) continue;
    const w = mode() === "S" ? weatherFactor(sid, e.lngLat.lat, e.lngLat.lng, altIdx) : 1;
    if (w === null) continue;
    const v = T * w;
    if (!best || v > best.v) best = { sid, T, v };
  }
  if (!best) {
    probe.textContent = mode() === "S" && arrays.some((a) => !Number.isNaN(a.t[i]))
      ? "Pas de météo pour ce secteur aujourd'hui : le serveur réessaie."
      : "Hors forêt ou pas de donnée ici.";
    return;
  }
  const name = species.get(best.sid)?.names.fr ?? best.sid;
  const { class_m, nodata } = palette.alt_encoding;
  if (mode() === "T") {
    // sans météo, la classe vient de la couche A seule (pas de cellule pour s'y rabattre)
    const alt = altIdx !== null && altIdx !== nodata ? `altitude ${altIdx * class_m}–${(altIdx + 1) * class_m} m` : "altitude inconnue";
    renderProbe({
      value: best.T,
      name,
      phrases: [terrainPhrase(best.T), "potentiel toute saison, sans la météo"],
      details: `T = ${best.T.toFixed(3)} · ${alt}`,
    });
    return;
  }
  const cell = nearestCell(e.lngLat.lat, e.lngLat.lng);
  const w = best.v / best.T;
  const altKey = String(altCenter(cell, altIdx));
  const altTxt = altLayer && altIdx !== null && altIdx !== nodata ? "" : " (médiane cellule)";
  renderProbe({ value: best.v, name, phrases: [terrainPhrase(best.T), "météo : chargement…"], details: "…" });
  const { summary, factors } = await fetchSummary(cell.id, best.sid, altKey);
  const factorsTxt = factors
    ? Object.entries(factors).filter(([k]) => k !== "M").map(([k, v]) => `${k} ${(+v).toFixed(2)}`).join(" · ")
    : "facteurs indisponibles";
  renderProbe({
    value: best.v,
    name,
    phrases: [terrainPhrase(best.T), ...summary],
    details:
      `S = ${best.v.toFixed(3)} · T ${best.T.toFixed(2)} × M_eff·Φ ${w.toFixed(2)} · cellule ${cell.id}` +
      ` · classe ${altKey} m${altTxt}${cell.stale ? " · météo périmée" : ""}\n${factorsTxt}`,
  });
});
