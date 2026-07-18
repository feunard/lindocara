# Audit du combat directionnel

Date de l'audit : 18 juillet 2026
Branche : `feat/directional-action-combat`
`main` réel de départ : `d566bc49e7a0e54cc95903139a25d2751c1bf588`

## État vérifié avant modification

Le combat actuel est entièrement autoritaire pour les résultats, mais le client choisit encore
la victime. `attack`, `heal` et plusieurs `skill` transportent un `targetId`. Le client maintient
une cible dans Zustand, la choisit au clic ou avec Tab, l'affiche dans `TargetFrame`, puis empêche
localement certaines actions lorsque la cible attendue manque. Le serveur revalide l'identifiant,
la portée et la ligne de vue avant d'appliquer immédiatement dégâts ou soin.

Le serveur possède déjà les fondations utiles à la migration : orientation mise à jour par le
dernier mouvement autoritaire non nul, collision terrain partagée, grille spatiale, menace,
contributions, récompenses, ressources de classe, cooldowns, isolation par partie et par salle,
snapshots/deltas, ainsi que les cycles de tick du Durable Object. L'orientation existe seulement
dans `PlayerRuntime` et n'est ni persistée ni envoyée dans les snapshots.

Les monstres conservent une cible interne de menace et de navigation. Cette cible est une décision
du serveur et ne constitue pas du ciblage joueur. En revanche, lorsqu'ils arrivent à portée, leurs
dégâts sont encore appliqués immédiatement, sans anticipation ni zone active esquivable.

## Dépendances au ciblage

- `src/shared/protocol.ts` : `targetId` dans `attack`, `heal` et `skill`, animations avec point de
  destination, codes d'erreur de cible et absence de projectile dans le monde répliqué.
- `src/server/world.ts` et `src/server/world/combat-system.ts` : résolution par identifiant,
  cooldown consommé seulement après acquisition d'une cible valide, dégâts et soins instantanés.
- `src/server/world/skill-system.ts` et `src/shared/skills.ts` : classification des compétences par
  type de cible, charges orientées vers une entité et soins unitaires sélectionnés.
- `src/server/world/monster-system.ts` : attaque instantanée de la cible de menace à portée.
- `src/client/game/session.ts`, `net.ts` et `targeting.ts` : acquisition automatique, sélection,
  envoi de l'identifiant et refus local d'agir sans cible.
- `src/client/game/input.ts` et `input-settings.ts` : action `target`, Tab et bouton de manette.
- `src/client/game/renderer.ts` : clics de sélection, anneaux, surbrillance des barres de vie et
  effets/projectiles simulés vers la position de la cible.
- `src/client/store.ts`, `src/client/ui/hud/TargetFrame.tsx` et `App.tsx` : état et cadre de cible.
- dictionnaires FR/EN, aide, paramètres et tests : libellés de ciblage et attentes liées à une
  victime sélectionnée.

Les identifiants présents dans les invitations de groupe, la table de menace, la navigation des
monstres et l'attribution des contributions restent nécessaires : ils ne sont jamais fournis pour
choisir la victime d'une action joueur.

## Compétences à migrer

| Classe | Compétence | Exécution actuelle | Exécution directionnelle retenue |
| --- | --- | --- | --- |
| Guerrier | `cleave` | cible hostile unique | arc frontal multi-cible à impact différé |
| Guerrier | `iron_guard` | effet personnel | garde personnelle sans cible |
| Guerrier | `shield_bash` | charge vers une cible | capsule frontale, arrêt terrain/premier monstre |
| Guerrier | `battle_cry` | zone instantanée | zone autour du lanceur à la frame active |
| Guerrier | `whirlwind` | zone instantanée | cercle, une résolution par monstre |
| Rôdeur | `quick_shot` | impact instantané ciblé | flèche droite bloquante |
| Rôdeur | `piercing_arrow` | cible unique | flèche perforante, une fois par monstre |
| Rôdeur | `volley` | zone autour de la cible | éventail directionnel de projectiles |
| Rôdeur | `dash` | recul personnel | recul opposé à l'orientation conservé |
| Rôdeur | `heartseeker` | cible unique | flèche droite puissante non guidée |
| Prêtre | `radiant_bolt` | cible hostile | projectile magique bloquant |
| Prêtre | `mend` | allié sélectionné | soin personnel et projectile de soin simultanés |
| Prêtre | `blink` | déplacement personnel | déplacement dans l'orientation, collision conservée |
| Prêtre | `prayer` | zone de soin | soin de zone allié avec ligne de vue |
| Prêtre | `divine_nova` | zone mixte | dégâts et soins de zone, une fois par entité |

Les valeurs de dégâts, soin, portée, rayon, distance, coût, niveau et cooldown restent celles de
`src/shared/skills.ts`. Toute géométrie ou chronologie supplémentaire sera centralisée dans les
données de combat directionnel au lieu d'être dispersée dans le serveur et le renderer.

## Inventaire Tiny Swords

Le catalogue contient les animations dédiées suivantes, déjà utilisables sans nouvel asset :

- Guerrier : `Warrior_Attack1.png`, `Warrior_Attack2.png`, `Warrior_Guard.png`, variantes de
  couleur bleu, rouge, jaune et violet ;
