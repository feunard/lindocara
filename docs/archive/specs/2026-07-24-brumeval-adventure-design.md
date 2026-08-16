# Brumeval — une aventure d'introduction authorée

Une petite histoire RPG complète, façon zone de départ humaine de World of Warcraft (Northshire) :
trois cartes, des PNJ, des monstres, six quêtes chaînées, un boss et une victoire. **Zéro nouveau
code moteur** : l'aventure est du pur contenu authoré, créé par un script de seed qui parle à la
même API `/api/*` que l'éditeur (le modèle est `scripts/loadtest.mjs`). Le script est rejouable en
local et contre `https://lindocara.alepha.dev/`.

## Pourquoi un script de seed et pas l'éditeur à la main

- Reproductible : la même aventure se recrée en local (dev, tests) et en prod en une commande.
- Vérifiable : la validation serveur (`validateMapInput`, `validateAdventure`,
  `validateAuthoredQuests`) juge le contenu exactement comme si l'éditeur l'avait sauvé.
- Le contenu vit dans le dépôt (`scripts/seed-brumeval.ts`), donc versionné et relisible.

Le script utilise les brosses pures de `@lindocara/engine` (`paintRectAutotile`, `paintElevation`,
`paintStairs`, `resolveWholeLayer`, `encodeTileLayer`) — elles tournent en Node — puis `PUT` les
cartes complètes (layers RLE + éléments + events) et l'aventure (graphe + registre + quêtes).

## L'histoire

L'abbaye de Brumeval veille sur une vallée paisible. Des gobelins pillent les vignes, la route du
sud est coupée, et un seigneur de guerre — **Malgrin**, un brute minotaure — a installé sa meute
dans l'antre au fond de la forêt. Le héros débarque à l'abbaye, fait ses preuves dans les vignes,
sécurise la route, repère le camp gnoll et finit par abattre Malgrin. La vallée respire : victoire.

## Les trois cartes

| # | Carte | Taille | Contenu |
| --- | --- | --- | --- |
| 1 | **L'abbaye de Brumeval** | 28×20 | Monastère + maisons (éléments), spawn de départ, 2 PNJ, vignes à l'est avec 5 `spear_goblin` (patrouille courte), sortie sud → carte 2 |
| 2 | **La forêt de Ronceclair** | 40×25 | Forêt dense, camp gobelin (4 `torch_goblin`, 3 `spear_goblin`), 3 caches de ravitaillement (coffres à potion, one-shot par self-switch A), zone « camp des gnolls » (event `player-touch` + `enterArea`) gardée par 3 `gnoll_marauder`, entrée nord ← carte 1, retour nord, sortie est → carte 3 |
| 3 | **L'antre de Malgrin** | 24×16 | Arène cernée de falaises (élévation), 2 `skull_guard`, le boss **Malgrin** (`minotaur_brute`, event monstre nommé), l'Éclaireuse Lise (PNJ blessée), sortie « fin » qui n'ouvre la victoire qu'après le boss |

Terrain : herbe (slot 0), eau = vide, élévation 1/2 avec falaises auto-entretenues et rampes
(`paintStairs`), arbres/buissons/rochers du catalogue curé. Le spawn et chaque entrée restent sur
sol marchable, hors décor — la validation serveur le prouve.

## Les PNJ

Un PNJ est un event `normal` avec un sprite moine (`character.units-<couleur>-units-monk.idle`) et
un programme `say`/`choices`. Thématiquement parfait pour une abbaye ; les couleurs distinguent les
rôles.

| PNJ | Carte | Sprite | Rôle |
| --- | --- | --- | --- |
| **Frère Anselme** | 1 (parvis) | monk bleu | Accueil, donneur Q1→Q2, rend Q2 |
| **Maréchal Aldric** | 1 (porte sud) | monk rouge | Rend Q3, donne Q4, briefe sur la route |
| **Éclaireuse Lise** | 3 (entrée de l'antre) | monk violet | Lore de l'antre ; sa page 2 (switch `0001` = Malgrin vaincu) félicite et propose `endAdventure` en dialogue de choix |

Chaque PNJ a une page de base et au moins une page conditionnelle (switch ou avancement) pour que
le monde réagisse à la progression — la règle XP « la page la plus haute qui tient gagne ».

## Les six quêtes (registre de l'aventure, schéma v2)

Chaîne principale via `nextQuestId`, acceptation automatique pour la première, puis donneurs.
Toutes personnelles sauf le boss (partagée « party ») pour le coop.

| Id | Titre | Objectifs | Récompenses | Suite |
| --- | --- | --- | --- | --- |
| 0001 | **L'appel de Brumeval** | parler à Frère Anselme (`interact`/talk) | XP | → 0002 (auto-acceptée à l'entrée) |
| 0002 | **Des gobelins dans les vignes** | tuer 5 `spear_goblin` (carte 1) | XP, or, 2 `health_potion` | → 0003 ; rendu chez Anselme |
| 0003 | **Rapport au maréchal** | parler au Maréchal Aldric | XP | → 0004 ; rendu chez Aldric |
| 0004 | **La route de Ronceclair** | tuer 4 `torch_goblin` **et** collecter 3 `health_potion` (les fioles volées, via caches ou butin) — simultanés | XP, or | → 0005 ; rendu chez Aldric |
| 0005 | **Repérage du camp gnoll** | atteindre la zone `camp-gnoll` (`reach`/area) **et** tuer 3 `gnoll_marauder` | XP, or | → 0006 |
| 0006 | **Le seigneur de la meute** | `defeat-target` : l'event monstre Malgrin (scope party, crédit `nearby-party`) | XP, or, potions | fin ; rendu chez Lise |

