// Pilote de test : lit sur stdin un JSON [{ fn, args }, …], écrit sur stdout les résultats de
// ../groups.js (séparation des canaux d'un G, plan de lecture, ordre des canaux, nom de fichier).
// Pour `channelsToT`, `args[0]` est un PNG en base64 décodé par ../png.js, et le résultat est une
// liste de listes de nombres (null pour NaN). Les `species` d'un plan se réduisent à leurs labels.
const path = require("path");
const Groups = require(path.join(__dirname, "..", "groups.js"));
const { decodePng } = require(path.join(__dirname, "..", "png.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const out = [];
  for (const { fn, args } of JSON.parse(input)) {
    try {
      if (fn === "channelsToT") {
        const { channels, data } = await decodePng(Uint8Array.from(Buffer.from(args[0], "base64")));
        const ts = Groups.channelsToT(data, channels, args[1]);
        out.push({ value: ts.map((t) => Array.from(t, (v) => (Number.isNaN(v) ? null : v))) });
      } else if (fn === "plan") {
        const { grouped, single } = Groups.plan(...args);
        out.push({ value: { grouped: grouped.map((g) => ({ label: g.group.label, picks: g.picks })), single } });
      } else {
        out.push({ value: Groups[fn](...args) });
      }
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
