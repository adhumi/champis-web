/* Page Carte du site (carte.html) : potentiel terrain T (PMTiles gris 8 bits par espèce, ou un
 * PMTiles RGBA par groupe d'affichage — G — dès qu'il est publié, spec › Points ouverts › Les
 * clients lisent les PMTiles par groupe, 5 nov. 2026) colorisé côté client avec
 * shared/palette.json, et score du jour S = T × M_eff × Φ avec les valeurs de l'API
 * (/weather/bbox à partir du zoom 9 : M_eff et Φ par cellule 5 km, onze jours et classe
 * d'altitude ; /weather/field en dessous : M_eff × Φ du jour courant sur toute l'emprise, spec ›
 * Points ouverts › Carte visible dès l'ouverture, 4 nov. 2026). Aucune valeur de modèle ici :
 * palette, seuils, encodage des tuiles et noms d'espèces sont lus depuis le dépôt, M et Φ depuis
 * l'API (servir la racine du dépôt, voir README). Dates, légende, pastilles et navigation viennent
 * de site.js (lot 5), la fusion des réponses météo, l'index spatial des cellules et le facteur
 * d'un pixel de field.js, la séparation des canaux d'un G et le plan de lecture d'une couche de
 * groups.js ; le glisser-déposer et l'adresse de l'API sont des outils de développement
 * (`?dev=1`). */

const TILE = 256;
const MIN_ZOOM = 6;
const MAX_ZOOM = 15;

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
const species = new Map(); // id → { pm (null si l'espèce n'a que son G), label, names, group, bounds }
// Fichiers G du jeu courant : clé "<groupe>" ou "<groupe>-<partie>" → { id, group, pm, label,
// species: [ids dans l'ordre des canaux], bounds }. Quand toutes les espèces demandées d'une couche
// ont un canal dans un G, une seule tuile G est lue pour elles (2 requêtes Range par tuile avec A,
// au lieu de 5 pour les cèpes) ; sinon, repli sur les T. La page marche dans les deux cas.
const groups = new Map();
let altLayer = null; // PMTiles A (classes d'altitude) : { pm, label }, commun à toutes les espèces
let currentKey = null; // "s:<id>" ou "g:<group>"
let tileVersion = 0; // incrémenté pour forcer le rendu quand la météo ou le jour change
const transparentTile = makeTransparentTile();

// Météo : cellules reçues de /weather/bbox (onze jours, à partir du zoom FIELD_ZOOM) et de
// /weather/field (un jour, en dessous), fusionnées par field.js dans une seule structure :
// cells : id → { lat, lon, elevation_m, alt_classes, stale, f: { sid: { date: [M_eff × Φ par classe] } } }
// index : casiers de 0,05° sur `cells`, reconstruit à chaque fusion (cellule la plus proche)
// covered : dernière emprise entièrement reçue de /weather/bbox (avec sa marge), sa couche, son heure
// fieldCovered : jour → même chose pour /weather/field, pour que revenir sur un jour déjà vu ne
// redemande rien (spec › Points ouverts › Carte visible dès l'ouverture, 4 nov. 2026)
const weather = { today: null, computedAt: null, cells: new Map(), index: null, error: null, covered: null, fieldCovered: new Map() };
// Le bandeau des jours et l'indice par département (/departements) qui le colorait sont retirés de la
// carte (spec › Produit › étape A, 6 nov. 2026) : la carte montre toujours aujourd'hui, les onze
// jours d'un point sont dans sa fiche.
// refonte UX, lot 2 : le potentiel toute saison est une option, le score du jour la règle
const mode = () => ($("potential").checked ? "T" : "S"); // "T" ou "S"
// La cellule météo est cherchée par bloc de pixels, pas par pixel (Field.blockPx : 16 px à partir
// du zoom 9, moins en dessous), à moins de Field.MAX_CELL_KM (7,5 km), sinon le pixel est
// transparent plutôt que de prendre la météo d'une cellule chargée pour une autre emprise.
const OPACITY = 0.75; // opacité fixe de l'overlay (décision du 1er nov. 2026 : plus de réglage)
// Tuiles décodées gardées en mémoire (T par espèce et A, ≈ 260 Ko chacune ; une tuile G compte
// pour autant d'unités que de canaux, ses quatre T restant ensemble dans l'entrée) : changer de
// jour, de mode ou de météo ne relit rien sur le réseau, seule la colorisation est refaite.
const TILE_CACHE_MAX = 600;
// Lecture d'une tuile en échec (429 du limiteur, réseau) : réessais avant d'abandonner, MapLibre
// ne réessaie jamais de lui-même et laisserait la tuile blanche.
const TILE_RETRY_MS = [1500, 3000, 6000];
const WEATHER_TTL_MS = 30 * 60 * 1000; // une emprise contenue dans la dernière réponse ne redemande rien
const WEATHER_PAD = 0.1; // marge (°) autour de l'emprise visible : ~ une cellule pour le voisin le plus proche en bord d'écran
const DEV = Site.isDev(location.search);
// Vue partagée (`#zoom/lat/lon`) : lue avant que MapLibre n'écrive le sien, on ne la recadre pas.
const SHARED_VIEW = location.hash.length > 1;