- Rôdeur : `Archer_Shoot.png` dans les quatre variantes et `Arrow.png` ;
- Prêtre : `Heal.png` et `Heal_Effect.png` dans les quatre variantes ;
- effets partagés : `Dust_01.png`, `Dust_02.png`, `Explosion_01.png`, `Explosion_02.png` ;
- magie : projectile et explosion du `Hex Shaman` ;
- monstres : feuilles `Attack` dédiées pour Spear Goblin, Torch Goblin, Gnoll, Skull, Minotaur
  et Troll, avec les découpes déjà décrites par `enemy-art.ts`.

Il n'existe pas de projectile de soin exact. Le substitut V1 retenu est une petite instance animée
de `Heal_Effect.png`, déplacée comme entité projectile et rendue dans la couleur du prêtre. Sa
palette verte/blanche la distingue immédiatement des flèches et du projectile violet offensif du
Hex Shaman. Aucune image externe, générée ou forme CSS ne sera ajoutée. Les approximations, frames,
dimensions natives, ancrages et instants d'impact seront regroupés dans `combat-art.ts`.

## Stratégie réseau et simulation

Le client enverra uniquement `{ t: "attack" }` ou `{ t: "skill", slot }`. Les anciens messages
portant une cible et le message `heal` seront rejetés. Le serveur figera la direction à partir de
l'orientation autoritaire, consommera coût et cooldown au lancement, puis créera une action avec
anticipation, instant d'impact, récupération et garde contre la double résolution.

Les frappes de mêlée reliront la position autoritaire du lanceur à l'impact, tout en conservant la
direction du lancement. Les projectiles figeront leur origine à leur apparition. Un système de
projectiles de salle les avancera avec collision balayée, grille spatiale, collision terrain,
portée et durée maximales. Les snapshots/deltas transporteront orientation et projectiles ; les
événements d'animation ne contiendront que des informations visuelles et des temps serveur.

Une mort, une déconnexion, une transition ou le déchargement d'une salle annulera les actions et
projectiles concernés. L'identité `partyId + mapId` déjà utilisée pour le Durable Object maintient
l'isolation entre deux sauvegardes jouant la même carte.

## Migration des tests

Les tests qui imposent `targetId`, le message `heal`, la sélection Tab, `TargetFrame`, la cible
Zustand, l'impact immédiat ou l'effet projectile simulé côté client seront remplacés, pas conservés
sous forme désactivée. Les nouveaux tests couvriront :

- primitives géométriques et collisions balayées ;
- protocole strict sans cible et parsing défensif des projectiles/orientations ;
- lancement dans le vide, consommation immédiate du cooldown et impact différé ;
- arcs, capsules, projectiles bloquants/perforants et soins directionnels/de zone ;
- anticipation et esquive des attaques de monstres ;
- snapshots/deltas, nettoyage à la transition et visibilité multijoueur ;
- flux réel WebSocket du Durable Object, isolation par partie, reconnexion, contributions et XP ;
- suppression du HUD, des contrôles et du store de ciblage.

## Risques principaux

Correctifs de stabilisation après validation : le client partage désormais un seul échantillon
`serverNow`/`performance.now()` entre cooldowns et animations, `action: null` clôt immédiatement le
rendu et fence les anciens événements d'animation, les soins transportent la couleur validée du
lanceur, et Radiant Bolt utilise 280 ms d'anticipation + 370 ms de récupération (650 ms au total).
Un snapshot d'action nul autorise désormais immédiatement un nouvel identifiant non annulé, tandis
que les identifiants annulés restent fenced. `skill.cast` ne réécrit plus les cooldowns du HUD :
seul le prochain `SelfState` autoritaire peut les modifier.

- divergence entre temps serveur et progression d'une feuille d'animation client ;
- projectile rapide traversant terrain ou entité si seule sa position finale est testée ;
- cooldown ou coût débité deux fois lors d'une retransmission ;
- dégâts/soins/VFX doublés entre action, projectile et événement `combat.hit` ;
- direction distante incorrecte si les deltas omettent le facing immobile ;
- action survivant à une mort, transition, reconnexion ou éviction ;
- surcharge par trop de projectiles ou scans linéaires complets ;
- perte de menace, contribution, ressource ou récompense lors du passage aux impacts différés ;
- faux positif de ligne de vue autour d'un obstacle si les centres et rayons ne sont pas cohérents.

Ces risques seront bornés par des types partagés, une chronologie unique, des identifiants d'action,
des ensembles d'entités déjà touchées, des plafonds de projectiles, des collisions balayées, des
tests de delta/résynchronisation et des nettoyages explicites au cycle de vie de la salle.

## Baseline avant travail

- Premier `npm ci` : échec Windows `EPERM` sur le binaire natif `lightningcss`, causé par un ancien
  processus local Vite/workerd encore ouvert. Les trois PID exacts ont été arrêtés ; aucune donnée
  du dépôt n'a été supprimée.
- Second `npm ci` : succès, 567 paquets ; npm signale 4 vulnérabilités modérées préexistantes.
- `npm run check` : catalogue, lint et trois typechecks verts ; 649 tests Workers verts et 4 tests
  en timeout à 5 s (`world.test.ts` : capacité/reconnexion et deux scénarios de soin ciblé ;
  `hero-world.test.ts` : isolation/fencing). La chaîne s'est arrêtée avant les tests UI.
- `npm run build` : succès ; avertissement Vite préexistant sur le chunk client de plus de 500 Kio.
- `git diff --check` : succès.
