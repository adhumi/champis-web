# Étude — la barre de navigation de la carte selon la largeur (9 nov. 2026)

La barre flotte au-dessus de la carte et porte, de gauche à droite : logo, pages (Carte, Guide), sélecteur d'espèce, recherche de commune, Soutenir. Question : que montrer quand la largeur manque ?

## Ce qui prend la place

Mesures dans Chromium (`system-ui`), le sélecteur affichant le nom de groupe le plus long (« Trompettes de la mort », *Craterellus* spp.) :

| Élément | Largeur |
| --- | --- |
| Logo + « Champis » | 118 px (logo seul : 32 px) |
| Carte, Guide | 131 px |
| Sélecteur (miniature, deux lignes, chevron) | 230 px à l'aise, lisible jusqu'à ≈ 120 px avec points de suspension |
| Recherche : champ / loupe | 240 px / 38 px |
| Soutenir : mot / cœur | 81 px / 38 px |

Mise à jour du même jour : la barre latérale de droite est retirée (la légende s'ouvre au bouton des commandes, comme sur téléphone) et Soutenir est masqué jusqu'à sa réactivation. La barre dispose donc de toute la largeur de l'écran moins 24 px. Le tout tient en ≈ 770 px avec le champ de recherche, ≈ 570 px avec la loupe ; Soutenir réactivé ajoute 81 px, qui tiennent encore à chaque seuil ci-dessous.

## Options regardées

1. **Barre qui défile** horizontalement : rejeté, des commandes disparaissent sans signe.
2. **Menu « … »** qui ramasse ce qui déborde : une étape de plus pour des liens qu'on cherche rarement depuis la carte, et un menu de plus à côté de celui des espèces.
3. **Repli par étapes**, du moins utile au plus utile : la recherche devient une loupe qui déplie le champ par-dessus toute la barre (le motif du téléphone), puis le nom « Champis » et le mot « Soutenir » cèdent la place au logo et au cœur, et le panneau de droite rétrécit. Le sélecteur garde la priorité : c'est la commande de la carte.

Retenu : **3**, aligné sur le téléphone (même loupe, même dépliage).

## Seuils (largeur de la fenêtre)

| Largeur | Barre |
| --- | --- |
| ≥ 900 px | tout, champ de recherche visible (240 px) |
| 720–899 px | recherche en loupe, dépliée par-dessus la barre |
| < 720 px (téléphone) | sélecteur et loupe seulement ; pages (et Soutenir, réactivé) dans la barre d'onglets du bas ; la recherche dépliée couvre le sélecteur |

La version compacte (logo seul, cœur pour Soutenir) de la première version n'est plus utile sans le panneau de droite : elle est retirée.

Contrôle : de 320 à 1440 px, aucun élément de la barre n'en chevauche un autre ni ne dépasse (script Playwright de mesure des boîtes, lancé à chaque seuil et à ± 1 px).

## Limites connues

- Les miniatures sont les planches de `shared/illustrations/` (2000 px, ≈ 400 Ko) réduites par le navigateur : la liste les charge à sa première ouverture (≈ 4 Mo pour dix espèces). Des vignettes de 96 px publiées par le référentiel diviseraient ce poids par cinquante ; à décider côté `adhumi/champis`.
