# Combat d'action directionnel

Cette tranche remplace le ciblage d'entité par un contrat de combat de type Zelda. Le serveur reçoit
uniquement une intention `attack` ou `skill` et décide de l'orientation, de la chronologie, de la
géométrie, des collisions, des dégâts, des soins, de la menace et des récompenses.

## Contrat réseau et orientation

- Le client envoie `{ t: "attack" }` ou `{ t: "skill", slot }`, sans `targetId`, victime, impact,
  dégâts, soin ni position.
- Le message historique `heal` est rejeté ; Mend est la compétence 2 du Prêtre.
- Le dernier mouvement non nul accepté par le serveur devient le facing. L'immobilité le conserve.
- Les snapshots diffusent ce facing pour orienter les autres héros, sans le persister dans D1.
- Les messages `animation` transportent un `actionId`, l'acteur, l'action/compétence, la direction
  figée et les instants serveur de début, impact et fin. Ces champs sont exclusivement visuels.
- Les projectiles autoritaires sont inclus dans les welcome/resync et dans les deltas, avec leur
  variante de couleur visuelle figée même si le propriétaire est hors de l'AOI. Le client ne crée
  jamais un impact de gameplay.

Un ancien message contenant `targetId` est rejeté par le parseur strict. Tab, la sélection au clic,
la cible automatique, les anneaux et le cadre de cible ont été retirés. La touche Tab reste libre
pour une mécanique ultérieure.

## Chronologie autoritaire

Chaque action possède une anticipation, une seule frame active et une récupération. Le cooldown et
la ressource sont consommés dès que le lancement est accepté, y compris si l'action rate. La
direction est figée au lancement. L'origine d'une frappe de mêlée suit encore l'acteur jusqu'à la
frame active ; l'origine d'un projectile est figée lorsqu'il apparaît. Une action résolue ne peut
pas l'être une seconde fois.

La mort, la transition de carte, la perte de présence ou la déconnexion annulent l'action en attente
et les projectiles de l'ancien propriétaire. Une room déchargée ne conserve ni action ni projectile.
Le client projette tous les timestamps avec un unique échantillon `SelfState.serverNow` /
`performance.now()` partagé par les cooldowns et le renderer ; il ne suppose jamais que l'horloge
murale du navigateur correspond à celle du Worker. L'autorité visuelle ordonne événements et
snapshots par identifiant d'action : un ancien snapshot `action: null` ou portant l'action
précédente ne peut plus annuler un événement `CombatAnimation` fraîchement reçu. Un `action: null`
cohérent avec la dernière action connue l'annule bien, tout comme la mort ou le changement de
carte. Les projectiles déjà créés restent gouvernés par leurs propres snapshots.

| Classe | Compétence | Anticipation | Récupération | Résolution |
| --- | --- | ---: | ---: | --- |
| Guerrier | Cleave | 110 ms | 215 ms | Arc frontal, portée 60 |
| Guerrier | Iron Guard | 180 ms | 420 ms | Posture activable : réduction 50 %, désactivation sur le même bouton |
| Guerrier | Shield Bash | 180 ms | 480 ms | Auto-cible visible la plus proche, charge jusqu'au premier obstacle/contact |
| Guerrier | Battle Cry | 300 ms | 500 ms | Provocation sans dégâts en rayon 105 |
| Guerrier | Whirlwind | 320 ms | 600 ms | Zone de rayon 82 |
| Rôdeur | Quick Shot | 130 ms | 195 ms | Flèche droite, portée 382,5 |
| Rôdeur | Piercing Arrow | 300 ms | 500 ms | Flèche perforante, portée 405 |
| Rôdeur | Volley | 360 ms | 640 ms | Éventail de cinq flèches sur 36°, portée 324 |
| Rôdeur | Dash | 120 ms | 380 ms | Déplacement arrière de 189 |
| Rôdeur | Heartseeker | 360 ms | 700 ms | Flèche droite rapide, portée 517,5 |
| Prêtre | Radiant Bolt | 140 ms | 185 ms | Projectile magique, portée 337,5 ; total 325 ms |
| Prêtre | Mend | 240 ms | 600 ms | Lumière de soin alliée, portée 195, sans auto-soin |
| Prêtre | Blink | 180 ms | 420 ms | Maintien directionnel variable, trajet cumulé collisionné de 247,5 |
| Prêtre | Prayer | 320 ms | 640 ms | Soin allié en rayon 155 avec ligne de vue |
| Prêtre | Divine Nova | 400 ms | 700 ms | Dégâts et soins en rayon 120 |

