/* Code partagé du site (refonte UX, lot 5) : palette et classes, dates en français, phrase de
 * saison depuis GET /departements, rendu du Markdown de shared/texts/, bandeau des jours, légende,
 * navigation. Les fonctions pures sont exportées pour node (web/tests/test_site.py) ; rien ici
 * ne connaît une espèce : noms, groupes, seuils et couleurs viennent de l'API et de la palette. */
(function (root) {
  "use strict";

  const WEEKDAYS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
  const SHORT_WEEKDAYS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
  const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  const DAY_RANGE = [-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7];
  /* Lien de don (RevenueCat Web Billing), à renseigner par Adrien ; null = la page explique en attendant. */
  const SUPPORT_URL = null;
  const APP_LINE = "Pour garder vos coins et être prévenu quand c'est bon : l'app Champis sur iPhone.";

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
  /** Le vert « Bon » de la palette sert d'accent au site ; à défaut, la classe du milieu. */
  function accentHex(palette) {
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
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" rel="noopener">$1</a>');
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
  /** Même origine : la page est servie par champis-api (Railway, `make serve`, quel que soit le
   *  port). En dev statique (`python -m http.server`), `?api=http://127.0.0.1:8000` l'indique. */
  function apiBase(loc) {
    const q = new URLSearchParams(loc.search).get("api");
    return q ? q.replace(/\/$/, "") : loc.origin;
  }
  const isDev = (search) => new URLSearchParams(search).get("dev") === "1";

  // ------------------------------------------------------------ navigateur seulement
  const PAGES = [
    { href: "index.html", title: "Aujourd'hui", icon: "M4 6h16M4 12h16M4 18h10" },
    { href: "carte.html", title: "Carte", icon: "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zm0 0v14m6-12v14" },
    { href: "comprendre.html", title: "Comprendre", icon: "M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zm4 4h8M8 13h8" },
  ];
  function renderNav(active) {
    if (typeof document === "undefined") return;
    const header = document.getElementById("site-header");
    if (header) {
      header.innerHTML =
        `<a class="brand" href="index.html"><img src="logo.svg" alt="" width="32" height="32" /> Champis</a>` +
        `<nav aria-label="Pages">${PAGES.map((p) => `<a href="${p.href}"${p.href === active ? ' aria-current="page"' : ""}>${p.title}</a>`).join("")}</nav>` +
        `<span class="spacer"></span><a class="support" href="soutenir.html">Soutenir</a>`;
    }
    const tabs = document.getElementById("site-tabs");
    if (tabs) {
      tabs.innerHTML = PAGES.map(
        (p) => `<a href="${p.href}"${p.href === active ? ' aria-current="page"' : ""}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${p.icon}"/></svg>${p.title}</a>`
      ).join("");
    }
    const footer = document.querySelector("footer.site-footer");
    if (footer && !footer.childElementCount) {
      footer.innerHTML =
        `<span>Champis indique un potentiel, pas une autorisation : <a href="comprendre.html?article=cueillir-sans-nuire">cueillir sans nuire</a>.</span>` +
        `<a href="comprendre.html?article=confidentialite">Confidentialité</a>` +
        `<a href="comprendre.html?article=donnees-et-sources">Données et licences</a>` +
        `<a href="soutenir.html">Soutenir Champis</a>`;
    }
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
  /** Légende : chaque couleur avec son mot, plus « transparent ». */
  function renderLegend(el, classes) {
    el.classList.add("legend");
    el.innerHTML =
      [...classes].reverse().map((c) => `<span><i style="background:${c.hex}"></i>${esc(c.fr)}</span>`).join("") +
      `<span class="nodata"><i></i>Transparent : hors forêt ou sans donnée</span>`;
  }
  /** Bandeau des onze jours : `valueFor(iso)` donne l'indice (ou null) qui colore la pastille. */
  function renderDays(el, { today, selected, classes, valueFor, onSelect }) {
    el.classList.add("days");
    el.setAttribute("role", "radiogroup");
    el.innerHTML = "";
    for (const k of DAY_RANGE) {
      const iso = dateFor(today, k);
      const v = iso && valueFor ? valueFor(iso) : null;
      const b = document.createElement("button");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(k === selected));
      b.classList.toggle("today", k === 0);
      const label = iso ? frenchDate(iso) : `J${k >= 0 ? "+" : ""}${k}`;
      const state = v === null || v === undefined ? "pas d'indice" : classify(classes, v).fr;
      b.title = `${label} : ${state}`;
      b.setAttribute("aria-label", b.title);
      b.innerHTML = `<i style="background:${v === null || v === undefined ? "transparent" : classify(classes, v).hex}"></i><span>${iso ? shortWeekday(iso) : ""}</span>`;
      b.addEventListener("click", () => onSelect(k));
      el.appendChild(b);
    }
  }

  const Site = {
    WEEKDAYS, SHORT_WEEKDAYS, DAY_RANGE, SUPPORT_URL, APP_LINE,
    weekdayName, shortWeekday, frenchDate, dateFor, whenWord,
    hexToRgb, sortedClasses, classify, accentHex, classCounts, seasonSentence,
    esc, inline, renderMarkdown, markdownTitle, apiBase, isDev,
    renderNav, applyAccent, loadPalette, renderLegend, renderDays,
  };
  root.Site = Site;
  if (typeof module !== "undefined" && module.exports) module.exports = Site;
})(typeof globalThis !== "undefined" ? globalThis : this);
