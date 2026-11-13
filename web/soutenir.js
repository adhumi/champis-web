/* Soutenir : navigation, accent, et le lien de don quand `Site.SUPPORT_URL` est renseigné. */
Site.renderNav("soutenir.html");
Site.loadPalette().catch(() => {});
if (Site.SUPPORT_URL) {
  document.getElementById("support-action").innerHTML =
    `<a class="button" href="${Site.esc(Site.SUPPORT_URL)}" rel="noopener">Faire un don</a> <span class="small muted">Paiement sécurisé, montant libre, sans compte Champis.</span>`;
}
