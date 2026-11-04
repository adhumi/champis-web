/* Météo de la carte (carte.html), fonctions pures partagées entre le navigateur et node
 * (web/tests/test_field.py) : choix de la source selon le zoom (`/weather/field` sous FIELD_ZOOM,
 * `/weather/bbox` au-dessus — spec › Points ouverts › Carte visible dès l'ouverture, 4 nov. 2026),
 * fusion des deux réponses dans une seule structure de cellules, index spatial par casiers pour la
 * cellule la plus proche, et facteur M_eff × Φ d'un pixel. Rien ici ne connaît une espèce ni un
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
  /** Taille du bloc (px) à l'intérieur duquel les pixels partagent une cellule météo : 16 px à
   *  partir du zoom 9 (≈ 5 km, la cellule), moitié moins à chaque niveau en dessous pour garder
   *  un bloc de l'ordre de la cellule, jamais moins de 2 px (z6 : 2 px ≈ 3,5 km à 47° N). */
  const BLOCK_PX = 16;

  const weatherSource = (zoom) => (zoom < FIELD_ZOOM ? "field" : "bbox");

  function blockPx(zoom) {
    const z = Math.floor(zoom);
    if (z >= FIELD_ZOOM) return BLOCK_PX;
    return Math.max(2, BLOCK_PX >> (FIELD_ZOOM - z));
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
    return { count: body.cells.length, stale, missing: body.unavailable?.length ?? 0, day: null };
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

  /** Casiers de BIN_DEG° → cellules ; à reconstruire quand `cells` change. */
  function buildIndex(cells) {
    const bins = new Map();
    let size = 0;
    for (const c of cells.values ? cells.values() : cells) {
      const k = binKey(binOf(c.lat), binOf(c.lon));
      const b = bins.get(k);
      if (b) b.push(c);
      else bins.set(k, [c]);
      size++;
    }
    return { bins, size };
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

  // ------------------------------------------------------------ tuiles et facteur

  function tilePixelToLngLat(z, x, y, px, py, tile) {
    const n = 2 ** z;
    const lon = ((x + px / tile) / n) * 360 - 180;
    const lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + py / tile)) / n))) * 180) / Math.PI;
    return [lon, lat];
  }

  /** Cellule météo de chaque bloc de `block` px d'une tuile (ligne par ligne), null sans cellule
   *  à moins de MAX_CELL_KM : une recherche par bloc, partagée par toutes les espèces. */
  function tileCells(index, z, x, y, tile, block) {
    const blocks = tile / block;
    const out = new Array(blocks * blocks);
    for (let by = 0; by < blocks; by++) {
      for (let bx = 0; bx < blocks; bx++) {
        const [lon, lat] = tilePixelToLngLat(z, x, y, (bx + 0.5) * block, (by + 0.5) * block, tile);
        out[by * blocks + bx] = nearestCell(index, lat, lon);
      }
    }
    return out;
  }

  /** Centre (m) de la classe d'altitude à utiliser parmi celles que l'API a calculées pour la
   *  cellule : celle du pixel (indice k de la couche A) ; sans couche A ou altitude inconnue,
   *  celle de l'altitude médiane de la forêt de la cellule (`elevation_m`). */
  function altCenter(cell, k, altEncoding) {
    const { class_m, nodata } = altEncoding;
    const alt = k === null || k === undefined || k === nodata ? cell.elevation_m : (k + 0.5) * class_m;
    const target = Math.floor(alt / class_m) * class_m + class_m / 2;
    return cell.alt_classes.reduce((a, b) => (Math.abs(b - target) < Math.abs(a - target) ? b : a));
  }

  /** M_eff × Φ de la cellule pour l'espèce, le jour et le centre de classe ; null si inconnu
   *  (jour non chargé, espèce absente, classe que l'API n'a pas calculée). */
  function factor(cell, sid, date, altCenterM) {
    const i = cell.alt_classes.indexOf(altCenterM);
    if (i < 0) return null;
    return cell.f[sid]?.[date]?.[i] ?? null;
  }

  const Field = {
    FIELD_ZOOM, MAX_CELL_KM, KM_PER_DEG, BIN_DEG, BLOCK_PX,
    weatherSource, blockPx, localToday, covers,
    mergeBbox, mergeField, buildIndex, nearestCell,
    tilePixelToLngLat, tileCells, altCenter, factor,
  };
  root.Field = Field;
  if (typeof module !== "undefined" && module.exports) module.exports = Field;
})(typeof globalThis !== "undefined" ? globalThis : this);
