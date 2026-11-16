// Pilote de test : la vue mémorisée de la carte (site.js) face à des stockages de navigateur
// simulés. Lit sur stdin un JSON [{ storage, initial, view }, …] et écrit pour chacun ce que
// `Site.readStoredView` relit, ce que `Site.storeView(view)` renvoie, les appels reçus par le
// stockage et son contenu final. `storage` : "ok", "absent" (`localStorage` indéfini), "leve"
// (lire la propriété lève, navigation privée ou réglages), "lecture" (`getItem` lève), "quota"
// (`setItem` lève).
const path = require("path");
const Site = require(path.join(__dirname, "..", "site.js"));

function fake(kind, initial) {
  const data = new Map(Object.entries(initial ?? {}));
  const calls = [];
  const refuse = (name) => {
    throw Object.assign(new Error("refusé"), { name });
  };
  const store = {
    getItem(k) {
      calls.push(["getItem", k]);
      if (kind === "lecture") refuse("SecurityError");
      return data.has(k) ? data.get(k) : null;
    },
    setItem(k, v) {
      calls.push(["setItem", k, v]);
      if (kind === "quota") refuse("QuotaExceededError");
      data.set(k, String(v));
    },
  };
  const get = () => {
    if (kind === "absent") return undefined;
    if (kind === "leve") refuse("SecurityError");
    return store;
  };
  return { get, calls, data };
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  const out = [];
  for (const { storage, initial, view } of JSON.parse(input)) {
    const f = fake(storage, initial);
    try {
      const read = Site.readStoredView(f.get);
      const written = view === undefined ? undefined : Site.storeView(view, f.get);
      out.push({ read, written: written ?? null, calls: f.calls, data: Object.fromEntries(f.data) });
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
