# Diagonale arrière droite

`run-back-quarter-cycle.png` est la source acceptée pour cette vue. Le personnage entier
regarde et court vers le haut à droite ; sa main gauche tient le bâton derrière l'épaule.
La source remplace les essais avec buste droit et pieds orientés latéralement.

Deux générations avec l'outil image intégré ont construit la référence de course puis
la planche de six peintures. Les prompts exacts sont les fichiers voisins `.prompt.txt`.
La référence de course est conservée dans `run-back-quarter-reference.png`. Les autres
références étaient le canon `../handedness/canonical-back-quarter.png`, la planche LCPixel
et les clés de course arrière droite du Rogue V2. Pour le témoin Rogue : indices
0, 2, 4, 6, 7, 9 parmi ses dix poses peintes, dans une grille 3 × 2. Il guide les poses ;
aucun de ses pixels n'entre dans la reconstruction des atlas du Prêtre.

L'ordre rendu du modèle ne correspondait pas à l'ordre demandé dans le prompt. La sélection
revue est **0, 3, 2, 1, 4, 5**, ligne par ligne depuis la case supérieure gauche. Le build
conserve ces six peintures et construit les intermédiaires par le flux optique partagé.

Le recalage automatique par couleur trouvait parfois la botte au lieu de la ceinture.
Les six `sourceRoot` de `clips.json` repèrent donc le milieu de la ceinture dans les cellules
512 × 512. Les `targetRoot` placent la peinture entière dans le canvas 256 × 256 : contact
à y=143, compression à y=146, suspension à y=141. Une seule échelle commune vient de la
largeur médiane de la tête et du canon. Ces repères ne sont ni des articulations animées
ni une mesure des appuis cachés. Ne pas les recalculer depuis le pixel de botte le plus bas.

Avant toute modification : `uv run studio/pixel-art/priest-prototype/build.py --pilot back-quarter`.
Examiner le cycle entier et son raccord à la cadence normale dans l'URL imprimée.
Le pilote ne remplace pas les textures du jeu. Après validation, reconstruire les atlas,
puis revoir course, départ/arrêt et saut dans le renderer réel.