// ---------------------------------------------------------------- navigation et panneau

Site.renderNav("carte.html");
if (Site.APP_LINE) $("app-line").textContent = Site.APP_LINE;
else $("app-line").remove();
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

/** PNG RGBA d'un G → un Float32Array de T par canal (NaN = nodata du canal) ; l'alpha est une
 *  donnée, jamais une transparence (`group_tile_encoding` de la palette). */
async function decodeG(buf) {
  const enc = palette.group_tile_encoding;
  const { width, height, channels, data } = await decodePng(buf);
  if (width !== TILE || height !== TILE) throw new Error(`Tuile ${width}×${height}, attendu ${TILE}`);
  const expected = Groups.channelCount(enc);
  if (channels !== expected) throw new Error(`Tuile G à ${channels} canaux, attendu ${expected} (${enc.channels})`);
  return Groups.channelsToT(data, channels, enc);
}

// ---------------------------------------------------------------- cache et lecture des tuiles

// "<fichier>|z/x/y" → { p: Promise<Float32Array | Float32Array[] | Uint8Array | null>, w: poids }, ordre LRU
const tileCache = new Map();
let tileCacheWeight = 0;
let tileFailures = 0; // tuiles abandonnées après réessais (affiché en mode dev)

function evictTile(key) {
  const e = tileCache.get(key);
  if (!e) return;
  tileCache.delete(key);
  tileCacheWeight -= e.w;
}

/** Promesse mise en cache par clé ; une lecture en échec est retirée pour être retentée plus tard.
 *  `weight` : unités de TILE_CACHE_MAX que l'entrée occupe (1 par tableau de 256 × 256). */
