/* Accueil (refonte UX, lot 5) : la France colorée par l'indice du jour de GET /departements pour
 * le groupe choisi, le bandeau des onze jours, la phrase de saison, la légende. Aucun calcul de
 * score ici : l'API donne l'indice, la palette donne les mots et les couleurs. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = Site.apiBase(location);
  Site.renderNav("index.html");
  $("app-line").textContent = Site.APP_LINE;

  let palette;
  let classes;
  let groups = []; // [{ id, fr, members: [sid] }] depuis GET /species
  let groupId = null;
  let selected = 0; // J+k
  const dept = { today: null, byCode: new Map() }; // code → { date: { value, leading, coverage } }
  let names = {}; // sid → nom français
  let deptNames = new Map(); // code → nom (du GeoJSON)

  if (typeof maplibregl === "undefined") {
    $("sentence").textContent = "La carte ne s'est pas chargée : vérifiez la connexion puis rechargez la page.";
    return;
  }
  const map = new maplibregl.Map({
    container: "france",
    style: { version: 8, sources: {}, layers: [] },
    center: [2.4, 46.6],
    zoom: 4.6,
    attributionControl: { compact: true, customAttribution: "Contours © IGN Admin Express (Licence ouverte)" },
    interactive: true,
    dragRotate: false,
  });
  map.touchZoomRotate.disableRotation();

  const date = () => Site.dateFor(dept.today, selected);
  const series = (code) => dept.byCode.get(code)?.[date()] ?? null;

  function paint() {
    if (!map.getLayer("depts-fill") || !classes) return;
    const expr = ["match", ["get", "code"]];
    for (const code of dept.byCode.keys()) {
      const v = series(code)?.value;
      if (v === null || v === undefined) continue;
      expr.push(code, Site.classify(classes, v).hex);
    }
    expr.push("rgba(0,0,0,0)"); // sans indice : transparent, jamais une valeur inventée
    map.setPaintProperty("depts-fill", "fill-color", expr.length > 3 ? expr : "rgba(0,0,0,0)");
    const group = groups.find((g) => g.id === groupId);
    const iso = date();
    if (group && iso) {
      const values = [...dept.byCode.keys()].map((code) => series(code)?.value ?? null);
      $("sentence").textContent = Site.seasonSentence({ groupName: group.fr, values, iso, today: dept.today }, classes);
      $("title").textContent = `La France des ${group.fr.toLowerCase()} ${Site.whenWord(iso, dept.today)}`;
      $("day-label").textContent = iso === dept.today ? `Aujourd'hui, ${Site.frenchDate(iso)}` : Site.frenchDate(iso);
    }
    Site.renderDays($("days"), {
      today: dept.today,
      selected,
      classes,
      valueFor: (d) => {
        // la pastille du bandeau porte la meilleure classe atteinte en France ce jour-là
        let best = null;
        for (const code of dept.byCode.keys()) {
          const v = dept.byCode.get(code)?.[d]?.value;
          if (v !== null && v !== undefined && (best === null || v > best)) best = v;
        }
        return best;
      },
      onSelect: (k) => {
        selected = k;
        paint();
      },
    });
  }

  async function fetchDepts() {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    const q = new URLSearchParams();
    for (const sid of group.members) q.append("species", sid);
    $("sentence").textContent = "Chargement de l'indice du jour…";
    try {
      const r = await fetch(`${API}/departements?${q}`);
      if (!r.ok) throw new Error(`${r.status}`);
      const body = await r.json();
      dept.today = body.today;
      dept.byCode.clear();
      for (const [code, d] of Object.entries(body.departements)) {
        const rows = d.groups?.[group.id] ?? [];
        dept.byCode.set(code, Object.fromEntries(rows.map((row) => [row.date, row])));
      }
      paint();
    } catch (e) {
      $("sentence").textContent = "L'indice du jour est indisponible pour le moment.";
      $("dept").textContent = Site.isDev(location.search) ? `GET /departements : ${e.message}` : "";
    }
  }

  async function loadSpecies() {
    const r = await fetch(`${API}/species`);
    if (!r.ok) throw new Error(`${r.status}`);
    const body = await r.json();
    const byGroup = new Map();
    for (const [sid, sp] of Object.entries(body.species)) {
      names[sid] = sp.names?.fr ?? sid;
      if (!sp.group) continue;
      const g = byGroup.get(sp.group.id) ?? { id: sp.group.id, fr: sp.group.fr, members: [] };
      g.members.push(sid);
      byGroup.set(g.id, g);
    }
    groups = [...byGroup.values()].sort((a, b) => a.fr.localeCompare(b.fr));
    const sel = $("group");
    sel.innerHTML = "";
    for (const g of groups) sel.add(new Option(g.fr, g.id));
    sel.disabled = groups.length === 0;
    // Cèpes par défaut (décision du 1er nov. 2026) : le groupe dont l'identifiant est « cepes » s'il existe
    groupId = (groups.find((g) => g.id === "cepes") ?? groups[0])?.id ?? null;
    if (groupId) sel.value = groupId;
    sel.addEventListener("change", () => {
      groupId = sel.value;
      fetchDepts();
    });
  }

  map.on("load", async () => {
    map.addSource("depts", { type: "geojson", data: "departements.geojson", promoteId: "code" });
    map.addLayer({ id: "depts-fill", type: "fill", source: "depts", paint: { "fill-color": "rgba(0,0,0,0)", "fill-opacity": 0.85 } });
    map.addLayer({ id: "depts-line", type: "line", source: "depts", paint: { "line-color": "rgba(90,90,90,.5)", "line-width": 0.8 } });
    map.on("click", "depts-fill", (e) => {
      const f = e.features?.[0];
      if (!f) return;
      const row = series(f.properties.code);
      const name = `${f.properties.nom} (${f.properties.code})`;
      if (!row || row.value === null) {
        $("dept").textContent = `${name} : pas d'indice ce jour-là.`;
        return;
      }
      const lead = row.leading ? ` · ${names[row.leading] ?? row.leading}` : "";
      const [lng, lat] = [e.lngLat.lng, e.lngLat.lat];
      $("dept").innerHTML =
        `${Site.esc(name)} : ${Site.esc(Site.classify(classes, row.value).fr.toLowerCase())}${Site.esc(lead)} · ` +
        `<a href="carte.html#9/${lat.toFixed(3)}/${lng.toFixed(3)}">voir la carte</a>`;
    });
    map.on("mouseenter", "depts-fill", () => (map.getCanvas().style.cursor = "pointer"));
    map.on("mouseleave", "depts-fill", () => (map.getCanvas().style.cursor = ""));
    try {
      palette = await Site.loadPalette();
      classes = Site.sortedClasses(palette);
      Site.renderLegend($("legend"), classes);
      await loadSpecies();
      await fetchDepts();
    } catch (e) {
      $("sentence").textContent = "Le serveur de Champis ne répond pas pour le moment.";
      $("dept").textContent = Site.isDev(location.search) ? e.message : "";
    }
  });
})();
