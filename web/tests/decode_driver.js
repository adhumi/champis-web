// Pilote de test : lit sur stdin un JSON [{ png: base64 }, …], écrit sur stdout un JSON
// [{ width, height, channels, data: base64 } | { error }] en décodant avec ../png.js.
const path = require("path");
const { decodePng } = require(path.join(__dirname, "..", "png.js"));

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", async () => {
  const out = [];
  for (const { png } of JSON.parse(input)) {
    try {
      const r = await decodePng(Uint8Array.from(Buffer.from(png, "base64")));
      out.push({ ...r, data: Buffer.from(r.data).toString("base64") });
    } catch (e) {
      out.push({ error: String(e.message || e) });
    }
  }
  process.stdout.write(JSON.stringify(out));
});
