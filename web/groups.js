/* PMTiles par groupe d'affichage (G) côté carte, fonctions pures partagées entre le navigateur et
 * node (web/tests/test_groups.py) : séparation d'un PNG RGBA en un tableau de T par canal, et
 * plan de lecture d'une couche (quelles espèces viennent de quel fichier G, lesquelles de leur T).
 *
 * Spec › Points ouverts › Les clients lisent les PMTiles par groupe (5 nov. 2026) : dès qu'un G du
 * jeu courant est dans le manifeste, la carte lit T de chaque espèce du groupe dans ses canaux
 * (canal i = T × `scale` de `species[i]`, `nodata` = sans donnée pour ce canal, l'alpha est une
 * donnée comme les autres), aussi pour une couche « espèce seule » ; sans G, repli sur les T.
 * Rien ici ne connaît une espèce : l'ordre des canaux vient du manifeste (`species`) ou des
 * fichiers d'espèces, l'encodage de shared/palette.json (`group_tile_encoding`). */
(function (root) {
  "use strict";

  /** Octets d'un PNG décodé (`width × height × channels`, pixel par pixel) → un Float32Array de T
   *  par canal (NaN pour `nodata`). `channels` est le nombre de canaux du PNG ; `encoding` =
   *  `group_tile_encoding` de la palette ({ scale, nodata }). */
  function channelsToT(data, channels, encoding) {
    const { scale, nodata } = encoding;
    const n = Math.floor(data.length / channels);
    const out = [];
    for (let c = 0; c < channels; c++) {
      const t = new Float32Array(n);
      for (let i = 0, j = c; i < n; i++, j += channels) {
        const v = data[j];
        t[i] = v === nodata ? NaN : v / scale;
      }
      out.push(t);
    }
    return out;
  }

  /** Nombre de canaux attendu d'après l'encodage (`channels: "rgba"` → 4). */
  function channelCount(encoding) {
    const c = encoding.channels;
    return typeof c === "string" ? c.length : Number(c);
  }

  /** Plan de lecture des T d'une couche : `grouped` = un élément par fichier G à lire, avec les
   *  espèces demandées qu'il porte et leur canal ; `single` = espèces sans G chargé, à lire dans
   *  leur T. `groups` : itérable de { label, species: [ids dans l'ordre des canaux] }. Une espèce
   *  présente dans plusieurs G (seconde partie, jeu en double) est prise dans le premier. */
  function plan(speciesIds, groups) {
    const list = Array.isArray(groups) ? groups : [...groups];
    const grouped = new Map(); // label → { group, picks }
    const single = [];
    for (const sid of speciesIds) {
      let hit = null;
      for (const g of list) {
        const channel = g.species.indexOf(sid);
        if (channel >= 0) {
          hit = { g, channel };
          break;
        }
      }
      if (!hit) {
        single.push(sid);
        continue;
      }
      let entry = grouped.get(hit.g.label);
      if (!entry) grouped.set(hit.g.label, (entry = { group: hit.g, picks: [] }));
      entry.picks.push({ sid, channel: hit.channel });
    }
    return { grouped: [...grouped.values()], single };
  }

  /** Ordre des canaux d'un G fabriqué localement (glisser-déposer) : les espèces du groupe triées
   *  par identifiant, comme le pipeline (`species.species_groups`) ; `metas` = fichiers
   *  d'espèces { id, group: { id } }. `part` (1, 2…) découpe par `perFile` canaux. */
  function channelOrder(groupId, metas, part, perFile) {
    const ids = metas
      .filter((m) => m?.group?.id === groupId)
      .map((m) => m.id)
      .sort();
    const p = part ?? 1;
    return ids.slice((p - 1) * perFile, p * perFile);
  }

  /** `G-<groupe>-<hash>-p<version>-d<dh>[-<partie>].pmtiles` → { group, part } ou null. */
  function parseName(label) {
    const m = label.match(/(?:^|\/)G-([a-z_]+)-[0-9a-f]+-p[\d.]+-d[0-9a-f]+(?:-(\d+))?\.pmtiles$/);
    return m ? { group: m[1], part: m[2] ? Number(m[2]) : 1 } : null;
  }

  const Groups = { channelsToT, channelCount, plan, channelOrder, parseName };
  root.Groups = Groups;
  if (typeof module !== "undefined" && module.exports) module.exports = Groups;
})(typeof globalThis !== "undefined" ? globalThis : this);
