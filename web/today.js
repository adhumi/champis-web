/* Accueil (refonte UX, lot 5) : la phrase de saison du jour pour le groupe choisi, calculée depuis
 * l'indice par département de GET /departements, le bandeau des onze jours (pastille = meilleure
 * classe atteinte en France ce jour-là), la légende et les liens. Plus de carte des départements
 * (spec › Points ouverts › Vue France et indice par département, 4 nov. 2026) : la carte, c'est
 * carte.html. Aucun calcul de score ici : l'API donne l'indice, la palette donne les mots et les
 * couleurs. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = Site.apiBase(location);
  Site.renderNav("index.html");
  $("app-line").textContent = Site.APP_LINE;

  let classes;
  let groups = []; // [{ id, fr, members: [sid] }] depuis GET /species
  let groupId = null;
  let selected = 0; // J+k
  const dept = { today: null, byCode: new Map() }; // code → { date: { value, leading, coverage } }

  const date = () => Site.dateFor(dept.today, selected);
  const series = (code) => dept.byCode.get(code)?.[date()] ?? null;

  /** Phrase, titre, libellé du jour et bandeau pour le groupe et le jour choisis (aucun appel réseau). */
  function paint() {
    if (!classes) return;
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
      $("note").textContent = Site.isDev(location.search) ? `GET /departements : ${e.message}` : "";
    }
  }

  async function loadSpecies() {
    const r = await fetch(`${API}/species`);
    if (!r.ok) throw new Error(`${r.status}`);
    const body = await r.json();
    const byGroup = new Map();
    for (const [sid, sp] of Object.entries(body.species)) {
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

  (async () => {
    try {
      const palette = await Site.loadPalette();
      classes = Site.sortedClasses(palette);
      Site.renderLegend($("legend"), classes);
      await loadSpecies();
      await fetchDepts();
    } catch (e) {
      $("sentence").textContent = "Le serveur de Champis ne répond pas pour le moment.";
      $("note").textContent = Site.isDev(location.search) ? e.message : "";
    }
  })();
})();
