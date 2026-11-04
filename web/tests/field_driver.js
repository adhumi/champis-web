// Pilote de test : lit sur stdin un JSON [{ fn, args, as }, …], écrit sur stdout les résultats de
// ../field.js (source météo selon le zoom, fusion bbox/field, index spatial, facteur d'un pixel).
// Un résultat nommé par `as` se réutilise dans les appels suivants par { "$ref": "nom" } (les
// cellules sont une Map, l'index un objet avec des Map : ils ne passent pas en JSON).
// Fonctions internes : "@map" crée une Map, "@size" donne sa taille, "@get" une entrée.
const path = require("path");
const Field = require(path.join(__dirname, "..", "field.js"));

const builtins = {
  "@map": () => new Map(),
  "@size": (m) => m.size,
  "@get": (m, k) => m.get(k) ?? null,
};

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const named = new Map();
  const deref = (a) => (a && typeof a === "object" && "$ref" in a ? named.get(a.$ref) : a);
  const out = [];
  for (const { fn, args, as } of JSON.parse(input)) {
    try {
      const f = builtins[fn] ?? Field[fn];
      if (typeof f !== "function") throw new Error(`fonction inconnue : ${fn}`);
      const value = f(...(args ?? []).map(deref));
      if (as) named.set(as, value);
      // une Map ou un index ne se sérialise pas : on renvoie seulement sa taille
      out.push({ value: value instanceof Map ? { size: value.size } : value?.bins ? { size: value.size } : value });
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