function cachedTile(key, load, weight = 1) {
  const e = tileCache.get(key);
  if (e) {
    tileCache.delete(key); // remis en fin de Map : le plus ancien est évincé en premier
    tileCache.set(key, e);
    return e.p;
  }
  const p = load().catch((err) => {
    evictTile(key);
    throw err;
  });
  tileCache.set(key, { p, w: weight });
  tileCacheWeight += weight;
  while (tileCacheWeight > TILE_CACHE_MAX && tileCache.size > 1) evictTile(tileCache.keys().next().value);
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

/** Les T des canaux d'une tuile G (Float32Array[] gardés ensemble), ou null si la tuile est
 *  absente du fichier : une lecture réseau par fichier G et par tuile, quelle que soit l'espèce. */
function groupTile(g, z, x, y) {
  return cachedTile(
    `${g.label}|${z}/${x}/${y}`,
    async () => {
      const data = await tileBytes(g.pm, z, x, y);
      return data ? decodeG(data) : null;
    },
    g.species.length
  );
}

/** T d'une espèce depuis son propre fichier T (null sans fichier ou hors de son emprise). */
function singleTile(s, z, x, y) {
  if (!s?.pm) return Promise.resolve(null);
  return cachedTile(`${s.label}|${z}/${x}/${y}`, async () => {
    const data = await tileBytes(s.pm, z, x, y);
    return data ? decodeT(data) : null;
  });
}

function layerSpecies(key) {
  const [kind, name] = key.split(":");
  if (kind === "s") return [species.get(name)].filter(Boolean);
  return [...species.values()].filter((s) => s.group?.id === name);
}

/** T de chaque espèce de la couche sur une tuile, lues en parallèle : [{ sid, t: Float32Array }],
 *  dans l'ordre de `layerSpecies`. Une espèce qui a un canal dans un G chargé est lue dans ce G
 *  (une seule lecture par fichier G, partagée par ses espèces), les autres dans leur T : le
 *  résultat a la même forme dans les deux cas, `combine`, la colorisation et la sonde au clic ne
 *  voient pas la différence. */
async function speciesT(key, z, x, y) {
  const list = layerSpecies(key);
  const { grouped, single } = Groups.plan(list.map((s) => s.id), groups.values());
  const reads = [
    ...grouped.map(({ group, picks }) =>
      groupTile(group, z, x, y).then((chs) => picks.map(({ sid, channel }) => [sid, chs ? chs[channel] : null]))
    ),
    ...single.map((sid) => singleTile(species.get(sid), z, x, y).then((t) => [[sid, t]])),
  ];
  const bySid = new Map((await Promise.all(reads)).flat());
  return list.map((s) => ({ sid: s.id, t: bySid.get(s.id) ?? null })).filter((e) => e.t);
}

const nCanaux = (n) => `${n} ${n > 1 ? "canaux" : "canal"}`;

/** Pour le mode dev : le ou les fichiers que lit la couche courante (« G cepes » ou « 4 T »). */
function readPlanText(key) {
  const { grouped, single } = Groups.plan(layerSpecies(key).map((s) => s.id), groups.values());
  const parts = grouped.map(({ group, picks }) => `G ${group.group} (${nCanaux(picks.length)})`);
  const withT = single.filter((sid) => species.get(sid)?.pm).length;
  if (withT) parts.push(`${withT} T`);
  return parts.join(" + ") || "rien";
}

/** Valeur affichée par pixel : T (max du groupe) ou S = T × M_eff × Φ (max du groupe, règle 9).
 *  En mode S, la cellule météo est cherchée une fois par bloc de pixels (Field.tileCells), pour
 *  toutes les espèces ; le facteur M_eff × Φ est mémorisé par cellule et classe d'altitude, la
 *  classe étant lue par pixel dans la couche A quand elle est chargée. Un pixel sans cellule à
 *  moins de 7,5 km, ou dont la cellule n'a pas le jour demandé, reste transparent (jamais 0,5). */
function combine(arrays, z, x, y, alt) {
  if (arrays.length === 0) return null;
  const out = new Float32Array(TILE * TILE).fill(NaN);
  const useWeather = mode() === "S";
  const date = currentDate();
  const block = useWeather ? Field.blockPx(z) : TILE;
  const blocks = TILE / block;
  const cells = useWeather ? Field.tileCells(weather.index, z, x, y, TILE, block) : null;
  for (const { sid, t } of arrays) {
    const memo = useWeather ? new Map() : null; // cellule → Map(classe → facteur)
    for (let py = 0; py < TILE; py++) {
      const rowBlock = Math.floor(py / block) * blocks;
      for (let px = 0; px < TILE; px++) {
        const i = py * TILE + px;
        let v = t[i];
        if (Number.isNaN(v)) continue;
        if (useWeather) {
          const cell = cells[rowBlock + Math.floor(px / block)];
          if (!cell) continue; // pas de météo pour ce pixel : transparent, jamais 0,5
          const k = alt ? alt[i] : null;
          let byClass = memo.get(cell);
          if (!byClass) memo.set(cell, (byClass = new Map()));
          let f = byClass.get(k);
          if (f === undefined) {
            f = Field.factor(cell, sid, date, Field.altCenter(cell, k, palette.alt_encoding));
            byClass.set(k, f);
          }
          if (f === null) continue;
          v *= f;
        }
        if (Number.isNaN(out[i]) || v > out[i]) out[i] = v;
      }
    }
  }
  return out;
}

/** M_eff × Φ de l'espèce pour un point et un indice de classe d'altitude (null = inconnu). */
function weatherFactor(sid, lat, lon, k) {
  const cell = Field.nearestCell(weather.index, lat, lon);
  return cell ? Field.factor(cell, sid, currentDate(), Field.altCenter(cell, k, palette.alt_encoding)) : null;
}

/** Le jour de la carte : toujours aujourd'hui (`today` de l'API), null avant la première réponse. */
function currentDate() {
  return weather.today ?? null;
}

/** Classes → pixels colorés sur un canevas (synchrone) ; l'encodage PNG est à part (asynchrone). */
function paint(t) {
  const c = new OffscreenCanvas(TILE, TILE);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(TILE, TILE);
  for (let i = 0; i < t.length; i++) {
    if (Number.isNaN(t[i])) continue;
    const [r, g, b] = classify(t[i]).rgb;
    img.data.set([r, g, b, 255], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

const encodePng = async (canvas) => (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer();

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
  const t0 = performance.now();
  const v = combine(arrays, z, x, y, alt);
  const t1 = performance.now();
  const canvas = v ? paint(v) : null;
  if (DEV) noteRender(t1 - t0, performance.now() - t1);
  return { data: canvas ? await encodePng(canvas) : await transparentTile };
});

// Temps processeur de colorisation (combine : météo et max du groupe par pixel ; peinture :
// classes → pixels, hors encodage PNG asynchrone), affiché en mode dev : « Colorisation : N
// tuiles, X ms » pour vérifier qu'un écran au zoom 6 tient sous la seconde.
const renderStats = { tiles: 0, ms: 0, combineMs: 0 };
let renderStatsTimer = null;
function noteRender(combineMs, paintMs) {
  renderStats.tiles++;
  renderStats.combineMs += combineMs;
  renderStats.ms += combineMs + paintMs;
  clearTimeout(renderStatsTimer);
  renderStatsTimer = setTimeout(() => {
    const line = `Colorisation : ${renderStats.tiles} tuile(s), ${renderStats.ms.toFixed(0)} ms (dont météo ${renderStats.combineMs.toFixed(0)} ms)`;
    const st = $("status");
    st.textContent = /^Colorisation : /m.test(st.textContent)
      ? st.textContent.replace(/^Colorisation : .*$/m, line)
      : `${st.textContent}\n${line}`;
  }, 200);
}

// ---------------------------------------------------------------- carte

const map = new maplibregl.Map({
  container: "map",
  style: { version: 8, sources: {}, layers: [] },
  center: [6.35, 47.1], // Doubs
  zoom: 9,
  minZoom: MIN_ZOOM, // les tuiles T existent dès le niveau 6 : en dessous, rien à colorer
  hash: true,
  attributionControl: { compact: false },
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
// « autour de moi » (étape B3) : la position reste dans le navigateur, rien n'est envoyé à Champis
map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: false }), "top-right");
map.addControl(new maplibregl.ScaleControl(), "bottom-right");

function setBasemap(name) {
  if (map.getLayer("basemap")) map.removeLayer("basemap");
  if (map.getSource("basemap")) map.removeSource("basemap");
  map.addSource("basemap", { type: "raster", tileSize: TILE, ...BASEMAPS[name] });
  const above = map.getLayer("T") ? "T" : undefined;
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, above);
}

/** Couche affichée, dans la ligne repliée du panneau sur téléphone. */
function updateMobileLayer() {
  const layer = $("layer");
  $("mobile-layer").textContent = layer.disabled ? "Carte" : layer.options[layer.selectedIndex]?.text ?? "Carte";
}

const frenchDate = Site.frenchDate;

/** Couche de tuiles à (re)rendre pour la clé, le jour, le mode et la météo courants, visible à
 *  tout zoom ≥ MIN_ZOOM. La source n'est jamais recréée : `setTiles` avec une nouvelle version
 *  fait recharger les tuiles en gardant l'image précédente à l'écran jusqu'à la suivante (plus de
 *  carte vidée carré par carré), et les octets viennent du cache mémoire. */
function setLayer(key) {
  currentKey = key;
  if (!key) return;
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
}

map.on("load", () => {
  setBasemap($("basemap").value);
  loadPalette()
    .then(() => loadFromQuery() || loadFromApi())
    .catch((e) => ($("status").textContent = e.message));
});

$("basemap").addEventListener("change", (e) => setBasemap(e.target.value));
$("layer").addEventListener("change", (e) => {
  setLayer(e.target.value);
  updateMobileLayer();
  noteReadPlan();
  fetchWeather();
});
$("potential").addEventListener("change", () => {
  $("weather-status").hidden = mode() !== "S";
  $("potential-note").hidden = mode() !== "T";
  setLayer(currentKey);
  updateTodayLine();
  fetchWeather();
});
// API : même origine (la page est servie par champis-api), ou `?api=` en dev statique (Site.apiBase).
$("api").value = Site.apiBase(location);
$("api").addEventListener("change", fetchWeather);
let moveTimer = null;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(fetchWeather, 300);
});


