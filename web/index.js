/* Accueil : navigation, légende lue dans la palette, ligne qui renvoie vers l'app quand elle existe. */
Site.renderNav("index.html");
Site.loadPalette()
  .then((palette) => Site.renderLegend(document.getElementById("legend"), palette))
  .catch(() => {});
if (Site.APP_LINE) {
  const line = document.getElementById("app-line");
  line.textContent = Site.APP_LINE;
  line.hidden = false;
}
