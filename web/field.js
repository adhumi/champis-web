/* Météo de la carte (carte.html), fonctions pures partagées entre le navigateur et node
 * (web/tests/test_field.py) : choix de la source selon le zoom (`/weather/field` sous FIELD_ZOOM,
 * `/weather/bbox` au-dessus — spec › Points ouverts › Carte visible dès l'ouverture, 4 nov. 2026),
 * fusion des deux réponses dans une seule structure de cellules, index spatial par casiers pour la
 * cellule la plus proche, facteur M_eff × Φ d'une cellule et son interpolation bilinéaire entre
 * les centres des cellules voisines (spec › Scoring › Interpolation de la météo entre cellules,
 * 13 nov. 2026 ; portage de champis_api/interp.py, rejoué contre shared/vectors/interp.json).
 * Rien ici ne connaît une espèce ni un
 * seuil : les valeurs viennent de l'API, l'encodage des classes d'altitude de shared/palette.json.
 *
 * Une cellule fusionnée : { id, lat, lon, elevation_m, alt_classes, stale,
 *   f: { <espèce>: { <jour>: [facteur par classe, aligné sur alt_classes ; null si absent] } } }
 * où facteur = M_eff × Φ, que la réponse soit le champ compact (`f`) ou bbox (`M_eff`, `phi`). */