// ---------------------------------------------------------------- météo (API)

/** Ligne sous la carte (étape A) : « Aujourd'hui, ven. 6 nov. · météo calculée à 4 h », ou le
 *  rappel du potentiel toute saison, qui ne dépend d'aucun jour. */
function updateTodayLine() {
  $("today-line").textContent =
    mode() === "T" ? "Potentiel toute saison, indépendant de la météo" : Site.todayLine(weather.today, weather.computedAt);
}

/** L'emprise demandée tient-elle dans une réponse complète déjà reçue pour la même couche, de
 *  moins de WEATHER_TTL_MS : la dernière de /weather/bbox (onze jours, à tout zoom), ou, sous
 *  FIELD_ZOOM, le champ du jour courant ? (même règle que `MapModel.weatherAlreadyCovers` dans
 *  l'app). Au-dessus du seuil, un champ ne dispense pas de bbox : il colore en attendant, mais
 *  les onze jours viennent de bbox. */
function weatherCovers(box, useField) {
  const now = Date.now();
  return (
    Field.covers(weather.covered, box, currentKey, now, WEATHER_TTL_MS) ||
    (useField && Field.covers(weather.fieldCovered.get(currentDate()), box, currentKey, now, WEATHER_TTL_MS))
  );
}

/** Météo de l'emprise visible (plus WEATHER_PAD) pour la couche courante : /weather/bbox à
 *  partir de FIELD_ZOOM (onze jours), /weather/field en dessous (le seul jour de la carte, sans
 *  plafond de cellules). Les deux sont fusionnées dans `weather.cells` par field.js, puis la
 *  couche est recolorisée depuis le cache de tuiles (setLayer). */