Les cooldowns, puissances, rayons, distances, coûts et niveaux de déblocage restent dans
`src/shared/skills.ts`. Shield Bash parcourt jusqu'à 300 px dans sa portée d'acquisition de 308 px ;
l'attaque de base du Guerrier démarre à 27 au lieu de 30. Les timings actifs et les paramètres de
projectiles vivent dans `src/shared/combat-actions.ts`. Les trois attaques de base partagent un
cooldown de 325 ms et une chronologie anticipation/récupération réduite de 50 % ; les compétences
spéciales et les attaques de monstres conservent leurs timings.

## Géométrie et projectiles

`src/shared/directional-combat.ts` fournit les fonctions pures communes : direction normalisée,
orientation, arc, cône, capsule, intersections, déplacement, collisions balayées terrain/entité et
choix déterministe du premier impact. Le client peut les dessiner en diagnostic, mais seul le
serveur applique un résultat.

Les projectiles portent leur propriétaire, partie, room, type, position, direction, vitesse, rayon,
portée restante, puissance, perforation, entités déjà touchées et expiration. Ils utilisent les
grilles spatiales des monstres et héros ; une collision balayée empêche le tunneling entre deux
ticks. Le terrain gagne lorsqu'il est rencontré avant une entité. Un même projectile ne frappe ou
ne soigne jamais deux fois la même entité.

Limites défensives V1 : 12 projectiles par joueur, 48 par room, durée 2 500 ms et portée plafonnée à
540 px. Les snapshots restent room-local ; deux parties ou deux cartes ne partagent aucune liste de
projectiles. Une room vide peut réinitialiser ses monstres, projectiles et loot temporaire.

## Kits

### Guerrier

- Cleave frappe tous les monstres dans son arc frontal qui ont une ligne de vue ; rien derrière et
  rien au-delà d'un mur.
- Iron Guard est une posture persistante activée après son anticipation. Tant qu'elle est active,
  elle réduit les dégâts reçus de 50 % et interdit toute autre attaque ou compétence. Le même
  bouton la désactive immédiatement et déclenche alors son cooldown de 8 s. La posture est
  session-locale et tombe à la mort, à la transition ou à la déconnexion.
- Shield Bash choisit côté serveur le monstre vivant et visible le plus proche dans sa portée,
  fige cette direction, puis balaye la charge. Il s'arrête juste avant le premier mur ou monstre,
  inflige 24 et conserve la provocation de menace. Sans cible valide, il conserve le facing : le
  client ne fournit jamais d'identifiant de cible.
- Battle Cry provoque chaque monstre vivant et visible de son rayon sans lui infliger de dégâts.
  Whirlwind inflige ses dégâts à chaque monstre au plus une fois et respecte la ligne de vue.

### Rôdeur

- Quick Shot est une flèche physique droite à 540 px/s.
- Piercing Arrow avance à 600 px/s, peut traverser jusqu'à huit contacts et mémorise les entités
  déjà touchées.
- Volley est un éventail directionnel de cinq flèches. Un ensemble partagé empêche qu'une même
  activation frappe plusieurs fois le même monstre.
- Dash conserve son déplacement opposé au facing et s'arrête devant le terrain.
- Heartseeker est une flèche droite non guidée à 700 px/s. Elle peut rater et ne corrige jamais sa
  trajectoire. Son statut d'ultime est porté par une flèche agrandie, une longue traînée rouge, une
  décharge au lancement et un impact magique renforcé.

### Prêtre

- Radiant Bolt est un projectile magique offensif droit, bloqué par le terrain.
- Mend parcourt jusqu'à 195 px et soigne uniquement le premier allié blessé touché.
- Lumen Step disparaît progressivement puis suit l'intention de mouvement acceptée par le serveur
  tant que le bouton reste maintenu. La direction peut changer sans rematérialisation ; le trajet
  cumulé est borné à 247,5 px et reste collisionné. Une fois entièrement transformé en nuage, le
  Prêtre est invulnérable jusqu'au début de sa rematérialisation. Un appui bref réapparaît sur
  place. Le relâchement, la distance maximale ou le délai serveur de 2,5 s lance la
  rematérialisation.
