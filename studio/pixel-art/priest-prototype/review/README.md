# Revue du 8 septembre 2026 — huit vues du Prêtre LCPixel

Cette revue remplace celle de la course articulée, rejetée par l'utilisateur pour son
effet de marionnette. Les tests de longueur des os ne validaient pas le mouvement perçu.
Le squelette et les pièces peintes sont supprimés du pipeline.

La course part de six dessins complets par vue. L'interpolation bidirectionnelle est celle
du Rogue V2. Cette version remplace la face de course oblique, les diagonales arrière à
grandes enjambées et les miroirs qui inversaient la main du bâton. Huit vues indépendantes
couvrent maintenant les déplacements et les actions, avec le bâton dans la main gauche.

La première correction de `back-quarter` restait incorrecte : haut du corps et pieds
ne regardaient pas dans la même direction. Cette séquence a été écartée. Les nouvelles
peintures inclinent le corps vers le haut à droite, avec les jambes dans la même perspective.
Le recalage automatique confondait aussi ceinture et botte sur certaines poses, créant
un saut latéral de toute la tête. Les repères de cette vue sont désormais vérifiés dans
`sources/locomotion/clips.json`, sans découper ni déformer séparément les membres.

![Prêtre, Rôdeuse, Assassin V2 et Gardien runique](lineup.png)

## Témoins examinés

Les captures utilisent Chrome, le renderer HD-2D, sa caméra normale et la vitesse de
3,65625 tuiles/s. La revue visuelle porte sur les captures successives, les clés peintes
et leurs intermédiaires. Enregistrer une vidéo ne constitue pas à lui seul un contrôle
perceptuel.

- [Course dans les huit directions](run-review.png) : transfert entre jambes, buste,
  bras mesurés, tête solidaire du corps et bâton. Les jambes ne sont plus des morceaux
  tournés séparément. La vue de face utilise six nouvelles peintures réellement frontales.
- [Saut et réception](jump-review.png) : départ depuis la phase de course courante,
  montée, apex, descente et retour à la course.
- [Comparaison avec le Rogue V2](comparison.png), à taille du jeu puis agrandie.
- [Repères des clés peintes](studio-trajectories.png). Les points servent à examiner
  le recalage ; ils ne représentent pas des os ou des pieds cachés calculés.
- [Enregistrement à vitesse normale](all-directions.webm), pour rejouer les changements
  de direction dans le moteur.

`yarn priest:review` recrée les séquences complètes sous
`artifacts/priest-prototype/runtime-review/` : 12 captures de course, 10 de saut,
8 par sort et 10 de mort par direction, ainsi que dégâts, nage, planeur et groupe de quatre.
Les cinq sorts et la mort ont aussi été examinés sur des planches de captures successives.

## Contrôles

- `yarn verify` complet passé en 230,5 secondes : lint, typage, tests de tous les
  packages, migrations, catalogues/cartes/musiques, validateurs Prêtre et Assassin,
  build puis démarrage de l'artefact compilé.
- Six tests d'auteur : clés peintes conservées exactement, fermeture interpolée du
  cycle, deux contacts distincts, densité de la face, stabilité du repère de cou après
  réduction de palette, échelle commune des sorts, reconstruction exacte de l'atlas
  dédupliqué et absence du saut de tête causé par le mauvais recalage arrière.
- Validateur : 18 états/huit directions, 32 raccords de boucle, extrémités des banques
  de transitions, pose de mort finale stable, sources et atlas hashés, palette et alpha.
- 48 départs de projectile : Trait radiant et Soin, huit directions et délais simulés
  de 0/100/200 ms. Le premier point affiché rejoint l'orbe à moins de 0,000001 tuile.
- Atelier : 18 clips chargés au début, milieu et terme, avec overlays, sans exception.
- Reconstruction indépendante : les 19 fichiers runtime et le rapport d'auteur sont
  identiques à l'octet près. Aucun ancien dessin de course ni texture du Rogue requis.
- Les 108 images de course de la diagonale basse droite, du profil droit et du dos
  sont identiques à celles de la version précédente. Les textures et les clips du Rogue
  V2 sont inchangés ; son validateur de compatibilité V1 et les tests du renderer passent.
- Textures partagées : **234,3 Mio RGBA**, dimension maximale 4096 pixels. Aucun calcul
  de squelette, génération IA ou interpolation d'images pendant la partie.
- Charte LCPixel : 28 références verrouillées. Les nouvelles orientations du Prêtre
  respectent la main gauche ; les références du Rogue V2, Gardien runique et Rôdeuse
  sont inchangées. La charte interdit les miroirs qui changent une arme de main.

## Limites de la validation

Le flux optique peut assouplir des contours pendant un croisement ou une occlusion,
particulièrement à fort grossissement. Il ne corrige pas une mauvaise pose source.
Les indicateurs d'images et les tests ne prouvent ni une biomécanique exacte ni une
perfection perceptuelle. La comparaison animée à taille normale reste nécessaire lors
de chaque changement de poses, de vitesse ou de caméra.