let weatherAbort = null;
let retryTimer = null;
async function fetchWeather() {
  if (mode() !== "S" || !currentKey) return;
  const ids = layerSpecies(currentKey).map((s) => s.id);
  if (ids.length === 0) return;
  const b = map.getBounds();
  const box = [b.getWest() - WEATHER_PAD, b.getSouth() - WEATHER_PAD, b.getEast() + WEATHER_PAD, b.getNorth() + WEATHER_PAD];
  const useField = Field.weatherSource(map.getZoom()) === "field";
  if (weatherCovers(box, useField)) {
    setLayer(currentKey); // zoom avant, petit déplacement ou jour déjà reçu : les cellules sont déjà là
    return;
  }
  // sous le seuil, le jour de la carte (aujourd'hui) ; avant la première réponse, `today` est
  // inconnu : le jour civil local, et la réponse (`today`, `day`) le corrige
  const guessed = useField && !currentDate();
  const day = useField ? currentDate() ?? Field.localToday() : null;
  weatherAbort?.abort();
  weatherAbort = new AbortController();
  const q = new URLSearchParams({ min_lon: box[0], min_lat: box[1], max_lon: box[2], max_lat: box[3] });
  for (const id of ids) q.append("species", id);
  if (day) q.set("day", day);
  const key = currentKey;
  $("weather-status").textContent = "Météo : chargement…";
  try {
    const r = await fetch(`${$("api").value.replace(/\/$/, "")}/weather/${useField ? "field" : "bbox"}?${q}`, {
      signal: weatherAbort.signal,
    });
    if (!r.ok) throw new Error(`${r.status} ${(await r.json()).detail ?? ""}`);
    const body = await r.json();
    weather.today = body.today;
    weather.computedAt = body.computed_at ?? null;
    weather.error = null;
    const got = useField ? Field.mergeField(weather.cells, body) : Field.mergeBbox(weather.cells, body);
    weather.index = Field.buildIndex(weather.cells);
    if (useField) {
      // servi depuis le précalcul : les cellules manquantes arriveront avec la prochaine
      // pré-chauffe, le TTL suffit à les redemander
      weather.fieldCovered.set(body.day, { box, key, at: Date.now() });
    } else {
      weather.covered = got.missing ? null : { box, key, at: Date.now() };
    }
    const notes = [
      got.stale ? "Météo du dernier passage : le serveur n'a pas pu la rafraîchir." : "",
      got.missing
        ? useField
          ? `Météo manquante sur ${got.missing} cellule(s).`
          : `Météo manquante sur une partie de l'emprise${body.retry_after ? `, nouvel essai dans ${body.retry_after} s` : ""}.`
        : "",
    ].filter(Boolean);
    const devLine = useField
      ? `Météo à grande échelle : ${got.count} cellule(s), ${Site.computedPhrase(body.computed_at, body.today) ?? "heure de calcul inconnue"}`
      : `Météo : ${got.count} cellule(s) dans l'emprise`;
    $("weather-status").textContent = DEV ? [devLine, ...notes].join(" — ") : notes.join(" ");
    if (!useField && got.missing && body.retry_after && body.retry_after <= 120) {
      clearTimeout(retryTimer);
      retryTimer = setTimeout(fetchWeather, body.retry_after * 1000 + 500);
    }
    updateTodayLine();
    if (guessed && body.day !== currentDate()) return fetchWeather(); // le jour deviné n'était pas J : une fois
    setLayer(currentKey);
  } catch (e) {
    if (e.name === "AbortError") return;
    weather.error = e.message;
    $("weather-status").textContent = `Météo indisponible : ${e.message}`;
    setLayer(currentKey); // ce qu'on sait déjà (transparent ailleurs), plutôt que l'image d'un autre jour
  }
}



// ---------------------------------------------------------------- chargement des PMTiles

const speciesMeta = (id) => fetch(`../species/${id}.json`).then((r) => (r.ok ? r.json() : null));

/** Entrée de `species` pour un identifiant, créée depuis son fichier d'espèce si elle n'existe
 *  pas encore (une espèce peut n'être connue que par son G). */
async function ensureSpecies(id, bounds) {
  let s = species.get(id);
  if (!s) {
    const meta = await speciesMeta(id);
    s = { id, pm: null, label: null, names: meta?.names ?? { fr: id, la: "" }, group: meta?.group ?? null, bounds };
    species.set(id, s);
  }
  return s;
}

/** Ordre des canaux d'un G glissé-déposé, dont le manifeste n'a pas donné `species` : les espèces
 *  du groupe triées par identifiant, comme le pipeline, d'après le catalogue de l'API (`GET
 *  /species`, les mêmes fichiers que `species/`) ou, sans API, les T déjà chargés. */
