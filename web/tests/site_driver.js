// Pilote de test : lit sur stdin un JSON [{ fn, args }, …], écrit sur stdout les résultats de
// ../site.js (fonctions pures : dates, classes, phrase de saison, Markdown, adresse de l'API).
const path = require("path");
const Site = require(path.join(__dirname, "..", "site.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = [];
  for (const { fn, args } of JSON.parse(input)) {
    try {
      out.push({ value: Site[fn](...args) });
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
