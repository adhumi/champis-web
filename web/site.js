/* Code partagé du site (refonte UX, lot 5 ; étape A du 6 nov. 2026) : palette et classes, dates
 * en français, heure de calcul de la météo, phrase de saison, rendu du Markdown de shared/texts/,
 * pastilles des onze jours de la fiche, légende, navigation. Les fonctions pures sont exportées pour node (web/tests/test_site.py) ; rien ici
 * ne connaît une espèce : noms, groupes, seuils et couleurs viennent de l'API et de la palette. */
(function (root) {
  "use strict";

  const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const SHORT_WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const DAY_RANGE = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
  /* Lien de don (RevenueCat Web Billing), à renseigner par Adrien ; null = la page explique en attendant. */
  const SUPPORT_URL = null;
  /* Partie « Soutenir » montrée ou non (masquée le 9 nov. 2026 jusqu'à ce qu'Adrien la réactive) :
   * en-tête, barre d'onglets, pied de page et liens marqués `data-support` dans les pages. La page
   * soutenir.html reste servie, sans lien qui y mène. Remettre `true` suffit à tout réafficher. */
  const SUPPORT_VISIBLE = false;
  /* Ligne qui renvoie vers l'app, sous la carte et les fiches : null tant que l'app n'est pas publiée
   * (étape A, 6 nov. 2026 : pas de promesse sans lien), le texte à remettre à la publication. */
  const APP_LINE = null;
  /** Adresse de contact de l'éditeur (mentions légales, confidentialité, pied de page). */
  const CONTACT_EMAIL = "hello@champis.app";

  // ------------------------------------------------------------ sélecteur d'espèce de la carte
  /** Entrées du sélecteur d'espèce (9 nov. 2026) depuis les espèces chargées ({ id, names: { fr,
   *  la }, group: { id, fr } | null }) : les groupes d'abord, dans l'ordre où ils apparaissent, puis
   *  les espèces par nom français. Chaque entrée : `value` (« g:<groupe> » ou « s:<id> »), `fr`,
   *  `la` (nom latin ; pour un groupe, ses genres), `spp` (vrai pour un groupe : « Boletus spp. »)
   *  et `illustration`, l'identifiant de l'espèce dont la planche sert de miniature (pour un groupe,
   *  l'espèce au nom français le plus court, à égalité le premier dans l'ordre alphabétique). */
  function layerItems(list) {
    const byGroup = new Map();
    for (const s of list) {
      if (!s.group) continue;
      if (!byGroup.has(s.group.id)) byGroup.set(s.group.id, { fr: s.group.fr, members: [] });
      byGroup.get(s.group.id).members.push(s);
    }
    const items = [];
    for (const [gid, g] of byGroup) {
      const genera = [...new Set(g.members.map((s) => (s.names.la || "").split(" ")[0]).filter(Boolean))].sort();
      const lead = [...g.members].sort((a, b) => a.names.fr.length - b.names.fr.length || a.names.fr.localeCompare(b.names.fr, "fr"))[0];
      items.push({ value: `g:${gid}`, fr: g.fr, la: genera.join(", "), spp: true, illustration: lead.id });
    }
    for (const s of [...list].sort((a, b) => a.names.fr.localeCompare(b.names.fr, "fr"))) {
      items.push({ value: `s:${s.id}`, fr: s.names.fr, la: s.names.la || "", spp: false, illustration: s.id });
    }
    return items;
  }

  // ------------------------------------------------------------ fiche d'un point (17 nov. 2026)
  /** La phrase de la fiche (spec › App iOS › Fiche d'un point, toutes les espèces et une phrase) :
   *  le terrain du pixel (`terrain`, « terrain très favorable », que l'API ne connaît pas), deux-
   *  points, puis `sentence` de `GET /weather` et un point. Sans `sentence` (API plus ancienne), le
   *  terrain seul et la liste `summary` à la suite (`phrases`). Même règle que `PointSheet.sentence`
   *  de l'app. */
  function pointSentence(terrain, sentence, summary, link = " : ") {
    const lead = terrain.charAt(0).toUpperCase() + terrain.slice(1);
    if (typeof sentence === "string" && sentence) return { sentence: `${lead}${link}${sentence}.`, phrases: [] };
    return { sentence: `${lead}.`, phrases: Array.isArray(summary) ? summary : [] };
  }

  /** Ce qui relie le terrain à la phrase (spec › App iOS › Liaison entre le terrain et la phrase,
   *  18 nov. 2026) : « et » quand la suite va dans le même sens que le terrain, « mais » quand elle
   *  s'y oppose, une virgule quand l'un des deux est neutre ; les deux-points d'avant sans
   *  `sentence_tone` (réponse plus ancienne). `label` : libellé de palette de T (excellent et bon :
   *  favorable ; moyen : neutre ; sinon défavorable) ; `tone` : `sentence_tone` de `GET /weather`.
   *  Même règle que `PointSheet.link` de l'app. */
  function pointLink(label, tone) {
    const weather = { favorable: 1, defavorable: -1, neutre: 0 }[tone];
    if (weather === undefined) return " : ";
    const terrain = label === "excellent" || label === "bon" ? 1 : label === "moyen" || label == null ? 0 : -1;
    if (weather === 0 || terrain === 0) return ", ";
    return weather === terrain ? " et " : " mais ";
  }

  /** Les autres espèces d'un point, par famille (groupe d'affichage du référentiel). `items` :
   *  [{ id, fr, la, group: { id, fr } | null, value }] pour les espèces qui ont du terrain au
   *  point, `value` = score du jour ou null sans météo. `featured` : l'espèce en tête de fiche,
   *  absente de la liste. La famille de l'espèce mise en avant d'abord, puis les autres par meilleur
   *  score décroissant ; dans une famille, par score décroissant, puis par nom ; sans score en
   *  dernier. Même règle que `PointFamilies.families` de l'app. */
  function pointFamilies(items, featured) {
    const score = (v) => (typeof v === "number" ? v : -1);
    const lead = items.find((it) => it.id === featured);
    const leadGroup = lead ? (lead.group?.id ?? "") : null;
    const byGroup = new Map();
    for (const it of items) {
      if (it.id === featured) continue;
      const gid = it.group?.id ?? "";
      if (!byGroup.has(gid)) byGroup.set(gid, { id: gid, title: it.group?.fr ?? "Autres espèces", species: [] });
      byGroup.get(gid).species.push(it);
    }
    const families = [...byGroup.values()];
    for (const f of families) {
      f.species.sort((a, b) => score(b.value) - score(a.value) || a.fr.localeCompare(b.fr, "fr"));
      f.best = Math.max(...f.species.map((it) => score(it.value)));
    }
    families.sort(
      (a, b) => (b.id === leadGroup) - (a.id === leadGroup) || b.best - a.best || a.title.localeCompare(b.title, "fr")
    );
    return families.map(({ id, title, species }) => ({ id, title, species }));
  }

  // ------------------------------------------------------------ dates (UTC midi : jamais de décalage)
  const parse = (iso) => new Date(iso + "T12:00:00Z");
  const weekdayName = (iso) => WEEKDAYS[parse(iso).getUTCDay()];
  const shortWeekday = (iso) => SHORT_WEEKDAYS[parse(iso).getUTCDay()];
  /** `2026-11-01` → `dim. 1 nov.` */
  function frenchDate(iso) {
    const d = parse(iso);
    return `${SHORT_WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  }
  /** Jour ISO à J+k. */
  function dateFor(today, k) {
    if (!today) return null;
    const d = parse(today);
    d.setUTCDate(d.getUTCDate() + k);
    return d.toISOString().slice(0, 10);
  }
  /** « aujourd'hui », ou le jour de la semaine. */
  const whenWord = (iso, today) => (iso === today ? "aujourd'hui" : weekdayName(iso));
  /** `2026-11-07` → `sam. 7` : sous une pastille, jamais une initiale seule ni un J+n. */
  function shortDate(iso) {
    const d = parse(iso);
    return `${SHORT_WEEKDAYS[d.getUTCDay()]} ${d.getUTCDate()}`;
  }

  // ------------------------------------------------------------ tendance des onze jours (étape B2)
  /** Même règle que la tendance d'un coin dans l'app (`CoinTrend`) : « mieux samedi 7 » si un jour à
   *  venir atteint au moins « bon » et fait mieux qu'aujourd'hui de plus de 0,05 ; sinon « stable
   *  toute la semaine » ou « en baisse » ; null sans météo aujourd'hui ou sans jour à venir. */
  const TREND_TOLERANCE = 0.05;
  function trend(days, today, goodMin) {
    const current = days.find((d) => d.iso === today)?.value;
    if (current === null || current === undefined) return { kind: "unknown" };
    const future = days.filter((d) => d.iso > today && d.value !== null && d.value !== undefined);
    if (future.length === 0) return { kind: "unknown" };
    const best = future.reduce((a, b) => (b.value > a.value ? b : a));
    if (best.value >= goodMin && best.value > current + TREND_TOLERANCE) return { kind: "better", iso: best.iso };
    if (best.value < current - TREND_TOLERANCE) return { kind: "falling" };
    return { kind: "stable" };
  }
  function trendPhrase(t) {
    if (t.kind === "better") return `mieux ${weekdayName(t.iso)} ${parse(t.iso).getUTCDate()}`;
    if (t.kind === "stable") return "stable toute la semaine";
    if (t.kind === "falling") return "en baisse";
    return null;
  }

  // ------------------------------------------------------------ services de l'IGN (étapes B3 et B5)
  /* Même hôte que le fond Plan IGN (data.geopf.fr) : aucun tiers nouveau. Ce qui part : le texte
   * tapé dans la recherche, la position du point dont on ouvre la fiche. */
  const IGN = "https://data.geopf.fr";
  /** Recherche de commune par le géocodage de l'IGN (sans clé). */
  const geocodeUrl = (q) => `${IGN}/geocodage/search?${new URLSearchParams({ q, type: "municipality", limit: "5", autocomplete: "1" })}`;
  /** Réponse du géocodage → [{ label, context, lon, lat }]. */
  function geocodeResults(body) {
    return (body?.features ?? []).map((f) => ({
      label: f.properties?.label ?? f.properties?.name ?? "",
      context: f.properties?.context ?? "",
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
    }));
  }
  /** Forêts publiques de l'ONF au point (WFS de la Géoplateforme, carré de ≈ 4 m autour du point). */
  function forestUrl(lat, lon) {
    const d = 0.00002;
    return (
      `${IGN}/wfs/ows?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature` +
      `&TYPENAMES=ONF.FORETS_PUBLIQUES:ONF_FORETS_PUBLIQUES&OUTPUTFORMAT=application/json&COUNT=1` +
      `&PROPERTYNAME=llib_frt,cdom_frt&BBOX=${lat - d},${lon - d},${lat + d},${lon + d},urn:ogc:def:crs:EPSG::4326`
    );
  }
  /** Phrase de la fiche : forêt domaniale, autre forêt publique, ou sans doute privée. */
  function forestPhrase(body) {
    const p = body?.features?.[0]?.properties;
    if (!p) return "Pas une forêt publique connue : sans doute privée, accord du propriétaire nécessaire";
    const name = p.llib_frt || "Forêt publique";
    return p.cdom_frt === "OUI"
      ? `${name} : forêt domaniale, cueillette familiale tolérée, sauf arrêté`
      : `${name} : forêt publique, cueillette familiale en général tolérée, sauf arrêté`;
  }

  // ------------------------------------------------------------ heure de calcul de la météo
  /** Date (ISO) et heure à Paris d'un instant UTC : la pré-chauffe tourne en UTC, on la dit en
   *  heure française quel que soit le fuseau du navigateur. */
  function parisParts(instant) {
    const d = new Date(instant);
    if (Number.isNaN(d.getTime())) return null;
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23",
      }).formatToParts(d).map((p) => [p.type, p.value])
    );
    return { iso: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
  }
  /** « météo calculée à 4 h » le jour même, « météo calculée le jeu. 5 nov. à 16 h » sinon ;
   *  null si l'instant est illisible. */
  function computedPhrase(instant, today) {
    const p = parisParts(instant);
    if (!p) return null;
    return p.iso === today ? `météo calculée à ${p.hour} h` : `météo calculée le ${frenchDate(p.iso)} à ${p.hour} h`;
  }
  /** Ligne sous la carte : « Aujourd'hui, ven. 6 nov. · météo calculée à 4 h ». */
  function todayLine(today, computedAt) {
    if (!today) return "";
    const head = `Aujourd'hui, ${frenchDate(today)}`;
    const when = computedAt ? computedPhrase(computedAt, today) : null;
    return when ? `${head} · ${when}` : head;
  }

  // ------------------------------------------------------------ palette
  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1, 7), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  /** Seuils triés décroissants, rgb pré-parsé. */
  function sortedClasses(palette) {
    return [...palette.thresholds].sort((a, b) => b.min - a.min).map((t) => ({ ...t, rgb: hexToRgb(t.hex) }));
  }
  function classify(classes, v) {
    return classes.find((c) => v >= c.min) ?? classes[classes.length - 1];
  }
  /** Couleur d'un pixel de score `v` (échelle linéaire, décision du 6 nov. 2026) : `rgb` de
   *  `scale.hex`, alpha = floor(255 × (alpha_min + (alpha_max − alpha_min) × v) + 0,5), `v` borné à
   *  [0, 1]. `Math.floor(x + 0.5)` et non `Math.round` : même arrondi qu'en Python et en Swift
   *  (skill scoring-parity, vecteurs shared/vectors/palette.json). Les seuils ne donnent que les mots. */
  function pixelColor(palette, v) {
    const { hex, alpha_min: lo, alpha_max: hi } = palette.scale;
    const s = Math.min(Math.max(v, 0), 1);
    return [...hexToRgb(hex), Math.floor(255 * (lo + (hi - lo) * s) + 0.5)];
  }
  /** Une couleur de la palette avant de l'écrire dans un attribut `style` : `#` puis 3 à 8 chiffres
   *  hexadécimaux, sinon `transparent` (la palette vient d'un fichier, pas du code). */
  const safeHex = (hex) => (typeof hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(hex) ? hex : "transparent");
  /** Un identifiant d'espèce du référentiel (`boletus_edulis`) : le seul qui entre dans un chemin. */
  const isSpeciesId = (id) => typeof id === "string" && /^[a-z0-9_]+$/.test(id);
  /** Le violet de l'échelle sert d'accent au site ; sans `scale` (API ancienne), le « Bon ». */
  function accentHex(palette) {
    if (palette.scale) return palette.scale.hex;
    const t = palette.thresholds.find((x) => x.label === "bon") ?? palette.thresholds[Math.floor(palette.thresholds.length / 2)];
    return t.hex;
  }

  // ------------------------------------------------------------ phrase de saison (accueil)
  /** Compte les départements par classe : [{label, fr, count}] dans l'ordre de la palette, plus `unknown`. */
  function classCounts(classes, values) {
    const counts = new Map(classes.map((c) => [c.label, 0]));
    let unknown = 0;
    for (const v of values) {
      if (v === null || v === undefined) unknown++;
      else counts.set(classify(classes, v).label, counts.get(classify(classes, v).label) + 1);
    }
    return { counts, unknown, known: values.length - unknown };
  }
  const plural = (n, word) => `${n} ${word}${n > 1 ? "s" : ""}`;
  /** « Cèpes aujourd'hui : bon ou excellent dans 23 départements, moyen dans 40, faible ailleurs. »
   *  Les deux classes du haut sont « bon ou excellent », celle du milieu « moyen », le reste « faible ».
   *  Aucune valeur inventée : sans indice, la phrase le dit. */
  function seasonSentence({ groupName, values, iso, today }, classes) {
    const when = whenWord(iso, today);
    const head = `${groupName} ${when} :`;
    const { counts, known } = classCounts(classes, values);
    if (known === 0) return `${head} pas encore d'indice, la météo du jour est en cours de calcul.`;
    const ordered = [...classes]; // du meilleur au pire
    const top = ordered.slice(0, 2).reduce((s, c) => s + counts.get(c.label), 0);
    const mid = ordered.length > 2 ? counts.get(ordered[2].label) : 0;
    const low = known - top - mid;
    if (top === 0 && mid === 0) return `${head} hors saison ou météo défavorable partout.`;
    const parts = [];
    if (top > 0) parts.push(`${ordered[1].fr.toLowerCase()} ou ${ordered[0].fr.toLowerCase()} dans ${plural(top, "département")}`);
    if (mid > 0) parts.push(`${ordered[2].fr.toLowerCase()} dans ${plural(mid, "département")}`);
    if (low > 0) parts.push(parts.length ? `${ordered[3]?.fr.toLowerCase() ?? "faible"} ailleurs` : `${ordered[3]?.fr.toLowerCase() ?? "faible"} dans ${plural(low, "département")}`);
    return `${head} ${parts.join(", ")}.`;
  }

  // ------------------------------------------------------------ Markdown de shared/texts/
  const esc = (x) => String(x).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  /** Gras, italique, code, liens ; le texte est échappé avant. */
  function inline(text) {
    return esc(text)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
      .replace(/\[([^\]]+)\]\(((?:https?|mailto):[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
  }
  /** Titres, paragraphes repliés, puces → HTML. `skipTitle` omet le titre de niveau 1 (celui de la page). */
  function renderMarkdown(md, { skipTitle = true } = {}) {
    const out = [];
    let para = [];
    let list = [];
    const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; } };
    const flushList = () => { if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; } };
    for (const raw of md.split("\n")) {
      const line = raw.trim();
      if (!line) { flushPara(); flushList(); continue; }
      const h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        flushPara(); flushList();
        const level = h[1].length;
        if (level === 1 && skipTitle) continue;
        out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      } else if (/^[-*]\s+/.test(line)) {
        flushPara();
        list.push(line.replace(/^[-*]\s+/, ""));
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara(); flushList();
    return out.join("\n");
  }
  /** Le titre de niveau 1 d'un Markdown, ou null. */
  const markdownTitle = (md) => md.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? null;

  // ------------------------------------------------------------ adresse de l'API et mode dev
  /** Le site (champis.app) et l'API (api.champis.app) sont deux services depuis le découpage des
   *  dépôts (6 nov. 2026). En local, l'API de `make serve` (champis-api) répond sur le port 8000 ;
   *  `?api=…` l'indique autrement. Hors d'un poste de développement, aucun paramètre d'URL ne
   *  change une source de données (`?api=`, `?tiles=`) : un lien piégé ferait lire à la page les
   *  réponses d'un serveur tiers. */
  const API_URL = "https://api.champis.app";
  const LOCAL_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
  const isLocal = (loc) => LOCAL_HOSTS.includes(loc.hostname);
  function apiBase(loc) {
    if (!isLocal(loc)) return API_URL;
    const q = new URLSearchParams(loc.search).get("api");
    if (q) return q.replace(/\/$/, "");
    return `${loc.protocol || "http:"}//${loc.hostname}:8000`;
  }
  const isDev = (search) => new URLSearchParams(search).get("dev") === "1";

  // ------------------------------------------------------------ vue de la carte (16 nov. 2026)
  /* « Centrer sur la France au premier lancement et mémoriser la dernière position vue » : la
   * dernière vue (zoom, latitude, longitude, arrondis ; rien d'autre) est gardée dans le
   * `localStorage` du navigateur, sous une seule clé. Pas de cookie : rien n'est envoyé à un
   * serveur. À l'ouverture, la position de l'URL (`#zoom/lat/lon`) l'emporte, puis la vue
   * mémorisée, puis la France métropolitaine entière. */
  const VIEW_KEY = "champis.carte.vue";
  const VIEW_VERSION = 1;
  /** France métropolitaine, Corse comprise : [ouest, sud, est, nord], d'Ouessant à la plaine
   *  orientale corse, du sud de Bonifacio à Bray-Dunes, avec une marge. */
  const FRANCE_BOUNDS = [-5.3, 41.2, 9.7, 51.2];
  /** Bornes d'une vue : le zoom minimal de la carte (en dessous de 4, plus aucune tuile à colorer),
   *  le zoom maximal de MapLibre, et la latitude où s'arrête la projection de la carte. */
  const VIEW_LIMITS = { minZoom: 4, maxZoom: 22, maxLat: 85.051129 };
  const round = (x, digits) => Math.round(x * 10 ** digits) / 10 ** digits;
  /** Une vue { zoom, lat, lon } aux nombres finis et dans les bornes de la carte, arrondie (zoom au
   *  centième, position à 1e-4°, ≈ 10 m), ou null. */
  function checkedView(v, limits = VIEW_LIMITS) {
    if (!v || typeof v !== "object") return null;
    const { zoom, lat, lon } = v;
    if (![zoom, lat, lon].every((x) => typeof x === "number" && Number.isFinite(x))) return null;
    if (zoom < limits.minZoom || zoom > limits.maxZoom) return null;
    if (Math.abs(lat) > limits.maxLat || Math.abs(lon) > 180) return null;
    return { zoom: round(zoom, 2), lat: round(lat, 4), lon: round(lon, 4) };
  }
  /** Texte écrit sous VIEW_KEY : `{"v":1,"zoom":…,"lat":…,"lon":…}`, ou null pour une vue invalide. */
  function serializeView(view, limits = VIEW_LIMITS) {
    const v = checkedView(view, limits);
    return v ? JSON.stringify({ v: VIEW_VERSION, zoom: v.zoom, lat: v.lat, lon: v.lon }) : null;
  }
  /** Vue relue du texte mémorisé, ou null : texte absent, illisible, d'une autre version, ou vue
   *  hors des bornes de la carte. */
  function parseView(text, limits = VIEW_LIMITS) {
    if (typeof text !== "string") return null;
    let o;
    try {
      o = JSON.parse(text);
    } catch {
      return null;
    }
    return o && typeof o === "object" && o.v === VIEW_VERSION ? checkedView(o, limits) : null;
  }
  /** Position portée par l'URL (`#zoom/lat/lon`, puis cap et inclinaison éventuels), ou null. Même
   *  règle que MapLibre (`hash: true`), qui l'applique lui-même : au moins trois champs, tous des
   *  nombres. */
  function hashView(hash) {
    const parts = String(hash ?? "").replace(/^#/, "").split("/");
    if (parts.length < 3 || parts.some((p) => isNaN(p))) return null;
    return { zoom: +parts[0], lat: +parts[1], lon: +parts[2] };
  }
  /** Vue d'ouverture de la carte, par ordre de priorité : l'URL (`source: "url"`, MapLibre la lit),
   *  la vue mémorisée (`"memoire"`, avec `zoom`, `lat`, `lon`), sinon la France entière (`"france"`,
   *  avec `bounds` à cadrer dans la fenêtre). */
  function initialView(hash, stored, limits = VIEW_LIMITS) {
    if (hashView(hash)) return { source: "url" };
    const view = parseView(stored, limits);
    if (view) return { source: "memoire", ...view };
    return { source: "france", bounds: FRANCE_BOUNDS };
  }
  /* Accès au stockage : `localStorage` peut manquer ou lever (navigation privée, quota, réglages du
   * navigateur), à la lecture de la propriété comme à l'appel. Tout échec est silencieux : la
   * carte s'ouvre alors sur la France et ne mémorise rien. */
  const browserStorage = () => root.localStorage;
  /** Texte mémorisé sous VIEW_KEY, ou null. */
  function readStoredView(storage = browserStorage) {
    try {
      return storage().getItem(VIEW_KEY);
    } catch {
      return null;
    }
  }
  /** Écrit la vue sous VIEW_KEY ; renvoie le texte écrit, ou null si rien n'a été écrit. */
  function storeView(view, storage = browserStorage, limits = VIEW_LIMITS) {
    const text = serializeView(view, limits);
    if (!text) return null;
    try {
      storage().setItem(VIEW_KEY, text);
      return text;
    } catch {
      return null;
    }
  }

  // ------------------------------------------------------------ navigateur seulement
  /* Barre du téléphone : trois entrées (étape A, 6 nov. 2026), deux tant que Soutenir est masqué.
   * Sur ordinateur, Soutenir est à droite de l'en-tête, hors de la navigation. */
  const PAGES = [
    { href: "carte.html", title: "Carte", icon: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14" },
    { href: "comprendre.html", title: "Guide", icon: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm4 4h8M8 13h8" },
    { href: "soutenir.html", title: "Soutenir", support: true, icon: "M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z" },
  ];
  /** En-tête : logo, pages, puis Soutenir à droite. Les outils d'une page (`.nav-tools` déjà dans
   *  l'en-tête : sélecteur d'espèce et recherche de la carte, 9 nov. 2026) sont gardés, entre les
   *  pages et Soutenir. */
  function renderNav(active) {
    if (typeof document === "undefined") return;
    const header = document.getElementById("site-header");
    if (header) {
      const tools = header.querySelector(".nav-tools");
      header.innerHTML =
        `<a class="brand" href="index.html"><img src="logo.svg" alt="" width="32" height="32" /> <span class="brand-name">Champis</span></a>` +
        `<nav aria-label="Pages">${PAGES.filter((p) => !p.support).map((p) => `<a href="${p.href}"${p.href === active ? ' aria-current="page"' : ""}>${p.title}</a>`).join("")}</nav>` +
        `<span class="spacer"></span>` +
        (SUPPORT_VISIBLE ? `<a class="support" href="soutenir.html">Soutenir</a>` : "");
      if (tools) header.insertBefore(tools, header.querySelector(".spacer"));
    }
    const tabs = document.getElementById("site-tabs");
    if (tabs) {
      const shown = PAGES.filter((p) => SUPPORT_VISIBLE || !p.support);
      tabs.style.gridTemplateColumns = `repeat(${shown.length}, 1fr)`;
      tabs.innerHTML = shown.map(
        (p) => `<a href="${p.href}"${p.href === active ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${p.icon}"/></svg>${p.title}</a>`
      ).join("");
    }
    const footer = document.querySelector("footer.site-footer");
    if (footer && !footer.childElementCount) {
      footer.innerHTML =
        `<span>Champis indique un potentiel, pas une autorisation : <a href="comprendre.html?article=cueillir-sans-nuire">cueillir sans nuire</a>.</span>` +
        `<a href="comprendre.html?article=confidentialite">Confidentialité</a>` +
        `<a href="comprendre.html?article=donnees-et-sources">Données et licences</a>` +
        `<a href="comprendre.html?article=mentions-legales">Mentions légales</a>` +
        `<a href="mailto:${CONTACT_EMAIL}">Contact</a>` +
        (SUPPORT_VISIBLE ? `<a href="soutenir.html">Soutenir Champis</a>` : "");
    }
    if (!SUPPORT_VISIBLE) document.querySelectorAll("[data-support]").forEach((el) => el.remove());
  }
  function applyAccent(palette) {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty("--accent", accentHex(palette));
  }
  async function loadPalette() {
    const r = await fetch("../shared/palette.json");
    if (!r.ok) throw new Error("palette.json introuvable : servir la racine du dépôt");
    const palette = await r.json();
    applyAccent(palette);
    return palette;
  }
  /** Légende : une barre continue du transparent au violet de l'échelle, les cinq mots posés à
   *  leur seuil (échelle linéaire, 6 nov. 2026), puis « transparent ». Sans `scale` (API
   *  ancienne), une pastille par mot. */
  function renderLegend(el, palette) {
    const classes = sortedClasses(palette);
    el.classList.add("legend");
    const nodata = `<span class="nodata"><i></i>Transparent : hors forêt ou sans donnée</span>`;
    if (!palette.scale) {
      el.innerHTML =
        [...classes].reverse().map((c) => `<span><i style="background:${safeHex(c.hex)}"></i>${esc(c.fr)}</span>`).join("") + nodata;
      return;
    }
    const [r, g, b] = hexToRgb(palette.scale.hex);
    // chaque mot au milieu de sa classe (comme la pastille de son `hex`) ; le premier et le
    // dernier restent dans la barre
    const asc = [...classes].reverse();
    const words = asc
      .map((c, i) => {
        const mid = (c.min + (asc[i + 1]?.min ?? 1)) / 2;
        const at = i === 0 ? "left:0" : i === asc.length - 1 ? "right:0" : `left:${(mid * 100).toFixed(1)}%;transform:translateX(-50%)`;
        return `<span style="${at}">${esc(c.fr)}</span>`;
      })
      .join("");
    el.innerHTML =
      `<div class="scale" role="img" aria-label="${esc(classes.map((c) => c.fr).reverse().join(", "))} : du transparent au violet foncé">` +
      `<div class="bar" style="background-image:linear-gradient(to right, rgba(${r},${g},${b},0), ${safeHex(palette.scale.hex)})"></div>` +
      `<div class="words">${words}</div></div>` +
      nodata;
  }
  /** Onze pastilles datées de la fiche d'un point, en lecture seule (étape A, 6 nov. 2026 : la
   *  carte reste sur aujourd'hui, la fiche montre la semaine du point). `days` = [{ iso, value }],
   *  value null = pas de météo ce jour-là (pastille vide, jamais une valeur inventée). */
  function renderDayDots(el, { today, days, classes }) {
    el.classList.add("days");
    el.setAttribute("role", "list");
    el.innerHTML = days
      .map(({ iso, value }) => {
        const known = value !== null && value !== undefined;
        const cls = known ? classify(classes, value) : null;
        const label = `${iso === today ? "aujourd'hui, " : ""}${frenchDate(iso)} : ${known ? cls.fr : "pas de météo"}`;
        return (
          `<span role="listitem" class="day${iso === today ? " today" : ""}${iso < today ? " past" : ""}" title="${esc(label)}" aria-label="${esc(label)}">` +
          `<i style="background:${known ? safeHex(cls.hex) : "transparent"}"></i><span>${SHORT_WEEKDAYS[parse(iso).getUTCDay()]}</span><span>${parse(iso).getUTCDate()}</span></span>`
        );
      })
      .join("");
  }

  const Site = {
    WEEKDAYS, SHORT_WEEKDAYS, DAY_RANGE, SUPPORT_URL, SUPPORT_VISIBLE, APP_LINE, CONTACT_EMAIL, API_URL,
    weekdayName, shortWeekday, frenchDate, shortDate, dateFor, whenWord, parisParts, computedPhrase, todayLine,
    trend, trendPhrase, pointSentence, pointLink, pointFamilies, geocodeUrl, geocodeResults, forestUrl, forestPhrase,
    hexToRgb, safeHex, isSpeciesId, sortedClasses, classify, pixelColor, accentHex, classCounts, seasonSentence,
    esc, inline, renderMarkdown, markdownTitle, apiBase, isLocal, isDev,
    VIEW_KEY, VIEW_VERSION, FRANCE_BOUNDS, VIEW_LIMITS, serializeView, parseView, hashView, initialView, readStoredView, storeView,
    layerItems, renderNav, applyAccent, loadPalette, renderLegend, renderDayDots,
  };
  root.Site = Site;
  if (typeof module !== "undefined" && module.exports) module.exports = Site;
})(typeof globalThis !== "undefined" ? globalThis : this);
