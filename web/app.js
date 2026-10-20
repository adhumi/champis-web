/* Carte jetable des phases 1–2 : potentiel terrain T (PMTiles gris 8 bits) colorisé côté client
 * avec shared/palette.json, et score du jour S = T × M_eff × Φ avec les valeurs de l'API
 * (/weather/bbox : M_eff et Φ par cellule 5 km, jour et classe d'altitude). Aucune valeur de
 * modèle ici : palette, seuils, encodage des tuiles et noms d'espèces sont lus depuis le dépôt,
 * M et Φ depuis l'API (servir la racine du dépôt, voir README). */

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
const species = new Map(); // id → { pm, names, group }
let altLayer = null; // PMTiles A (classes d'altitude) : { pm, label }, commun à toutes les espèces
let currentKey = null; // "s:<id>" ou "g:<group>"
let tileVersion = 0; // incrémenté pour forcer le rendu quand la météo ou le jour change
const transparentTile = makeTransparentTile();

// Météo : réponse de /weather/bbox pour l'emprise courante.
// cells : id → { lat, lon, elevation_m, alt_classes, stale, species: { sid: { date: { alt: {M_eff, phi} } } } }
const weather = { today: null, cells: new Map(), error: null };
const mode = () => $("mode").value; // "T" ou "S"
const dayOffset = () => +$("day").value;
const WEATHER_BLOCK = 16; // la cellule météo est cherchée par bloc de 16 px, pas par pixel

// ---------------------------------------------------------------- palette

async function loadPalette() {
  const r = await fetch("../shared/palette.json");
  if (!r.ok) throw new Error("palette.json introuvable : servir la racine du dépôt");
  palette = await r.json();
  classes = [...palette.thresholds]
    .sort((a, b) => b.min - a.min)
    .map((t) => ({ ...t, rgb: hexToRgb(t.hex) }));
  const legend = $("legend");
  legend.innerHTML = "";
  for (const c of [...classes].reverse()) {
    legend.insertAdjacentHTML(
      "beforeend",
      `<i style="background:${c.hex}"></i><span>${c.fr} (≥ ${c.min.toFixed(2)})</span>`
    );
  }
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

async function pngPixels(buf) {
  const bmp = await createImageBitmap(new Blob([buf], { type: "image/png" }));
  const c = new OffscreenCanvas(TILE, TILE);
  const ctx = c.getContext("2d");
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, TILE, TILE).data;
}

/** PNG gris+alpha → Float32Array de T (NaN = nodata). */
async function decodeT(buf) {
  const px = await pngPixels(buf);
  const { scale, nodata } = palette.tile_encoding;
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) {
    const v = px[i * 4];
    out[i] = px[i * 4 + 3] === 0 || v === nodata ? NaN : v / scale;
  }
  return out;
}

/** PNG de la couche A → indice de classe par pixel (nodata de la palette si inconnu). */
async function decodeAlt(buf) {
  const px = await pngPixels(buf);
  const { nodata } = palette.alt_encoding;
  const out = new Uint8Array(TILE * TILE);
  for (let i = 0; i < out.length; i++) out[i] = px[i * 4 + 3] === 0 ? nodata : px[i * 4];
  return out;
}

/** Indices de classe d'altitude de la tuile, ou null sans couche A (ou hors de son emprise). */
async function altTile(z, x, y) {
  if (!altLayer) return null;
  const t = await altLayer.pm.getZxy(z, x, y);
  return t?.data ? decodeAlt(t.data) : null;
}

function layerSpecies(key) {
  const [kind, name] = key.split(":");
  if (kind === "s") return [species.get(name)].filter(Boolean);
  return [...species.values()].filter((s) => s.group?.id === name);
}

