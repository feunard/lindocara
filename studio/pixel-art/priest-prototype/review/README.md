# Validation — Prêtre simplifié LCPixel, 6 septembre 2026

Cette revue concerne le dessin fourni à 18:47, le nouveau recalage du corps entier et le
mouvement du buste. Les captures utilisent Chrome installé sur Windows, le vrai renderer
HD-2D, sa caméra normale et la vitesse réelle de 3,65625 tuiles/s. Les textures livrées
sont celles de la preview et du test serveur de l'éditeur.

![Prêtre à côté de la Rôdeuse, de l'Assassin V2 et du Gardien runique](lineup.png)

## Vérifications effectuées

- `yarn verify` complet : lint, typechecks et tests de tous les packages, migrations,
  catalogues/cartes/musiques, validateurs Prêtre et Assassin, build et démarrage de
  l'artefact compilé. Tous passent.
- Nouvelle reconstruction complète dans un dossier séparé : les 19 fichiers runtime
  (17 atlases, portrait et manifest) sont identiques à l'octet près aux fichiers examinés.
- Comparaison des séquences capturées dans les huit directions : course, saut,
  les cinq sorts et mort. Inspection des étapes avant/après contact, de la jonction du
  cou, du mouvement du buste, de l'arme et de l'échelle. Les captures complètes du saut
  permettent d'examiner impulsion, apex, chute et réception sans le rognage des planches.
- Inspection de la nage, du planeur, de la réception de dégâts et de quatre Prêtres
  ensemble à la caméra normale. Comparaison avec les trois personnages de référence.
- Atelier : 18 clips chargés et examinés au début, au milieu et à la fin, avec les
  trajectoires du crâne, du buste, du bassin et des deux côtés des appuis affichées.
- Éditeur réel : sélection Prêtre · Prototype, lancement du test serveur, Trait radiant,
  déplacement/saut puis retour à l'éditeur. L'action serveur et sept instantanés du
  projectile sont reçus, sans exception navigateur. Le choix Assassin expose seulement V2.
- 48 contrôles de départ de projectile : Trait radiant et Soin, huit directions, délais
  simulés de 0/100/200 ms. Le premier point affiché rejoint l'orbe de l'arme à moins de
  0,000001 tuile. L'autorité serveur est couverte séparément par les tests réseau.
- Contrôles d'assets : 18 clips/huit directions, sources et textures identifiées par hash,
  palette fixe de 48 couleurs, alpha binaire, ancres reconstruites, densité uniforme par
  source, mouvement du buste, raccords de boucles/transitions, sockets de libération,
  fin de mort stable, aucun ancien dessin requis. Textures partagées : 161,8 Mio RGBA.
- Tests d'auteur : la réduction de palette ne fait pas remonter le cou vers les yeux,
  le transfert du buste conserve les pieds plantés, l'envol monte depuis les appuis voisins.
- LCPixel : 18 références verrouillées, même contrat chiffré en génération simple et en lot.
  Les fichiers et animations de l'Assassin V2 n'ont pas changé dans cette révision.

La [vidéo à vitesse normale](all-directions.webm), la
[séquence de course dans les huit directions](run-review.png) et les
[trajectoires de diagnostic](studio-trajectories.png) sont conservées pour comparaison.
La revue visuelle a utilisé les captures successives du moteur ; produire la vidéo ne
constitue pas en soi un contrôle perceptuel. `yarn priest:review` recrée les témoins complets
sous `artifacts/priest-prototype/runtime-review/`, y compris les images avant rognage.

## Limites observées

Au fort grossissement, les contours de tissu et d'équipement interpolés restent parfois
plus souples que les poses dessinées. Le flux optique n'est pas une simulation anatomique :
les empreintes ne prouvent pas des contacts de pieds physiquement exacts. Les appuis ont été
évalués à la caméra normale et la cadence reste asservie à la distance réellement parcourue.

Les règles LCPixel sont des cibles de production explicites. Les références, la palette et
les invariants mesurables sont contrôlés ; la lecture du visage, la densité des détails et
le naturel du geste restent soumis à une revue visuelle. Le nom LCPixel ne désigne pas un
nouveau modèle entraîné. Le jeu n'exécute ni IA, ni flux optique, ni cible de rendu par acteur.