async function dropChannelOrder(group, part) {
  let metas = [...species.values()].map((s) => ({ id: s.id, group: s.group }));
  try {
    const r = await fetch(`${$("api").value.replace(/\/$/, "")}/species`);
    if (r.ok) metas = Object.values((await r.json()).species);
  } catch {
    // pas d'API : on s'en tient aux espèces déjà là
  }
  const ids = Groups.channelOrder(group, metas, part, Groups.channelCount(palette.group_tile_encoding));
  if (ids.length === 0) throw new Error(`espèces du groupe ${group} inconnues (API absente ?) : glisser d'abord ses T`);
  return ids;
}

/** `info` (manifeste) : { kind: "G", group, species, part? } ; sans `info`, tout vient du nom. */
async function addSource(src, label, info = null) {
  if (/(?:^|\/)A-\d+m-/.test(label)) {
    const pm = new pmtiles.PMTiles(src);
    await pm.getHeader(); // échoue tout de suite (CORS, 403…) plutôt qu'au premier rendu
    altLayer = { pm, label };
    ++tileVersion;
    return "A";
  }
  const g = info?.kind === "G" ? { group: info.group, part: info.part ?? 1 } : Groups.parseName(label);
  if (g) {
    const pm = new pmtiles.PMTiles(src);
    const header = await pm.getHeader(); // CORS, 403… : tout de suite, comme pour T et A
    const ids = info?.species ?? (await dropChannelOrder(g.group, g.part));
    const bounds = [header.minLon, header.minLat, header.maxLon, header.maxLat];
    const id = g.part > 1 ? `${g.group}-${g.part}` : g.group;
    groups.set(id, { id, group: g.group, pm, label, species: ids, bounds });
    for (const sid of ids) await ensureSpecies(sid, bounds);
    ++tileVersion;
    return `G:${id}`;
  }
  const id = label.match(/(?:^|\/)T-([a-z_]+)-/)?.[1];
  if (!id) throw new Error(`Nom inattendu (T-<espèce>-…, G-<groupe>-… ou A-…pmtiles) : ${label}`);
  const pm = new pmtiles.PMTiles(src);
  const header = await pm.getHeader();
  const bounds = [header.minLon, header.minLat, header.maxLon, header.maxLat];
  const s = await ensureSpecies(id, bounds);
  s.pm = pm;
  s.label = label; // clé du cache de tuiles : le nom du fichier porte le hash de l'espèce et du jeu
  s.bounds = bounds;
  return id;
}

async function addMany(items) {
  const first = species.size === 0;
  const errors = [];
  let loaded = 0;
  for (const { src, label, info } of items) {
    try {
      await addSource(src, label, info);
      ++loaded;
    } catch (e) {
      errors.push(`${label} : ${e.message}`);
    }
  }
  refreshLayerList();
  if (first && species.size > 0 && !SHARED_VIEW) {
    // La carte s'ouvre sur la vue de départ (le Doubs, à un zoom où la parcelle se lit) si le jeu
    // la couvre, sinon elle cadre le jeu (un seul département, par exemple) : la carte est colorée
    // à tout zoom ≥ MIN_ZOOM (minZoom de la carte), plus besoin de borner le cadrage au zoom 9.
    const b = [...species.values()][0].bounds;
    const c = map.getCenter();
    const covered = c.lng >= b[0] && c.lng <= b[2] && c.lat >= b[1] && c.lat <= b[3];
    if (!covered) map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 20, duration: 0 });
  }
  $("status").textContent = [
    `${species.size} espèce(s) : ${[...species.values()].map((s) => s.names.fr).join(", ")}`,
    groups.size > 0
      ? `Fichiers G : ${[...groups.values()].map((g) => `${g.id} (${nCanaux(g.species.length)})`).join(", ")} — lus à la place des T de leurs espèces`
      : "Sans fichier G : une lecture T par espèce",
    altLayer
      ? "Classes d'altitude : couche A chargée (gel et phénologie par pixel)"
      : "Sans couche A : classe d'altitude = altitude médiane de la cellule météo",
    ...errors,
  ].join("\n");
  if (!DEV && species.size === 0) {
    $("weather-status").textContent = "Aucune carte publiée pour le moment.";
  }
  if (currentKey) setLayer(currentKey); // une couche A ou un G ajouté après coup change la lecture
  noteReadPlan();
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
  updateMobileLayer();
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