/** T de chaque espèce de la couche sur une tuile : [{ sid, t: Float32Array }]. */
async function speciesT(key, z, x, y) {
  const out = [];
  for (const s of layerSpecies(key)) {
    const t = await s.pm.getZxy(z, x, y);
    if (t?.data) out.push({ sid: s.id, t: await decodeT(t.data) });
  }
  return out;
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

function nearestCell(lat, lon) {
  let best = null;
  let bestD = Infinity;
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

maplibregl.addProtocol("champis", async (params) => {
  const m = params.url.match(/^champis:\/\/([^/]+)\/v\d+\/(\d+)\/(\d+)\/(\d+)$/);
  if (!m) throw new Error(`URL invalide : ${params.url}`);
  const [z, x, y] = [+m[2], +m[3], +m[4]];
  const arrays = await speciesT(m[1], z, x, y);
  const alt = arrays.length && mode() === "S" ? await altTile(z, x, y) : null;
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
  map.addLayer({ id: "basemap", type: "raster", source: "basemap" }, map.getLayer("T") ? "T" : undefined);
}

function setLayer(key) {
  currentKey = key;
  if (map.getLayer("T")) map.removeLayer("T");
  if (map.getSource("T")) map.removeSource("T");
  if (!key) return;
  map.addSource("T", {
    type: "raster",
    tiles: [`champis://${key}/v${++tileVersion}/{z}/{x}/{y}`],
    tileSize: TILE,
    minzoom: MIN_ZOOM,
    maxzoom: MAX_ZOOM,
  });
  map.addLayer({
    id: "T",
    type: "raster",
    source: "T",
    paint: { "raster-opacity": +$("opacity").value, "raster-resampling": "nearest" },
  });
}

map.on("load", () => {
  setBasemap($("basemap").value);
  loadPalette()
    .then(() => loadFromQuery() || loadFromApi())
    .catch((e) => ($("status").textContent = e.message));
});

$("basemap").addEventListener("change", (e) => setBasemap(e.target.value));
$("opacity").addEventListener("input", (e) => {
  if (map.getLayer("T")) map.setPaintProperty("T", "raster-opacity", +e.target.value);
});
$("layer").addEventListener("change", (e) => {
  setLayer(e.target.value);
  fetchWeather();
});
$("mode").addEventListener("change", () => {
  $("weather").hidden = mode() !== "S";
  setLayer(currentKey);
  fetchWeather();
});
$("day").addEventListener("input", () => {
  updateDayLabel();
  setLayer(currentKey);
});
// API : même origine quand la page est servie par champis-api (Railway, uvicorn) ; en dev avec
// `python -m http.server` sur un autre port, l'API locale par défaut.
$("api").value =
  /^(localhost|127\.0\.0\.1)$/.test(location.hostname) && location.port !== "8000"
    ? "http://127.0.0.1:8000"
    : location.origin;
$("api").addEventListener("change", fetchWeather);
let moveTimer = null;
map.on("moveend", () => {
  clearTimeout(moveTimer);
  moveTimer = setTimeout(fetchWeather, 300);
});

// ---------------------------------------------------------------- météo (API)

function updateDayLabel() {
  const d = currentDate();
  const k = dayOffset();
  $("day-label").textContent = d ? `${d} (J${k >= 0 ? "+" : ""}${k})` : "";
}

let weatherAbort = null;
let retryTimer = null;
async function fetchWeather() {
  if (mode() !== "S" || !currentKey) return;
  const ids = layerSpecies(currentKey).map((s) => s.id);
  if (ids.length === 0) return;
  weatherAbort?.abort();
  weatherAbort = new AbortController();
  const b = map.getBounds();
  const pad = 0.1; // ~ une cellule de marge pour le voisin le plus proche en bord d'écran
  const q = new URLSearchParams({
    min_lon: b.getWest() - pad,
    min_lat: b.getSouth() - pad,
    max_lon: b.getEast() + pad,
    max_lat: b.getNorth() + pad,
  });
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
    $("weather-status").textContent =
      `Météo : ${body.cells.length} cellule(s) dans l'emprise` +
      (stale ? " — cache périmé (Open-Meteo injoignable)" : "") +
      (missing
        ? ` — ${missing} sans météo (quota Open-Meteo${body.retry_after ? `, réessai dans ${body.retry_after} s` : ""})`
        : "");
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
    sel.add(new Option(`${fr} — max du groupe`, `g:${gid}`));
  }
  for (const [id, s] of [...species].sort((a, b) => a[1].names.fr.localeCompare(b[1].names.fr))) {
    sel.add(new Option(`${s.names.fr} (${s.names.la})`, `s:${id}`));
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
  const items = body.tiles.map((t) => ({
    src: /^https?:/.test(t.url) ? t.url : `${base}${t.url}`,
    label: t.name,
  }));
  const loaded = await addMany(items);
  const hint =
    loaded < items.length && body.mode === "presign"
      ? " — si le navigateur bloque les URL présignées (CORS), passer l'API en CHAMPIS_TILES_MODE=proxy"
      : "";
  $("status").textContent += `\n${loaded}/${items.length} fichier(s) chargés depuis le bucket (${body.mode})${hint}`;
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
map.on("click", async (e) => {
  if (!currentKey) return;
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
      ? "Pas de météo pour ce point"
      : "Hors forêt / pas de donnée";
    return;
  }
  const name = species.get(best.sid)?.names.fr ?? best.sid;
  if (mode() === "T") {
    // sans météo, la classe vient de la couche A seule (pas de cellule pour s'y rabattre)
    const { class_m, nodata } = palette.alt_encoding;
    const alt = altIdx !== null && altIdx !== nodata ? ` · altitude ${altIdx * class_m}–${(altIdx + 1) * class_m} m` : "";
    probe.textContent = `T = ${best.T.toFixed(3)} — ${classify(best.T).fr} (${name})${alt}`;
    return;
  }
  const cell = nearestCell(e.lngLat.lat, e.lngLat.lng);
  const w = best.v / best.T;
  const altTxt = altLayer && altIdx !== null && altIdx !== palette.alt_encoding.nodata ? "" : " (médiane cellule)";
  probe.textContent =
    `S = ${best.v.toFixed(3)} — ${classify(best.v).fr} (${name}, ${currentDate()}) · ` +
    `T ${best.T.toFixed(2)} × M_eff·Φ ${w.toFixed(2)} · cellule ${cell.id} · ` +
    `classe ${altCenter(cell, altIdx)} m${altTxt}` +
    (cell.stale ? " · météo périmée" : "");
});
