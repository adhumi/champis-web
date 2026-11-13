/* Accueil, avant tout rendu : les anciens liens vers la carte (index.html#zoom/lat/lon, ?tiles=…,
 * ?dev=1) y vont toujours. Dans un fichier, comme tout script du site : la CSP (Caddyfile)
 * n'autorise aucun script en ligne. */
if (/^#\d/.test(location.hash) || location.search) location.replace("carte.html" + location.search + location.hash);