/** Ligne du mode dev sous la couche : ce que la couche courante lit (« G cepes (4 canaux) + A »). */
function noteReadPlan() {
  if (!DEV || !currentKey) return;
  const line = `Lecture : ${readPlanText(currentKey)}${altLayer ? " + A" : ""}`;
  const st = $("status");
  st.textContent = /^Lecture : /m.test(st.textContent) ? st.textContent.replace(/^Lecture : .*$/m, line) : `${st.textContent}\n${line}`;
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
  // T (une espèce), G (un groupe, ses espèces dans l'ordre des canaux : `species` du manifeste,
  // jamais deviné) et A du même jeu ; tout kind inconnu est ignoré sans compter comme une erreur.
  // Les T restent chargés même avec les G : repli et espèces hors groupe.
  const tiles = body.tiles.filter((t) => t.depts_hash === dh && ["T", "G", "A"].includes(t.kind));
  const items = tiles
    .filter((t) => t.kind !== "G" || (Array.isArray(t.species) && t.species.length > 0))
    .map((t) => ({
      src: /^https?:/.test(t.url) ? t.url : `${base}${t.url}`,
      label: t.name,
      info: t.kind === "G" ? { kind: "G", group: t.group, species: t.species, part: t.part } : null,
    }));
  const loaded = await addMany(items);
  const hint =
    loaded < items.length && body.mode === "presign"
      ? " — si le navigateur bloque les URL présignées (CORS), passer l'API en CHAMPIS_TILES_MODE=proxy"
      : "";
  const count = (k) => tiles.filter((t) => t.kind === k).length;
  const nDepts = body.depts_by_hash?.[dh]?.length;
  const jeu = nDepts ? `jeu d${dh} (${nDepts} département${nDepts > 1 ? "s" : ""})` : `jeu d${dh}`;
  const kinds = [`${count("T")} T`, `${count("G")} G`, count("A") ? "A" : "sans A"].join(", ");
  $("status").textContent +=
    `\n${loaded}/${items.length} fichier(s) chargés depuis le bucket (${body.mode}), ${jeu} : ${kinds}${hint}`;
  noteReadPlan();
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

/** Fiche en clair (lot 2) : libellé et jour, espèce, phrases, les onze jours du point (étape A,
 *  en lecture seule : la carte reste sur aujourd'hui) avec leur tendance (étape B2), le statut de
 *  la forêt (étape B5), puis les chiffres derrière Détails. */
function renderProbe({ value, name, phrases, details, days = null, forest = null }) {
  const good = classes.find((c) => c.label === "bon")?.min ?? 1;
  const trendText = days ? Site.trendPhrase(Site.trend(days, weather.today, good)) : null;
  const cls = classify(value);
  const when = currentDate() ? Site.whenWord(currentDate(), weather.today) : "";
  const sub = [name, currentDate() ? frenchDate(currentDate()) : ""].filter(Boolean).join(" · ");
  probe.innerHTML =
    `<h2><span class="dot" style="background:${cls.hex}"></span>${esc(cls.fr)} ${mode() === "S" ? esc(when) : "toute saison"}</h2>` +
    `<div class="sub">${esc(sub)}</div>` +
    (phrases.length ? `<ul>${phrases.map((p) => `<li>${esc(p)}</li>`).join("")}</ul>` : "") +
    (days ? `<div id="probe-days" aria-label="Les onze jours de ce point"></div>` : "") +
    (trendText ? `<p class="trend">Tendance : ${esc(trendText)}</p>` : "") +
    (forest ? `<p class="forest">${esc(forest)}</p>` : "") +
    `<details><summary>Détails</summary><div>${esc(details)}</div></details>` +
    `<button type="button" class="button quiet small" id="probe-close">Fermer</button>`;
  $("probe-close").addEventListener("click", () => (probe.style.display = "none"));
  if (days) Site.renderDayDots($("probe-days"), { today: weather.today, days, classes });
}

/** `GET /weather?cell=` pour toutes les espèces du point en une requête : onze jours par espèce et
 *  par classe d'altitude, avec les phrases (`summary`) et les facteurs. null si l'API refuse. */
async function fetchPoint(cellId, sids) {
  const q = new URLSearchParams({ cell: cellId });
  for (const sid of sids) q.append("species", sid);
  const r = await fetch(`${$("api").value.replace(/\/$/, "")}/weather?${q}`);
  return r.ok ? r.json() : null;
}

/** Les onze jours d'un point : pour chaque jour, max sur les espèces de T × M_eff × Φ à la classe
 *  d'altitude du pixel (règle 9) ; null quand aucune espèce n'a de météo ce jour-là. */
function pointDays(body, tBySid, altKey) {
  const dates = new Set();
  for (const sid of Object.keys(tBySid)) for (const row of body.species?.[sid] ?? []) dates.add(row.date);
  return [...dates].sort().map((iso) => {
    let value = null;
    for (const [sid, T] of Object.entries(tBySid)) {
      const cls = body.species?.[sid]?.find((d) => d.date === iso)?.by_alt?.[altKey];
      if (!cls || cls.M_eff === undefined || cls.phi === undefined) continue;
      const v = T * cls.M_eff * cls.phi;
      if (value === null || v > value) value = v;
    }
    return { iso, value };
  });
}

let probeToken = 0; // un clic plus récent rend caduque la réponse d'un clic précédent

/** Statut de la forêt au point (étape B5) : forêt publique de l'ONF ou non, par le WFS de l'IGN ;
 *  null si le service ne répond pas (la fiche n'affiche alors pas de ligne). */
async function fetchForest(lat, lon) {
  try {
    const r = await fetch(Site.forestUrl(lat, lon));
    return r.ok ? Site.forestPhrase(await r.json()) : null;
  } catch {
    return null;
  }
}

map.on("click", async (e) => {
  if (!currentKey) return;
  const token = ++probeToken;
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
  // statut de la forêt en parallèle : la fiche s'affiche sans l'attendre et le gagne à son arrivée
  let shown = null;
  let forest = null;
  const show = (p) => {
    shown = p;
    renderProbe({ ...p, forest });
  };
  fetchForest(e.lngLat.lat, e.lngLat.lng).then((f) => {
    forest = f;
    if (f && shown && token === probeToken) show(shown);
  });
  if (mode() === "T") {
    // sans météo, la classe vient de la couche A seule (pas de cellule pour s'y rabattre)
    const alt = altIdx !== null && altIdx !== nodata ? `altitude ${altIdx * class_m}–${(altIdx + 1) * class_m} m` : "altitude inconnue";
    show({
      value: best.T,
      name,
      phrases: [terrainPhrase(best.T), "potentiel toute saison, sans la météo"],
      details: `T = ${best.T.toFixed(3)} · ${alt}`,
    });
    return;
  }
  // sous FIELD_ZOOM, M_eff × Φ vient du champ du jour ; les phrases et les facteurs, de
  // GET /weather?cell= dans les deux cas
  const cell = Field.nearestCell(weather.index, e.lngLat.lat, e.lngLat.lng);
  const w = best.v / best.T;
  const altKey = String(Field.altCenter(cell, altIdx, palette.alt_encoding));
  const altTxt = altLayer && altIdx !== null && altIdx !== nodata ? "" : " (médiane cellule)";
  show({ value: best.v, name, phrases: [terrainPhrase(best.T), "météo : chargement…"], details: "…" });
  const tBySid = Object.fromEntries(arrays.filter(({ t }) => !Number.isNaN(t[i])).map(({ sid, t }) => [sid, t[i]]));
  const body = await fetchPoint(cell.id, Object.keys(tBySid)).catch(() => null);
  if (token !== probeToken) return;
  const row = body?.species?.[best.sid]?.find((d) => d.date === currentDate())?.by_alt?.[altKey];
  const summary = row?.summary ?? [];
  const factors = row?.factors ?? null;
  const factorsTxt = factors
    ? Object.entries(factors).filter(([k]) => k !== "M").map(([k, v]) => `${k} ${(+v).toFixed(2)}`).join(" · ")
    : "facteurs indisponibles";
  show({
    value: best.v,
    name,
    phrases: [terrainPhrase(best.T), ...summary],
    days: body ? pointDays(body, tBySid, altKey) : null,
    details:
      `S = ${best.v.toFixed(3)} · T ${best.T.toFixed(2)} × M_eff·Φ ${w.toFixed(2)} · cellule ${cell.id}` +
      ` · classe ${altKey} m${altTxt}${cell.stale ? " · météo périmée" : ""}\n${factorsTxt}`,
  });
});

// ---------------------------------------------------------------- recherche de commune (étape B3)

let searchTimer = null;
let searchAbort = null;
const searchResults = $("search-results");
$("search-q").addEventListener("input", (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 3) {
    searchResults.hidden = true;
    return;
  }
  searchTimer = setTimeout(async () => {
    searchAbort?.abort();
    searchAbort = new AbortController();
    try {
      const r = await fetch(Site.geocodeUrl(q), { signal: searchAbort.signal });
      const found = r.ok ? Site.geocodeResults(await r.json()) : [];
      searchResults.innerHTML = found.length
        ? found.map((f, k) => `<li><button type="button" data-k="${k}">${esc(f.label)} <small>${esc(f.context)}</small></button></li>`).join("")
        : `<li class="note">Aucune commune trouvée.</li>`;
      searchResults.hidden = false;
      searchResults.querySelectorAll("button").forEach((b) =>
        b.addEventListener("click", () => {
          const f = found[+b.dataset.k];
          map.flyTo({ center: [f.lon, f.lat], zoom: 12 });
          searchResults.hidden = true;
          $("search-q").value = f.label;
          setPanel(false);
        })
      );
    } catch (err) {
      if (err.name !== "AbortError") {
        searchResults.innerHTML = `<li class="note">La recherche ne répond pas : réessayez dans un instant.</li>`;
        searchResults.hidden = false;
      }
    }
  }, 250);
});
$("search").addEventListener("submit", (e) => {
  e.preventDefault();
  searchResults.querySelector("button")?.click();
});
$("search-open").addEventListener("click", () => {
  setPanel(true);
  $("search-q").focus();
});
