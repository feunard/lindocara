# LCPixel — charte de dessin de Lindocara

Version 1. Le nom **LCPixel** est choisi par le créateur du jeu. L'Assassin V2, le Gardien
runique et la Rôdeuse sont les références de cohérence. Le Prêtre simplifié définit son
identité propre dans ce style. La planche `characters.png` et les vues canoniques sont
obligatoires dans les générations avec références visuelles.

Les nombres ci-dessous sont des **cibles de production**, avec leurs tolérances. Ils ne
prétendent pas décrire chaque pixel des anciens prototypes. On mesure les proportions en
pose debout, hors arme, chevelure flottante et effets : on ne redimensionne jamais une pose
accroupie ou un saut pour lui faire remplir la boîte d'une pose debout.

| Élément | Règle |
| --- | --- |
| Proportions | Humanoïde compact de 2,65 têtes, intervalle 2,4–2,9 selon le rôle. Prêtre : 106 px du sommet du crâne à la semelle, répartis en tête 40 px, menton–ceinture 26 px, ceinture–sol 40 px ; tolérance debout ±2 px par repère. Les membres conservent leur longueur pendant le mouvement. |
| Taille | Corps moyen 104 px natifs ; enveloppe humanoïde 96–116 px, avant projection. Le Prêtre utilise un canvas fixe 256×256, ancre (128,190), 82,051282 px par tuile. Cela donne environ 64–72 px visibles à la caméra normale ; la taille écran dépend du zoom. La taille du canvas n'est pas la taille du personnage. |
| Contours | Contour extérieur charbon de 1–2 px natifs ; séparations internes de 1 px. Aucun contour qui grossit selon l'action, aucune frange magenta ou alpha gris. |
| Ombres | Quatre tons par matériau : ombre profonde, ombre, couleur locale, lumière. Un cinquième ton ponctuel pour le métal ou l'orbe. Pas de dégradé continu, pas de lumière directionnelle réinventée à chaque pose. |
| Détails | Trois motifs vestimentaires majeurs au maximum. Un motif décoratif doit former au moins un amas de 2×2 px. Hors visage et arme, les pixels colorés isolés ne doivent pas dépasser 1 % de la surface. Les grands volumes doivent rester lisibles à l'échelle du jeu. |
| Visages | Yeux de 4–6 px de hauteur native, un pixel de reflet par iris ; nez de 1–2 px, bouche de 2–4 px. Même implantation des yeux, barbe et mèche dans toutes les poses. La tête suit le cou et le buste avec une stabilisation douce ; aucune ligne droite de découpe sous le menton. |
| Armes | Bâton de 90–112 % de la hauteur du corps ; épée 45–80 %, dague 22–40 %, arc 50–85 %. Pour le Prêtre, hampe 3–5 px, orbe 6–10 px dans un anneau d'or simple. Aucun changement de longueur ou de main au milieu d'un clip. |
| Vue | Caméra orthographique du jeu inclinée de 38°, étirement de billboard 0,85. Huit directions par pas de 45° ; cinq vues dessinées et trois miroirs. La perspective dessinée des cinq références fait autorité : aucun changement d'angle de dessin pendant une action. |
| Palette | Palette figée avant animation : cible 48 couleurs, plafond 64 par personnage, hors transparence et effets séparés. Rampes chaudes pour peau/ivoire/cuir, ombres charbon légèrement froides. Saturation HSV des grandes surfaces ≤0,70 ; accents ≤0,92 sur ≤12 % de la surface. Pas de blanc pur étendu ni de noir pur étendu. |

## Interdictions

Anatomie réaliste élancée, membres de poupée, 3D brillante, rendu vectoriel lisse, airbrush,
dithering, grain, textures photographiques, broderies illisibles, accumulation de bijoux,
ombres au sol intégrées aux personnages, halo permanent intégré au corps, changements de
palette ou de proportions entre images, tête recollée par rectangle, torse immobile tandis
que seules les jambes bougent, normalisation de taille indépendante par frame, planche
géante regroupant toutes les directions et toutes les actions.

## Application aux générations

`studio/theme.json` sélectionne `style.json`. `studio.py sprite` vérifie les empreintes des
références puis injecte ce profil en mode simple comme en lot, en plus du déclencheur LoRA existant. `--character priest-prototype`
ajoute l'identité et sa référence canonique. Le mode `--no-theme` reste une dérogation
explicite de recherche ; ses sorties ne sont pas des assets LCPixel validés.

Pour une génération avec l'outil d'image intégré : fournir la planche de style et la référence
du personnage, exporter le texte complet avec `python studio/style_system.py --prompt`,
préciser action/vue/poses et conserver le prompt près des sources. Cet export ajoute les
valeurs chiffrées du JSON ; le mode simple et le mode lot injectent exactement le même
contrat. Ces nombres sont des consignes de dessin, pas des paramètres inventés du modèle.
Le nom du style seul n'entraîne pas un modèle.

Le contrôle automatique vérifie les fichiers de référence, la palette, les dimensions,
les ancres et les invariants d'animation. La qualité du dessin, la densité visuelle des
détails, les appuis et la lecture d'un geste exigent aussi une comparaison dans le moteur.
Un prompt fixe ne garantit jamais, à lui seul, la fidélité de toutes les images produites.
