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
murale du navigateur correspond à celle du Worker. Un snapshot autoritaire `action: null` annule
immédiatement l'animation, le télégraphe et ses effets persistants, et empêche un ancien événement
`CombatAnimation` de la restaurer. Les projectiles déjà créés restent gouvernés par leurs propres
snapshots.
Un snapshot `action: null` n'interdit toutefois pas le prochain identifiant inédit : sa nouvelle
animation démarre dès l'événement, avant le snapshot réseau suivant. Seuls les identifiants
explicitement annulés restent bloqués, et un snapshot portant déjà une autre action active continue
de refuser les animations concurrentes.

| Classe | Compétence | Anticipation | Récupération | Résolution |
| --- | --- | ---: | ---: | --- |
| Guerrier | Cleave | 220 ms | 430 ms | Arc frontal, portée 60 |
| Guerrier | Iron Guard | 180 ms | 420 ms | Réduction 50 % pendant 3 500 ms |
| Guerrier | Shield Bash | 180 ms | 480 ms | Charge droite, premier obstacle/contact |
| Guerrier | Battle Cry | 300 ms | 500 ms | Zone de rayon 105 |
| Guerrier | Whirlwind | 320 ms | 600 ms | Zone de rayon 82 |
| Rôdeur | Quick Shot | 260 ms | 390 ms | Flèche droite, portée 170 |
| Rôdeur | Piercing Arrow | 300 ms | 500 ms | Flèche perforante, portée 200 |
| Rôdeur | Volley | 360 ms | 640 ms | Éventail de cinq flèches sur 36°, portée 160 |
| Rôdeur | Dash | 120 ms | 380 ms | Déplacement arrière de 189 |
| Rôdeur | Heartseeker | 360 ms | 700 ms | Flèche droite rapide, portée 230 |
| Prêtre | Radiant Bolt | 280 ms | 370 ms | Projectile magique, portée 225 ; total 650 ms |
| Prêtre | Mend | 240 ms | 600 ms | Soin personnel immédiat + lumière de soin à la frame active |
| Prêtre | Blink | 180 ms | 420 ms | Déplacement frontal de 110 |
| Prêtre | Prayer | 320 ms | 640 ms | Soin allié en rayon 155 avec ligne de vue |
| Prêtre | Divine Nova | 400 ms | 700 ms | Dégâts et soins en rayon 120 |

Les cooldowns, puissances, rayons, distances, coûts et niveaux de déblocage restent dans
`src/shared/skills.ts`; cette table n'a pas été silencieusement retunée. Les timings actifs et les
paramètres de projectiles vivent dans `src/shared/combat-actions.ts`.

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
400 px. Les snapshots restent room-local ; deux parties ou deux cartes ne partagent aucune liste de
projectiles. Une room vide peut réinitialiser ses monstres, projectiles et loot temporaire.

## Kits

### Guerrier

- Cleave frappe tous les monstres dans son arc frontal qui ont une ligne de vue ; rien derrière et
  rien au-delà d'un mur.
- Iron Guard conserve sa réduction, sans cible.
- Shield Bash balaye un segment frontal, s'arrête juste avant le premier mur ou monstre, inflige 24
  et conserve la provocation de menace.
- Battle Cry et Whirlwind résolvent chaque monstre au plus une fois dans leur rayon et respectent la
  ligne de vue.

### Rôdeur

- Quick Shot est une flèche physique droite à 540 px/s.
- Piercing Arrow avance à 600 px/s, peut traverser jusqu'à huit contacts et mémorise les entités
  déjà touchées.
- Volley est un éventail directionnel de cinq flèches. Un ensemble partagé empêche qu'une même
  activation frappe plusieurs fois le même monstre.
- Dash conserve son déplacement opposé au facing et s'arrête devant le terrain.
- Heartseeker est une flèche droite non guidée à 700 px/s. Elle peut rater et ne corrige jamais sa
  trajectoire.

### Prêtre

- Radiant Bolt est un projectile magique offensif droit, bloqué par le terrain.
- Mend soigne immédiatement le lanceur de 35 de base, puis crée à la frame active une lumière qui
  ignore monstres, héros à pleine vie et membres d'une autre partie. Le premier allié vivant et
  blessé touché reçoit aussi 35 de base. `selfPower` et `allyPower` sont configurables séparément.
- Blink avance dans le facing et ne traverse pas un collider.
- Prayer soigne le Prêtre et tous les alliés vivants et blessés dans le rayon avec ligne de vue.
- Divine Nova soigne les alliés, Prêtre compris, et frappe chaque monstre du rayon une fois.

Les événements `heal.cast` et `heal.received` transportent la couleur Tiny Swords validée du
Prêtre (`azure`, `ember`, `moss` ou `violet`). Mend, Prayer, Divine Nova, l'auto-soin et le soin
d'un allié gardent ainsi la couleur du lanceur jusque sur l'impact du destinataire ; une valeur
absente ou invalide retombe sans erreur sur `azure` et n'est jamais interpolée dans le texte i18n.

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
| Shield Bash | `Warrior_Attack2.png` | `Dust_02.png` | Meilleure charge du pack |
| Battle Cry / Whirlwind | `Warrior_Attack2.png` | `Explosion_01.png` | Substitution documentée : aucun cri/360 exact |
| Quick Shot / Piercing / Volley / Heartseeker | `Archer_Shoot.png` | `Arrow.png`, impact `Explosion_01.png` | Tir et flèche exacts |
| Radiant Bolt | `Heal.png` | `Hex Shaman_Projectile.png`, `Hex Shaman_Explosion.png` | Projectile magique Tiny Swords exact le plus proche |
| Mend | `Heal.png` | `Heal_Effect.png` déplacé puis joué à l'impact | Substitution : aucun projectile de soin exact |
| Blink | `Heal.png` | `Dust_02.png` | Téléportation la plus proche disponible |
| Prayer | `Heal.png` | `Heal_Effect.png` en zone | Soin exact |
| Divine Nova | `Heal.png` | `Heal_Effect.png` + `Explosion_01.png` | Lecture soin/dégâts distincte |
| Monstres | strip `attack` exact de chaque espèce | `Explosion_01.png` au contact | Animations d'espèce exactes |

Le projectile magique et son explosion sont chargés directement depuis le pack Enemy ; la lumière
de Mend réutilise `Heal_Effect` sans asset externe, génération ni forme CSS. Les effets d'impact ne
se jouent que sur un résultat serveur effectif. Le projectile visible est l'entité réseau : un
événement de dégâts ne le recrée pas une seconde fois.

## Client, contrôles et diagnostic

Clavier : Space/1 puis 2–5. Manette : le stick gauche définit mouvement et facing ; les boutons de
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