- Mend crée à la frame active une lumière verte qui ignore son lanceur, les monstres, les héros à
  pleine vie et les membres d'une autre partie. Le premier allié vivant et blessé touché reçoit 35
  de base. Le sort ne soigne plus le Prêtre.
- Prayer soigne le Prêtre et tous les alliés vivants et blessés dans le rayon avec ligne de vue.
- Divine Nova soigne les alliés, Prêtre compris, et frappe chaque monstre du rayon une fois.

Les événements `heal.cast` et `heal.received` transportent l'identifiant de compétence et la
couleur Tiny Swords validée du Prêtre (`azure`, `ember`, `moss` ou `violet`). La couleur reste une
métadonnée d'identité ; Mend force son projectile et son impact visuel en vert. Prayer et Divine
Nova gardent leur effet de zone Tiny Swords. Une couleur absente ou invalide retombe sans erreur
sur `azure` et n'est jamais interpolée dans le texte i18n.

Seul le soin réellement restauré produit ressource, menace de soin et contribution. Le sursoin ne
produit rien. La résurrection reste une interaction de proximité, pas une sélection.

## Monstres

La menace conserve un adversaire interne pour la poursuite. Au début d'une frappe, le monstre
s'oriente vers cet adversaire, fige la direction, joue son anticipation, puis résout une capsule à
la frame active. Il ne tourne pas pour garantir le coup : un héros sorti de la capsule esquive.

| Espèce | Anticipation | Récupération | Portée | Capsule | Strip Tiny Swords | Frame active (base 0) |
| --- | ---: | ---: | ---: | ---: | --- | ---: |
| Spear Goblin | 420 ms | 500 ms | 42 | 14 | `Spear Goblin_Attack Fast.png` | 3 |
| Torch Goblin | 460 ms | 500 ms | 42 | 16 | `Torch Goblin_Attack.png` | 3 |
| Gnoll Marauder | 480 ms | 500 ms | 46 | 18 | `Gnoll_Throw.png` | 5 |
| Skull Guard | 440 ms | 500 ms | 42 | 18 | `Skull_Attack.png` | 3 |
| Skull Crusader | 500 ms | 500 ms | 48 | 18 | `Skull_Attack.png` | 3 |
| Skull Warden | 520 ms | 500 ms | 50 | 18 | `Skull_Attack.png` | 3 |
| Minotaur Brute | 600 ms | 650 ms | 56 | 24 | `Minotaur_Attack.png` | 7 |
| Mire Troll / Gate Troll | 650 ms | 700 ms | 58 | 25 | `Troll_Attack.png` | 2 |

Un monstre mort perd immédiatement son action. Les dégâts ne sont plus appliqués à l'entrée dans la
portée, mais uniquement si la victime se trouve encore dans la capsule active.

## Mapping Tiny Swords

Le mapping central vit dans `src/client/game/combat-art.ts`. Les dimensions restent natives et les
textures sont mises en cache par source.

