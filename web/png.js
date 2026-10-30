// Décodeur PNG minimal pour les tuiles de données (T × 254, classes d'altitude).
//
// Pourquoi pas drawImage + getImageData ? Ce chemin passe par la gestion des couleurs du
// navigateur : Safari convertit un PNG gris sans profil vers l'espace du canvas en le tramant,
// la valeur lue bouge de ±1 niveau selon le pixel et les pixels proches d'un seuil changent de
// classe au hasard (points isolés dans les carrés de 25 m ; pire pour la couche A, où ±1 change
// la classe d'altitude). Ici on lit les octets du fichier : résultat exact partout.
//
// Couvre ce que produit le pipeline et un peu plus : 8 bits, gris (0), RGB (2), gris + alpha (4),
// RGBA (6), non entrelacé. Pas de palette, pas de 16 bits, pas d'entrelacement Adam7.

(function (root) {
  const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
  const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

  /** Inflate zlib (format « deflate » des Compression Streams = flux zlib, celui du PNG). */
  async function inflate(parts) {
    const ds = new DecompressionStream("deflate");
    const writer = ds.writable.getWriter();
    for (const p of parts) writer.write(p);
    writer.close();
    const out = [];
    let n = 0;
    const reader = ds.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      out.push(value);
      n += value.length;
    }
    const buf = new Uint8Array(n);
    let o = 0;
    for (const c of out) {
      buf.set(c, o);
      o += c.length;
    }
    return buf;
  }

  function paeth(a, b, c) {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  }

  /** Défiltre les lignes (filtres 0 à 4 de la spec PNG) ; `bpp` = octets par pixel. */
  function unfilter(raw, width, height, bpp) {
    const stride = width * bpp;
    const out = new Uint8Array(stride * height);
    let src = 0;
    for (let y = 0; y < height; y++) {
      const type = raw[src++];
      const row = y * stride;
      const prev = row - stride;
      for (let i = 0; i < stride; i++) {
        const x = raw[src + i];
        const a = i >= bpp ? out[row + i - bpp] : 0;
        const b = y > 0 ? out[prev + i] : 0;
        const c = y > 0 && i >= bpp ? out[prev + i - bpp] : 0;
        let v;
        switch (type) {
          case 0:
            v = x;
            break;
          case 1:
            v = x + a;
            break;
          case 2:
            v = x + b;
            break;
          case 3:
            v = x + ((a + b) >> 1);
            break;
          case 4:
            v = x + paeth(a, b, c);
            break;
          default:
            throw new Error(`PNG : filtre inconnu ${type} (ligne ${y})`);
        }
        out[row + i] = v & 255;
      }
      src += stride;
    }
    return out;
  }

  /**
   * PNG (ArrayBuffer ou Uint8Array) → { width, height, channels, data } ; `data` est un
   * Uint8Array de `width × height × channels` octets, pixels de gauche à droite et de haut en bas.
   */
  async function decodePng(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < 8; i++) {
      if (bytes[i] !== SIGNATURE[i]) throw new Error("PNG : signature invalide");
    }
    let pos = 8;
    let header = null;
    const idat = [];
    while (pos + 8 <= bytes.length) {
      const length = view.getUint32(pos);
      const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);
      const start = pos + 8;
      if (start + length > bytes.length) throw new Error(`PNG : chunk ${type} tronqué`);
      if (type === "IHDR") {
        header = {
          width: view.getUint32(start),
          height: view.getUint32(start + 4),
          depth: bytes[start + 8],
          colorType: bytes[start + 9],
          interlace: bytes[start + 12],
        };
      } else if (type === "IDAT") {
        idat.push(bytes.subarray(start, start + length));
      } else if (type === "IEND") {
        break;
      }
      pos = start + length + 4; // + CRC, non vérifié
    }
    if (!header) throw new Error("PNG : IHDR absent");
    const channels = CHANNELS[header.colorType];
    if (header.depth !== 8 || !channels) {
      throw new Error(`PNG : ${header.depth} bits, type ${header.colorType} non géré`);
    }
    if (header.interlace !== 0) throw new Error("PNG : entrelacement non géré");
    const raw = await inflate(idat);
    const expected = header.height * (1 + header.width * channels);
    if (raw.length < expected) throw new Error("PNG : données décompressées trop courtes");
    const data = unfilter(raw, header.width, header.height, channels);
    return { width: header.width, height: header.height, channels, data };
  }

  root.decodePng = decodePng;
  if (typeof module !== "undefined" && module.exports) module.exports = { decodePng };
})(typeof globalThis !== "undefined" ? globalThis : this);
