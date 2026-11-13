// Pilote de test : lit sur stdin un JSON [{ fn, args }, …], écrit sur stdout les résultats de
// ../comprendre.js (rendu pur du Guide : liste des articles, liste et fiche des espèces).
const path = require("path");
const Guide = require(path.join(__dirname, "..", "comprendre.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = [];
  for (const { fn, args } of JSON.parse(input)) {
    try {
      out.push({ value: Guide[fn](...args) });
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