| Action | Animation du lanceur | Projectile / zone / impact | Choix |
| --- | --- | --- | --- |
| Cleave | `Warrior_Attack1.png` | `Explosion_01.png` à l'impact réel | Attaque exacte |
| Iron Guard | `Warrior_Guard.png` | garde persistante | Garde exacte |
| Shield Bash | `Warrior_Attack2.png` | glissade rendue + traînée or + `Dust_02.png` | Charge lisible sans déplacer l'autorité côté client |
| Battle Cry | `Warrior_Attack2.png` | `Explosion_02.png` orange + `Dust_02.png`, anneaux en accent | Asset Tiny Swords dominant pour une provocation de zone sans dégâts |
| Whirlwind | `Warrior_Attack2.png` | `Explosion_02.png` or 1,78× + `Explosion_01.png` 1,42×, anneaux en accent | Deux assets superposés pour un ultime 360° spectaculaire |
| Quick Shot | `Archer_Shoot.png` | `Arrow.png`, impact `Explosion_01.png` | Flèche de base sans traînée |
| Piercing / Volley | `Archer_Shoot.png` | `Arrow.png` avec tailles, teintes et traînées cyan/or distinctes | Identité visuelle propre par technique |
| Heartseeker | `Archer_Shoot.png` | flèche rouge 1,78×, traînée longue, décharge de départ et impact 1,65× | Ultime du rôdeur nettement distinct |
| Dash | `Archer_Shoot.png` | glissade rendue + traînée cyan + `Dust_02.png` | Le saut serveur n'apparaît plus comme une téléportation |
| Radiant Bolt | `Heal.png` | `Hex Shaman_Projectile.png`, `Hex Shaman_Explosion.png` | Projectile magique Tiny Swords exact le plus proche |
| Mend | `Heal.png` | `Hex Shaman_Projectile.png` et explosion teintés en vert | Même langage visuel que Radiant Bolt, version soin |
| Blink | `Heal.png` | `Dust_02.png` violet répété le long du trajet, fondu maintenu puis rematérialisation au relâchement | La direction peut changer pendant le maintien ; trajet cumulé borné à 247,5 px |
| Prayer | `Heal.png` | `Heal_Effect.png` en zone + cercle exact de rayon 155 | Soin et portée lisibles |
| Divine Nova | `Heal.png` | `Heal_Effect.png` 1,72× + `Explosion_02.png` 1,88× + impact `Explosion_01.png`, anneaux en accent | Assets Tiny Swords superposés, nettement plus imposants que Prayer |
| Monstres | strip `attack` exact de chaque espèce | `Explosion_01.png` au contact | Animations d'espèce exactes |

Le projectile magique et son explosion sont chargés directement depuis le pack Enemy ; Mend en
réutilise la silhouette avec une teinte et une traînée vertes. Les icônes du HUD reprennent ces
assets et traitements (projectile, flèche, poussière, soin ou explosion) au lieu d'icônes
d'inventaire génériques. Les effets d'impact ne se jouent que sur un résultat serveur effectif. Le
projectile visible est l'entité réseau : un événement de dégâts ne le recrée pas une seconde fois.

## Client, contrôles et diagnostic

Clavier : Space/1 puis 2–5. Pas de Lumen reste actif tant que la touche ou le bouton 3 est maintenu ;
les changements de direction modifient le trajet sans terminer le sort, et seul le relâchement
demande la rematérialisation. Manette : le stick gauche définit mouvement et facing ; les boutons de
compétence déclenchent sans sélection. Tactile : le joystick définit le facing et les cinq boutons
ne portent aucun identifiant de cible. Aucun twin-stick n'est ajouté en V1.

Le renderer convertit les échéances serveur avec le dernier échantillon monotone commun aux
cooldowns, aligne la frame de contact ou
de libération déclarée sur l'impact serveur, conserve l'animation jusqu'à la récupération, affiche
les projectiles distants et détruit actions, trajectoires et sprites lors d'un changement de carte.
`prefers-reduced-motion` peut réduire les ornements, mais ne participe jamais à la chronologie de
gameplay.
Le HUD ne prédit aucun délai à partir de `skill.cast` : ses cooldowns proviennent exclusivement de
`SelfState.cooldowns`, `SelfState.serverNow`, `ServerClock` et `clientCooldownDeadlines`, y compris
après une reconnexion.

En développement seulement, le diagnostic combat affiche arcs, capsules, rayons, segments balayés,
trajectoires, anticipation et frame active. Il est absent de la production normale.

## Limites V1

- Le facing est celui du stick de déplacement, sans visée indépendante.
- L'orientation n'est pas persistée : une nouvelle session reprend le facing runtime par défaut
  jusqu'au premier mouvement.
- Les projectiles sont diffusés à la room entière plutôt que filtrés par AOI ; la limite de 48 garde
  ce coût borné.
- Les monstres utilisent une capsule de mêlée commune paramétrée par espèce ; les attaques à distance
  spécifiques pourront devenir de vrais projectiles dans une tranche ultérieure.
- Les assets sans animation exacte utilisent uniquement les substitutions Tiny Swords documentées
  ci-dessus.
