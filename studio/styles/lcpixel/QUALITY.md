# LCPixel — qualité minimale des personnages et monstres

Le **Prêtre du commit `e9f4b4402e3f2de5ec8feccf234bdebbe7245c0b`** est le minimum
acceptable fixé par le créateur de Lindocara le 8 septembre 2026. Cette exigence s'applique
à **tout personnage et tout monstre nouvellement créé ou modifié**, y compris PNJ,
variantes et prototypes proposés comme terminés. Une version en dessous de ce seuil
reste un travail en cours et ne doit pas être présentée comme validée.

C'est un plancher de qualité par action et par direction, pas une moyenne : une bonne
immobilité ne compense pas une mauvaise course, ni une bonne face un mauvais dos.
Les autres personnages existants ne constituent pas une dérogation à ce minimum.

## Référence figée

Le dossier [minimum](minimum/) conserve le manifest et les témoins visuels de cette
version. `baseline.lock.json` fixe leurs SHA-256, le commit source et les empreintes
des 19 fichiers runtime. Les mises à jour du Prêtre jouable, un nouveau build ou
`build_reference.py` ne déplacent pas cette référence.

- [Course dans les huit directions](minimum/run-review.png), à la caméra du jeu.
- [Saut et réception](minimum/jump-review.png).
- [Lecture à vitesse normale](minimum/all-directions.webm).
- [Poses et références directionnelles](minimum/paired-keys.png).
- [Virages successifs](minimum/turn-detail.png).
- [Manifest complet des 18 clips](minimum/manifest.json).

`yarn quality:reference` restaure les atlas exacts depuis ce commit dans un dossier
ignoré sous `artifacts/actor-quality/`, vérifie leurs empreintes et imprime l'URL de
lecture. Lancer `yarn priest:studio` pour l'ouvrir. L'extraction ne modifie aucun asset
du jeu. Dans un clone superficiel sans ce commit, exécuter la commande `git fetch`
indiquée par l'outil puis relancer l'extraction. Aucun historique distant n'est
nécessaire pour `yarn quality:check` ni pour la CI.

La référence ne peut être abaissée, remplacée ou réétiquetée pour faire passer un
candidat. Un relèvement du seuil doit être explicitement demandé et conserver la
traçabilité de la référence précédente. Cette règle n'empêche pas d'améliorer le Prêtre.

## Conditions de validation

| Domaine | Minimum exigé |
| --- | --- |
| Dessin | Respect de la charte LCPixel, silhouette lisible, identité, palette, vêtements et équipement stables. Aucun changement de main involontaire. |
| Taille | Proportions et densité cohérentes entre directions et actions. Les flexions, envols et chutes gardent leur variation naturelle ; aucun redimensionnement par image pour masquer une dérive. |
| Locomotion | Transfert du poids, appuis et amplitude crédibles ; corps entier coordonné, buste et tête reliés. Aucun glissement, tremblement, membre qui saute ou effet de marionnette gênant à la vitesse et à la taille normales. |
| Directions | Toutes les orientations utilisées par l'architecture de l'acteur sont couvertes. Tester chaque direction séparément, notamment les deux profils et les deux diagonales arrière, puis les virages. |
| Lecture | Cadence compatible avec le déplacement réel ; diagonales correctes ; phase conservée aux virages pertinents ; aucun redémarrage à chaque update. Boucles et transitions sans raccord gênant. |
| Actions | Chaque état réellement accessible possède une animation complète. Attaques et compétences lisibles : anticipation, libération/impact, récupération ; projectiles et hitboxes synchronisés avec l'arme ou l'organe qui agit. |
| Air et mort | Saut, chute, réception, vol/nage si applicables : continuité des poses et des transitions. Mort continue et pose finale stable lorsqu'une mort est prévue. |
| Intégration | Canvas, ancre, trimming et sockets reconstruits sans jitter ; aucun état ou asset manquant. Coût mémoire/runtime mesuré et adapté à la population affichée, particulièrement pour les monstres nombreux. |

Le Prêtre fournit un niveau de finition, pas une anatomie universelle. Un quadrupède,
un volant, un géant ou une créature sans jambes garde sa morphologie, son échelle et
sa mécanique propres. Ne lui imposer ni les dimensions du Prêtre, ni son bâton, ni
ses 18 états, ni 36 images par boucle. Déduire états et directions du code et des besoins
réels ; justifier les états non applicables. La méthode d'animation peut évoluer si
elle atteint ou dépasse le résultat visuel de référence. Ajouter des cases ne constitue
pas une preuve d'amélioration.

## Revue obligatoire avant de conclure

1. Inventorier depuis le code les états, directions, vitesses, transitions et événements
   gameplay de l'acteur. Établir sa matrice de couverture.
2. Comparer le candidat à la référence figée au style LCPixel, dans le moteur, à caméra,
   zoom et vitesse de jeu normaux. Respecter la taille propre de chaque espèce.
3. Examiner les cycles complets, leur fermeture, les départs/arrêts, les changements
   de direction, les compétences et les transitions accessibles. Les ralentis,
   superpositions et vues agrandies servent au diagnostic, puis revérifier à vitesse normale.
4. Conserver captures/séquences, paramètres de lecture, version des assets, résultats
   par état/direction, synchronisation gameplay et coût mesuré. Utiliser le
   [modèle de revue](REVIEW_TEMPLATE.md) ; aucune case non examinée ne vaut validation.
5. Corriger les défauts observés et refaire les contrôles affectés. Exécuter les
   validateurs de l'acteur et les vérifications du projet, y compris les régressions
   sur les autres acteurs si le système partagé change.

**Les tests verts, les empreintes, une planche statique ou le simple enregistrement
d'une vidéo ne suffisent pas à valider la qualité du mouvement.** `quality:check`
protège l'intégrité de la référence ; il ne juge pas automatiquement la fluidité d'un
nouveau personnage ou monstre. La comparaison visuelle et son compte rendu restent requis.
