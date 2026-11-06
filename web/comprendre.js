/* Comprendre (refonte UX, lot 5) : les articles de shared/texts/ (Markdown servi par l'API, les
 * mêmes mots que l'app) et les fiches d'espèces du bloc `about` de GET /species. Aucune aide à
 * l'identification, aucun chiffre : la consigne du pharmacien précède les fiches. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const API = Site.apiBase(location);
  Site.renderNav("comprendre.html");
  Site.loadPalette().catch(() => {}); // l'accent du site vient de la palette
  const params = new URLSearchParams(location.search);
  const articleId = params.get("article") ?? "comment-ca-marche";
  const speciesId = params.get("espece");

  async function loadIndex() {
    const r = await fetch("../shared/texts/index.json");
    if (!r.ok) throw new Error("textes introuvables");
    return (await r.json()).articles;
  }
  async function loadText(file) {
    const r = await fetch(`../shared/texts/${file}`);
    return r.ok ? r.text() : null;
  }
  async function loadSpecies() {
    try {
      const r = await fetch(`${API}/species`);
      return r.ok ? (await r.json()).species : null;
    } catch {
      return null;
    }
  }

  function renderArticles(articles, current) {
    $("articles").innerHTML = articles
      .map((a) => `<a href="comprendre.html?article=${a.id}"${a.id === current ? ' aria-current="page"' : ""}>${Site.esc(a.title)}</a>`)
      .join("");
  }

  function speciesList(species) {
    if (!species) return `<p class="muted">Les fiches arrivent avec le catalogue des espèces, quand le serveur répond.</p>`;
    const groups = new Map();
    for (const sp of Object.values(species).sort((a, b) => (a.names?.fr ?? a.id).localeCompare(b.names?.fr ?? b.id))) {
      const g = sp.group?.fr ?? "Autres";
      groups.set(g, [...(groups.get(g) ?? []), sp]);
    }
    return [...groups.keys()].sort().map((g) =>
      `<h2>${Site.esc(g)}</h2><ul class="species-list">` +
      groups.get(g).map((sp) =>
        `<li><a href="comprendre.html?article=especes&espece=${sp.id}">${Site.esc(sp.names?.fr ?? sp.id)}<em>${Site.esc(sp.names?.la ?? "")}</em></a></li>`
      ).join("") + "</ul>"
    ).join("");
  }

  function speciesSheet(sp) {
    const about = sp.about;
    const name = sp.names?.fr ?? sp.id;
    let html = `<p class="back"><a href="comprendre.html?article=especes">← Les espèces</a></p><h1>${Site.esc(name)}</h1><p class="muted"><em>${Site.esc(sp.names?.la ?? "")}</em></p>`;
    if (!about) return html + `<p class="muted">Fiche à venir.</p>`;
    html += about.photo
      ? `<figure class="photo"><img src="${Site.esc(about.photo.url)}" alt="Photo : ${Site.esc(name)}" loading="lazy" />` +
        `<figcaption><a href="${Site.esc(about.photo.page)}" rel="noopener">${Site.esc(about.photo.author)} · ${Site.esc(about.photo.license)} · Wikimedia Commons</a></figcaption></figure>`
      : `<div class="photo"><div class="placeholder">Photo à venir</div></div>`;
    html += `<p>${Site.esc(about.summary)}</p><h2>Où</h2><p>${Site.esc(about.habitat)}</p><h2>Quand</h2><p>${Site.esc(about.season)}</p>`;
    html += `<h2>Ne pas confondre avec</h2>` + about.confusions.map((c) =>
      `<div class="confusion"><h3>${Site.esc(c.name)} <em>${Site.esc(c.latin)}</em></h3><p>${Site.esc(c.risk)}</p><p class="muted">${Site.esc(c.tell)}</p></div>`
    ).join("");
    html += `<p class="consigne">Ces fiches n'aident pas à identifier un champignon. Faites contrôler votre récolte par un pharmacien ou une association mycologique.</p>`;
    const refs = Object.entries(about.references ?? {});
    if (refs.length) {
      html += `<details><summary>Sources</summary><ul>${refs.map(([, v]) => `<li class="small">${Site.esc(v)}</li>`).join("")}</ul></details>`;
    }
    return html + (Site.APP_LINE ? `<p class="app-line">${Site.esc(Site.APP_LINE)}</p>` : "");
  }

  (async () => {
    try {
      const articles = await loadIndex();
      const article = articles.find((a) => a.id === articleId) ?? articles[0];
      renderArticles(articles, article.id);
      const md = await loadText(article.file);
      document.title = `Champis — ${article.title}`;
      if (article.species && speciesId) {
        const species = await loadSpecies();
        const sp = species?.[speciesId];
        $("content").innerHTML = sp ? speciesSheet(sp) : `<p class="muted">Espèce inconnue.</p>`;
        return;
      }
      let html = `<h1>${Site.esc(article.title)}</h1>` + (md ? Site.renderMarkdown(md) : `<p class="muted">Texte indisponible.</p>`);
      if (article.species) {
        html += speciesList(await loadSpecies());
        if (Site.APP_LINE) html += `<p class="app-line" id="app">${Site.esc(Site.APP_LINE)}</p>`;
      }
      if (article.id === "comment-ca-marche") {
        html += `<p class="small muted">Champis est gratuit et financé par des dons : <a href="soutenir.html">soutenir le projet</a>.</p>`;
      }
      $("content").innerHTML = html;
    } catch (e) {
      $("content").innerHTML = `<p class="muted">Les textes sont indisponibles pour le moment.${Site.isDev(location.search) ? ` (${Site.esc(e.message)})` : ""}</p>`;
    }
  })();
})();