(function (root) {
  "use strict";

  /** Sous ce zoom MapLibre, la météo vient du champ compact (jour courant, toute l'emprise) ;
   *  au-dessus, de /weather/bbox (onze jours, au plus 5 000 cellules). */
  const FIELD_ZOOM = 9;
  /** Au-delà de cette distance de la cellule la plus proche (grille de 5 km : une cellule et
   *  demie), le pixel n'a pas de météo et reste transparent (étude du 4 nov. 2026). */
  const MAX_CELL_KM = 7.5;
  const KM_PER_DEG = 111.2;
  /** Casiers de l'index spatial, en degrés : environ une cellule de la grille. */
  const BIN_DEG = 0.05;
  /** Taille du bloc (px) à l'intérieur duquel les pixels partagent les mêmes poids
   *  d'interpolation : 16 px à partir du zoom 12 (≈ 430 m à 47° N, un douzième de cellule : le
   *  dégradé entre deux centres ne fait pas de marche visible), moitié moins à chaque niveau en
   *  dessous pour garder cette taille au sol, jamais moins de 2 px. */
  const BLOCK_PX = 16;
  const BLOCK_ZOOM = 12;

  const weatherSource = (zoom) => (zoom < FIELD_ZOOM ? "field" : "bbox");

  function blockPx(zoom) {
    const z = Math.floor(zoom);
    if (z >= BLOCK_ZOOM) return BLOCK_PX;
    return Math.max(2, BLOCK_PX >> (BLOCK_ZOOM - z));
  }

  /** Jour civil local (le bandeau ne connaît pas encore `today` au premier chargement). */
  function localToday(now) {
    const d = now ?? new Date();
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  /** L'emprise tient-elle dans une couverture { box, key, at } de la même couche, de moins de
   *  `ttlMs` ? (même règle que `MapModel.weatherAlreadyCovers` dans l'app) */
  function covers(c, box, key, now, ttlMs) {
    if (!c || c.key !== key || now - c.at > ttlMs) return false;
    return box[0] >= c.box[0] && box[1] >= c.box[1] && box[2] <= c.box[2] && box[3] <= c.box[3];
  }

  // ------------------------------------------------------------ fusion des réponses

  function entryFor(cells, c) {
    let e = cells.get(c.id);
    if (!e) {
      e = { id: c.id, lat: c.lat, lon: c.lon, elevation_m: c.elevation_m, alt_classes: c.alt_classes, f: {} };
      cells.set(c.id, e);
    }
    return e;
  }

  /** Facteurs alignés sur `alt_classes` depuis un objet { "150": valeur } ; `pick` extrait le
   *  facteur d'une valeur (null si absent ou non numérique). */
  function aligned(altClasses, byAlt, pick) {
    return altClasses.map((a) => {
      const v = byAlt?.[String(a)];
      const f = v === undefined || v === null ? null : pick(v);
      return typeof f === "number" && Number.isFinite(f) ? f : null;
    });
  }

  /** Fusionne une réponse de /weather/bbox (onze jours par cellule et par espèce) dans `cells`.
   *  Les jours d'une espèce sont remplacés en bloc (la réponse est plus fraîche que le champ). */
  function mergeBbox(cells, body) {
    let stale = 0;
    for (const c of body.cells) {
      const e = entryFor(cells, c.cell);
      e.stale = !!c.stale;
      if (e.stale) stale++;
      for (const [sid, rows] of Object.entries(c.species ?? {})) {
        const days = {};
        for (const row of rows) days[row.date] = aligned(e.alt_classes, row.by_alt, (v) => v.M_eff * v.phi);
        e.f[sid] = days;
      }
    }
    return {
      count: body.cells.length, stale, missing: body.unavailable?.length ?? 0, day: null,
      unavailable: Array.isArray(body.unavailable) ? body.unavailable : [],
    };
  }

  /** Fusionne une réponse de /weather/field (un seul jour `body.day`, facteur M_eff × Φ déjà
   *  multiplié) dans `cells`, sans toucher aux autres jours déjà connus. */
  function mergeField(cells, body) {
    let stale = 0;
    for (const c of body.cells) {
      const e = entryFor(cells, c);
      e.stale = !!c.stale;
      if (e.stale) stale++;
      for (const [sid, byAlt] of Object.entries(c.f ?? {})) {
        (e.f[sid] ??= {})[body.day] = aligned(e.alt_classes, byAlt, (v) => v);
      }
    }
    return { count: body.cells.length, stale, missing: body.unavailable ?? 0, day: body.day };
  }

  // ------------------------------------------------------------ index spatial

  const binOf = (deg) => Math.floor(deg / BIN_DEG);
  // clé entière d'un casier : lat ∈ [−90, 90] → 3 600 casiers, lon ∈ [−180, 180] → 7 200
  const binKey = (iy, ix) => (iy + 2000) * 8192 + (ix + 4000);

  /** Casiers de BIN_DEG° → cellules, et grille (i, j) → cellule pour l'interpolation ; à
   *  reconstruire quand `cells` change. `unavailable` : identifiants des cellules que l'API a
   *  listées sans météo (leurs pixels restent transparents, jamais la météo d'une voisine). */
  function buildIndex(cells, unavailable) {
    const bins = new Map();
    const grid = new Map();
    let size = 0;
    for (const c of cells.values ? cells.values() : cells) {
      const k = binKey(binOf(c.lat), binOf(c.lon));
      const b = bins.get(k);
      if (b) b.push(c);
      else bins.set(k, [c]);
      const ij = parseCellId(c.id);
      if (ij) grid.set(gridKey(ij[0], ij[1]), c);
      size++;
    }
    const closed = new Set();
    for (const id of unavailable ?? []) {
      const ij = parseCellId(id);
      if (ij && !grid.has(gridKey(ij[0], ij[1]))) closed.add(gridKey(ij[0], ij[1]));
    }
    return { bins, grid, closed, size };
  }

  /** Cellule la plus proche à moins de MAX_CELL_KM (distance équirectangulaire), sinon null :
   *  seuls les casiers que le rayon peut toucher sont parcourus. */
  function nearestCell(index, lat, lon) {
    if (!index) return null;
    const rLat = MAX_CELL_KM / KM_PER_DEG;
    const k = Math.cos((lat * Math.PI) / 180);
    const rLon = rLat / Math.max(k, 1e-6);
    let best = null;
    let bestD = rLat * rLat;
    const y0 = binOf(lat - rLat);
    const y1 = binOf(lat + rLat);
    const x0 = binOf(lon - rLon);
    const x1 = binOf(lon + rLon);
    for (let iy = y0; iy <= y1; iy++) {
      for (let ix = x0; ix <= x1; ix++) {
        const b = index.bins.get(binKey(iy, ix));
        if (!b) continue;
        for (const c of b) {
          const dy = c.lat - lat;
          const dx = (c.lon - lon) * k;
          const d = dy * dy + dx * dx;
          if (d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
    }
    return best;
  }

  // ------------------------------------------------------------ interpolation entre cellules

  const CELL_M = 5000;
  // Lambert-93 (RGF93, conique conforme sécante 44° / 49°, origine 46,5° N 3° E) : constantes IGN,
  // les mêmes que champis_api/interp.py.
  const L93_E = 0.0818191910428158; // première excentricité GRS80
  const L93_N = 0.725607765053267;
  const L93_C = 11754255.426096;
  const L93_XS = 700000;
  const L93_YS = 12655612.049876;
  const L93_LON0 = (3 * Math.PI) / 180;

  /** [x, y] Lambert-93 en mètres d'un point WGS84 en degrés (formule directe, sans bibliothèque). */
  function lambert93(lat, lon) {
    const s = Math.sin((lat * Math.PI) / 180);
    const iso = Math.atanh(s) - L93_E * Math.atanh(L93_E * s); // latitude isométrique
    const r = L93_C * Math.exp(-L93_N * iso);
    const gamma = L93_N * ((lon * Math.PI) / 180 - L93_LON0);
    return [L93_XS + r * Math.sin(gamma), L93_YS - r * Math.cos(gamma)];
  }

  const pad4 = (n) => String(n).padStart(4, "0");
  /** Identifiant de la cellule d'indices (i, j) : coin sud-ouest en km (`c_0930_6680`). */
  const cellId = (i, j) => `c_${pad4(i * 5)}_${pad4(j * 5)}`;
  const gridKey = (i, j) => i * 65536 + j;

  /** `c_0930_6680` → [186, 1336] ; null si l'identifiant n'a pas cette forme. */
  function parseCellId(id) {
    const m = /^c_(\d+)_(\d+)$/.exec(id ?? "");
    return m ? [Math.round(+m[1] / 5), Math.round(+m[2] / 5)] : null;
  }

  /** Les quatre cellules dont les centres encadrent le point, en indices de grille : coin
   *  sud-ouest (i0, j0), fractions (fx, fy) vers l'est et le nord, et cellule (ci, cj) qui
   *  contient le point. */
  function cornersIJ(lat, lon) {
    const [x, y] = lambert93(lat, lon);
    const u = x / CELL_M - 0.5; // en unités de cellule, 0 au centre de la cellule d'indice 0
    const v = y / CELL_M - 0.5;
    const i0 = Math.floor(u);
    const j0 = Math.floor(v);
    return { i0, j0, fx: u - i0, fy: v - j0, ci: Math.floor(x / CELL_M), cj: Math.floor(y / CELL_M) };
  }

  /** Forme du vecteur de parité : cellule contenante, identifiants SO, SE, NO, NE et poids
   *  bilinéaires (somme 1). */
  function corners(lat, lon) {
    const { i0, j0, fx, fy, ci, cj } = cornersIJ(lat, lon);
    return {
      containing: cellId(ci, cj),
      ids: [cellId(i0, j0), cellId(i0 + 1, j0), cellId(i0, j0 + 1), cellId(i0 + 1, j0 + 1)],
      weights: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
    };
  }

  /** Moyenne des coins qui ont une valeur, pondérée par leurs poids renormalisés ; null si la
   *  cellule qui contient le point n'en a pas. `values` : identifiant → nombre (absent ou null =
   *  sans météo). */
  function interpolate(c, values) {
    const home = values[c.containing];
    if (home === undefined || home === null) return null;
    let num = 0;
    let den = 0;
    for (let n = 0; n < 4; n++) {
      const v = values[c.ids[n]];
      if (v === undefined || v === null) continue;
      num += c.weights[n] * v;
      den += c.weights[n];
    }
    return num / den;
  }

  /** Ce qu'il faut pour interpoler en un point avec les cellules chargées : les quatre coins
   *  (null quand la cellule n'est pas chargée), leurs poids, et la cellule `home` qui porte le
   *  point. Hors grille (cellule contenante ni chargée ni listée sans météo), repli sur la
   *  cellule la plus proche à moins de MAX_CELL_KM, sans interpolation (`cells` null). Sans
   *  météo : null. */
  function sample(index, lat, lon) {
    if (!index) return null;
    const { i0, j0, fx, fy, ci, cj } = cornersIJ(lat, lon);
    const home = index.grid.get(gridKey(ci, cj));
    if (!home) {
      if (index.closed.has(gridKey(ci, cj))) return null;
      const near = nearestCell(index, lat, lon);
      return near ? { home: near, cells: null, weights: null } : null;
    }
    return {
      home,
      cells: [
        index.grid.get(gridKey(i0, j0)) ?? null,
        index.grid.get(gridKey(i0 + 1, j0)) ?? null,
        index.grid.get(gridKey(i0, j0 + 1)) ?? null,
        index.grid.get(gridKey(i0 + 1, j0 + 1)) ?? null,
      ],
      weights: [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy],
    };
  }

  /** M_eff × Φ interpolé d'un échantillon (`sample`) ; `get(cellule)` donne le facteur d'une
   *  cellule ou null. null si la cellule qui porte le point n'a pas de facteur. */
  function sampleFactor(s, get) {
    const base = get(s.home);
    if (base === null || s.cells === null) return base;
    let num = 0;
    let den = 0;
    for (let n = 0; n < 4; n++) {
      const c = s.cells[n];
      if (c === null) continue;
      const v = c === s.home ? base : get(c);
      if (v === null) continue;
      num += s.weights[n] * v;
      den += s.weights[n];
    }
    return num / den;
  }

  /** M_eff × Φ interpolé en un point pour une espèce, un jour et l'indice d'altitude du pixel :
   *  chaque cellule donne sa valeur à cette altitude (`cellFactor`). null sans météo. */
  function pointFactor(index, sid, date, lat, lon, k, altEncoding) {
    const s = sample(index, lat, lon);
    return s ? sampleFactor(s, (c) => cellFactor(c, sid, date, k, altEncoding)) : null;
  }

  // ------------------------------------------------------------ tuiles et facteur

  function tilePixelToLngLat(z, x, y, px, py, tile) {
    const n = 2 ** z;
    const lon = ((x + px / tile) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / tile)) / n))) * 180) / Math.PI;
    return [lon, lat];
  }

  /** Échantillon d'interpolation (`sample`) de chaque bloc de `block` px d'une tuile (ligne par
   *  ligne), pris au centre du bloc ; null sans météo : un calcul par bloc, partagé par toutes
   *  les espèces. */
  function tileSamples(index, z, x, y, tile, block) {
    const blocks = tile / block;
    const out = new Array(blocks * blocks);
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        const [lon, lat] = tilePixelToLngLat(z, x, y, (bx + 0.5) * block, (by + 0.5) * block, tile);
        out[by * blocks + bx] = sample(index, lat, lon);
      }
    }
    return out;
  }

  /** L'encodage est-il celui de la couche E (altitude fine, `step_m`) plutôt que celui de la
   *  couche A (classes, `class_m`) ? */
  const isFine = (altEncoding) => altEncoding.step_m !== undefined;
  const unknownIndex = (k, altEncoding) => k === null || k === undefined || k === altEncoding.nodata;

  /** Altitude (m) au milieu de la tranche d'indice `index` de la couche E. */
  const elevation = (index, stepM) => (index + 0.5) * stepM;

  /** Centre (m) de la classe d'altitude à utiliser parmi celles que l'API a calculées pour la
   *  cellule : celle du pixel (indice k de la couche A, ou classe la plus proche de son altitude
   *  lue dans la couche E) ; sans couche ou altitude inconnue, celle de l'altitude médiane de la
   *  forêt de la cellule (`elevation_m`). */
  function altCenter(cell, k, altEncoding) {
    let target;
    if (unknownIndex(k, altEncoding)) {
      target = cell.elevation_m;
    } else if (isFine(altEncoding)) {
      target = elevation(k, altEncoding.step_m);
    } else {
      target = (k + 0.5) * altEncoding.class_m;
    }
    return cell.alt_classes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  }

  /** Valeur à l'altitude `altM` d'une cellule dont `values[i]` est M_eff × Φ au centre
   *  `centers[i]` (croissants) : linéaire entre les deux centres qui encadrent l'altitude, à plat
   *  en dessous du premier et au-dessus du dernier ; une classe sans valeur (null) est ignorée,
   *  null si aucune n'en a. Portage de `interp.between_classes` (champis-api), rejoué contre
   *  shared/vectors/alt.json (spec › Scoring › Interpolation entre classes d'altitude). */
  function betweenClasses(altM, centers, values) {
    let c0 = null;
    let v0 = null;
    for (let i = 0; i < centers.length; i++) {
      const v = values?.[i];
      if (v === null || v === undefined) continue;
      const c = centers[i];
      if (altM <= c) return c0 === null ? v : v0 + ((altM - c0) / (c - c0)) * (v - v0);
      c0 = c;
      v0 = v;
    }
    return v0;
  }

  /** M_eff × Φ de la cellule pour l'espèce, le jour et le centre de classe ; null si inconnu
   *  (jour non chargé, espèce absente, classe que l'API n'a pas calculée). */
  function factor(cell, sid, date, altCenterM) {
    const i = cell.alt_classes.indexOf(altCenterM);
    if (i < 0) return null;
    return cell.f[sid]?.[date]?.[i] ?? null;
  }

  /** M_eff × Φ de la cellule pour l'espèce, le jour et l'indice `k` lu dans la couche
   *  d'altitude : avec la couche E, interpolé entre les deux classes de la cellule qui encadrent
   *  l'altitude du pixel ; avec la couche A (ou sans altitude), celui de sa classe. */
  function cellFactor(cell, sid, date, k, altEncoding) {
    if (isFine(altEncoding) && !unknownIndex(k, altEncoding)) {
      return betweenClasses(elevation(k, altEncoding.step_m), cell.alt_classes, cell.f[sid]?.[date]);
    }
    return factor(cell, sid, date, altCenter(cell, k, altEncoding));
  }

  const Field = {
    FIELD_ZOOM, MAX_CELL_KM, KM_PER_DEG, BIN_DEG, BLOCK_PX,
    weatherSource, blockPx, localToday, covers,
    mergeBbox, mergeField, buildIndex, nearestCell,
    lambert93, corners, interpolate, sample, sampleFactor, pointFactor,
    tilePixelToLngLat, tileSamples, altCenter, factor, cellFactor, betweenClasses, elevation,
  };
  root.Field = Field;
  if (typeof module !== "undefined" && module.exports) module.exports = Field;
})(typeof globalThis !== "undefined" ? globalThis : this);
