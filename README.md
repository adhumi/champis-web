# Champis — le site champis.app

La météo des champignons, forêt par forêt : accueil, carte à 25 m, Guide, soutien. Pages statiques sans build ; le détail des pages est dans [`web/README.md`](web/README.md).

| Dépôt | Contenu |
| --- | --- |
| `adhumi/champis` | le référentiel (espèces, palette, textes du Guide), ici en sous-module `champis/` |
| `adhumi/champis-api` | pipeline terrain et API météo, sur `api.champis.app` |
| `adhumi/champis-web` (ce dépôt) | le site, service statique Railway (Caddy) sur `champis.app` |
| `adhumi/champis-ios` | l'app iOS, iPadOS et macOS |

```bash
git clone --recurse-submodules https://github.com/adhumi/champis-web
make setup && make serve        # http://localhost:8080/web/
make check                      # lint et tests (Python + node, sans réseau)
```

Code sous licence MIT ; les fichiers du référentiel (espèces, palette, textes) sous licence CC BY 4.0. Bibliothèques et données tierces : [`THIRD_PARTY.md`](THIRD_PARTY.md).