Dialogues de quête : les huit slots (offer/accepted/refused/active/ready/turn-in/completed/
unavailable) sont remplis pour les quêtes à donneur — prose française courte, ≤200 caractères par
réplique. `validateAuthoredQuests` doit rendre zéro erreur avant tout PUT final.

## Le fil d'état

- Switch `0001` « Malgrin vaincu » : posé par le programme on-defeat de l'event monstre du boss.
  Il fait basculer la page de Lise **et** la page du portail de fin.
- Self-switch `A` sur chaque cache : le coffre donné une fois se tait (page 2 vide, condition A).
- La sortie « fin » de la carte 3 est un event `exit` lié à `dest:"end"` dans le graphe ; le
  joueur qui la prend après la victoire déclenche l'écran de victoire de la partie. Lise propose
  aussi `endAdventure` en dialogue une fois `0001` levé — deux chemins vers la même fin, l'un
  spatial, l'autre narratif.

## Le graphe

```
carte 1 (spawn event = départ)
  exit sud  → entry nord carte 2
carte 2
  exit nord → entry sud carte 1   (retour)
  exit est  → entry ouest carte 3
carte 3
  exit ouest → entry est carte 2  (retour)
  exit fin   → "end"
```

## Ordre de seed (contrainte de validation apprise de la tranche 5)

`handleUpdateMap` revalide tout le graphe : une sortie non liée fait échouer la sauvegarde. Donc :

1. `POST /api/adventures` (crée l'aventure + carte 1), `POST /api/maps` ×2 (cartes 2, 3).
2. `PUT` chaque carte avec terrain/éléments/events **sans** events `exit` (entries, spawn, PNJ,
   monstres, caches, zone).
3. Re-`PUT` chaque carte en ajoutant ses exits, avec le champ `adventure.graph` cumulatif dans le
   même corps (le seam transactionnel que le loadtest utilise déjà).
4. `PUT /api/adventures/:id` final : titre, `maxPlayers: 4`, registre (switch 0001 nommé, quêtes
   0001–0006).

## Tests

- **Unitaires/serveur** : rien de nouveau à couvrir côté moteur (aucun code moteur ne change). Le
  script de seed s'auto-vérifie : après chaque PUT il relit la ressource et échoue bruyamment sur
  toute divergence ou diagnostic de quête non vide.
- **Bout en bout (playwright-cli, dev local)** : créer un compte, une partie sur Brumeval, un
  héros, puis dérouler réellement l'histoire — dialogues d'Anselme, kills comptés au journal,
  collecte des fioles, `enterArea`, boss, switch, pages conditionnelles, victoire. Zéro erreur
  console.
- **Prod** : seed avec un compte dédié (`brumeval-author`), puis un run de vérification rapide.

## Risques et parades

- **Espèces trop dures pour un niveau 1** (équilibrage `MONSTER_SPECIES_KIND`) : si les
  `spear_goblin` déciment un héros nu, réduire leur nombre/densité plutôt que toucher aux tables
  de balance. À juger en jeu pendant le test E2E.
- **Le rythme des caches** : si le butin des monstres donne déjà des potions, la collecte de Q4
  peut se finir trop vite — acceptable pour une intro.
- **Rate limit auth en prod** (8/60s) : le seed n'utilise qu'un compte, pas de risque.
- **La carte 3 « fin » avant le boss** : un event `exit` est fonctionnel (une page, pas de
  commandes, pas de condition fiable), donc la sortie de fin ne peut pas être verrouillée par
  l'état. La parade est spatiale : elle est placée derrière l'arène de Malgrin, qu'il faut
  traverser. Un groupe qui la force en courant a « fini » son intro — acceptable, WoW non plus ne
  verrouille pas la sortie de Northshire.
