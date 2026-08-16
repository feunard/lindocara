# S2 — la simulation rendue au client

Date : 2026-08-03
Statut : validé en brainstorming, prêt pour le plan d'implémentation

## Objectif

Deuxième chantier du [reboot HD-2D](./2026-08-02-hd2d-reboot-design.md). Il devait livrer « le nouveau
modèle de carte + collision/saut/nage dans `engine`, serveur autoritatif, prédiction ». **Il en
livre la moitié, et abandonne l'autre — délibérément.**

Le mouvement du joueur cesse d'être autoritatif côté serveur. Le client décide où il est et le dit ;
le serveur l'écrit. En échange, S2 livre ce qui bloque réellement la suite : un **format de carte**
que le serveur et l'éditeur peuvent lire, et une **couche de géométrie partagée** pour que les
monstres marchent sur le même terrain que les héros.

## La décision qui commande toutes les autres

**Ce jeu est coopératif contre des monstres. Tricher n'y fait de mal qu'à soi-même.** La consigne de
l'auteur est explicite : privilégier la performance et la simplicité, quitte à perdre en robustesse
face à un client malveillant — « limite c'est fun si des gens arrivent à tricher ».

Cette phrase supprime un pan entier d'architecture, et il faut mesurer lequel.

### Ce que la mesure a établi

Harnais de charge du 2026-08-03, serveur de dev local, scénario `mixed`, parties de quatre :

| | 8 joueurs | 16 joueurs |
| --- | --- | --- |
| Connectés | 8/8 | 16/16 |
| Messages/s | 143 | 333 |
| Bande passante | 187 Ko/s | 489 Ko/s |
| ACK moyen | 107 ms | 138 ms |
| ACK p95 | 155 ms | 224 ms |
| Erreurs, déconnexions | 0 | 0 |

Deux lectures, et la seconde est celle qui tranche.

**Le serveur est très loin d'une limite.** Doubler les joueurs coûte 29 % de latence en plus et
aucune erreur. Ce n'est donc **pas** la performance du serveur qui motive le changement.

**La latence d'ACK est structurelle, pas conjoncturelle.** Elle est dominée par la cadence de
diffusion à 10 Hz — pas par le tick de 50 ms, pas par le réseau (la mesure est en loopback, latence
nulle). Le serveur met donc **~107 ms à confirmer au joueur son propre mouvement**, et aucune montée
en puissance n'y changera rien.

C'est exactement ce que la prédiction existe pour cacher. D'où la conclusion : le choix n'est pas
entre « serveur autoritatif » et « client autoritatif ». Il est entre **« serveur + prédiction +
tick fixe + déterminisme au bit près »** et **« client, point »**. On ne peut pas garder l'autorité
serveur en jetant la prédiction : le jeu aurait 107 ms de latence d'entrée ressentie.

### Ce que ça supprime, honnêtement compté

Le chemin autoritatif pèse environ **1 950 lignes** :

| Fichier | Lignes |
| --- | --- |
| `client/game/net.ts` | 877 |
| `server/world/interest-system.ts` | 311 |
| `engine/world-delta.ts` | 242 |
| `server/world/movement-system.ts` | 152 |
| `server/world/snapshot-system.ts` | 146 |
| `engine/simulation.ts` | 105 |
| `engine/prediction.ts` | 97 |

**Mais rendre le mouvement au client n'en supprime pas 1 950.** L'aire d'intérêt, les deltas et les
snapshots — environ 700 lignes — servent **toutes** les entités : monstres, butin, gardes, corps.
Elles restent intégralement. Ce qui disparaît, c'est la prédiction et la réconciliation :
`prediction.ts` en entier et la part de `net.ts` qui rejoue les commandes en attente. **300 à 500
lignes.**

Le vrai gain n'est donc pas en lignes supprimées. Il est en **contrainte levée** : plus de pas de
temps fixe, plus de déterminisme au bit près, plus de rejeu exact. Le labo garde sa boucle à `dt`
variable telle qu'elle est aujourd'hui.

C'est décisif parce que l'inertie livrée par [l'île de neige](./2026-08-02-snow-island-design.md)
rend la réconciliation strictement plus dure : rejouer une position périmée à travers un intégrateur
exponentiel exige la **même séquence de `dt`**, sinon la trajectoire diverge en silence — sans
qu'aucun test ni aucun message ne s'en plaigne.

## Décisions de cadrage

| Sujet | Décision |
| --- | --- |
| Mouvement du joueur | **Client autoritatif.** Règle fixée ici, câblée en S3. |
| Validation | **Aucune**, hors le parseur de trames qui existe déjà. |
| Prédiction, réconciliation | **Condamnées.** Rendues inutiles ici, retirées en S3. |
| Pas de temps | **Libre.** Le labo garde son `dt` par image. |
| Coordonnées | **Unités-tuile**, avec une verticale. Remplacement, pas conversion — mais étalé, voir ci-dessous. |
| Primitive de collision | **Rectangles seuls.** Le cercle du labo disparaît. |
| Issues (dégâts, butin, XP, quêtes) | **Restent décidées par le serveur.** Inchangé. |
| Preuve | Le labo continue de tourner à l'identique. Pas de réseau dans ce chantier. |

### Remplacement, mais pas en une fois — et surtout pas une coexistence de principe

L'unité-tuile remplace le pixel : il n'y aura **pas** deux modèles de coordonnées à demeure. Mais le
remplacement ne peut pas tenir dans S2, et il faut le dire au lieu de le laisser en contradiction
avec le périmètre.

`engine`'s `simulation.ts` et `collider.ts` sont lus par le combat, les projectiles, la navigation des
monstres et l'aire d'intérêt — **tout le jeu vivant est en pixels**. Basculer ces fichiers en S2
casserait le jeu, que ce chantier ne touche pas.

Donc :

- **S2 pose le modèle en unités-tuile** dans `engine`, à côté de l'ancien, et le prouve dans le labo.
- **S3 le rend unique** : quand le renderer bascule, le monde du jeu bascule avec lui et le chemin en
  pixels est retiré.
- **Entre les deux, aucun code neuf n'est écrit contre les pixels.** L'ancien chemin est en sursis,
  pas en service.

Ce n'est pas la « coexistence assumée » qui avait été écartée en brainstorming — celle-là gardait
deux vérités du mouvement indéfiniment. Ici l'ancienne est condamnée et datée.

### Le parseur reste, et ce n'est pas de la sécurité

`parseClientMessage` continue de rejeter une trame malformée. Ce n'est pas une défense contre un
tricheur — c'est empêcher un `NaN` d'entrer dans la grille spatiale du serveur et d'emmener les
monstres à l'infini. C'est de la robustesse, ça existe déjà, ça ne coûte rien. Ne pas le confondre
avec une validation de position, qui elle est explicitement abandonnée.

### Les rectangles, et ce que le cercle emporte avec lui

Le labo collisionne en **cercles**, en unités-tuile, dans une `Map` creuse ; `engine` en
**rectangles**, en pixels, dans des seaux denses. On garde le rectangle et l'unité-tuile.

Un tronc d'arbre devient donc un carré. **Le glissement le long des obstacles n'est pas perdu** : il
vient du test axe par axe, pas de la forme, et ce test survit tel quel. Ce qui change est le ressenti
dans les angles — un tronc carré accroche là où un tronc rond fait glisser. **À revérifier en
jouant**, c'est le seul endroit où ce chantier peut dégrader une sensation acquise.

Le labo n'a jamais eu à collisionner un mur : sa maison n'enregistre aucun collider et s'entre par un
intérieur séparé. Le rectangle est ce qui rendra un bâtiment possible.

## Ce que le serveur garde, et pourquoi la géométrie reste partagée

Le serveur ne simule plus le héros. Il simule toujours **monstres, gardes et projectiles**, et
ceux-là ne doivent pas traverser les arbres. Le terrain et les colliders restent donc une vérité
partagée, sans DOM ni `three`, dans `@lindocara/engine`.

C'est la moitié de S2 qui ne disparaît pas — et c'est aussi la moitié dont S3 et S5 dépendent.

**Mais S2 ne branche pas le serveur dessus.** Les monstres du jeu tournent aujourd'hui dans le monde
en pixels ; les faire lire la nouvelle géométrie, c'est basculer le jeu, donc S3. S2 livre la couche
**prête pour le serveur** — pure, sans DOM ni `three`, en unités-tuile — et la prouve dans le labo.
Le branchement suit.

## Le travail

### 1. Extraire `stepHero`, avant tout déménagement

`apps/lab/src/world/hero.ts` fait **824 lignes** où les règles — test du disque, glissement axe par
axe, saut, gravité, coyote, nage, apnée, noyade, glace fine — sont mêlées à `THREE.Vector3`, à
l'animateur de billboard, aux lots d'éclaboussures et à des appels directs à l'audio. **Sans un seul
test.**

On en sort un pas pur `stepHero(state, input, dt, query, colliders)` et on le couvre, **pendant que
la parité au PoC est encore fraîche**. La revue finale de S1 le disait déjà : le faire après le
déménagement, c'est le faire sans filet — une régression découverte ensuite ne se distinguerait plus
d'un effet du déménagement.

Le labo continue de tourner à l'identique. C'est le critère de réussite de cette étape, et il se
vérifie en jouant.

`locomotion.ts` (151 lignes), `thin-ice.ts` (132), `terrain-query.ts` (96) et `colliders.ts` (75) sont
**déjà purs et déterministes**, écrits ainsi exprès. Leur déménagement est un déplacement de fichier ;
seul `colliders.ts` change de primitive.

### 2. Le format de carte

Relief, matières, colliders et points d'apparition, en données sérialisables. Le labo cesse de
fabriquer son île par du code procédural et la charge.

**Amorçage :** produire une carte authorée demande un éditeur, donc S5 — l'œuf et la poule. On le
casse en **sérialisant l'île générée** comme première carte. Le générateur procédural devient un
outil de production de données, plus une dépendance de l'exécution.

C'est cette étape qui débloque S3 (le renderer ne peut pas lire du code procédural) et S5 (l'éditeur
non plus).

### 3. La couche de requêtes dans `engine`

Terrain et colliders remontent, en unités-tuile, **prêts** pour que le serveur y fasse marcher ses
monstres — le branchement effectif appartenant à S3, avec le reste du basculement.

**Le peuplement des colliders vit aujourd'hui dans le code de rendu** (`props.ts`, `chest.ts`,
`npc-base.ts` appellent `colliders.add`). Un serveur n'a pas de `props.ts` : les colliders doivent
devenir de la donnée, produite par l'étape 2.

**Convention :** ces fichiers portent des commentaires en français et arrivent dans `engine`, dont la
convention est l'anglais. À trancher au moment du déménagement, pas avant.

### 4. Le protocole — décidé ici, câblé en S3

Le message de mouvement passera d'**intention** à **position**, et le serveur cessera d'appliquer une
commande par tick et d'échoer un `ack`.

**Rien de cela ne part sur le fil dans S2.** Le labo est solo : il n'a pas de protocole. Changer
celui du jeu maintenant le casserait sans rien prouver. Le basculement accompagne le reste, en S3.

Ce que S2 fixe, c'est la **règle** — parce que tout le reste du chantier en découle :

> Le serveur décide des **issues**. Le client décide de **sa propre position**.

**La règle d'ouverture du `AGENTS.md` racine dit aujourd'hui le contraire** : « les clients envoient
une intention de déplacement, jamais des positions ». Elle sera amendée **quand S3 la rendra fausse**,
pas avant — un document qui décrit une règle que le code n'applique pas encore ment tout autant qu'un
document périmé.

## Risques

- **Le ressenti dans les angles.** Passer du cercle au rectangle est le seul endroit où ce chantier
  peut dégrader quelque chose d'acquis. Se vérifie en jouant, pas en testant.
- **`hero.ts` n'a aucun test aujourd'hui.** L'extraction est donc à parité *présumée* jusqu'à ce que
  les tests existent. C'est précisément pourquoi elle passe en premier — et pourquoi les deux bugs
  trouvés en jouant à l'île de neige (l'entrée dans l'eau annulée une image plus tard, la case déjà
  rompue qui ne déclenchait rien) doivent servir de mise en garde : ce fichier cache des défauts que
  la lecture ne trouve pas.
- **Deux joueurs peuvent diverger** sur la position d'un troisième. C'était déjà vrai — les joueurs
  distants sont interpolés 150 ms dans le passé. Le changement ne l'aggrave pas.
- **Un client bugué peut envoyer une position absurde** et emmener les monstres avec lui. Assumé. Le
  parseur écarte le seul cas qui casse le serveur lui-même.

## Une divergence assumée avec le spec du reboot

Le tableau des chantiers du [spec du reboot](./2026-08-02-hd2d-reboot-design.md) annonçait le jeu
**éteint** pendant S2 — conséquence de l'idée qu'on y basculerait `engine` d'un bloc.

**Ce n'est plus nécessaire.** En posant le modèle en unités-tuile à côté de l'ancien et en laissant
le protocole tranquille, S2 ne casse rien : le jeu continue de tourner sur PixiJS et sur son monde en
pixels pendant tout le chantier. L'extinction est reportée à S3, où elle est de toute façon inévitable
puisque le renderer y est réécrit.

Le spec du reboot devra être amendé sur cette ligne.

## Hors périmètre

- **Aucun câblage réseau.** Le labo reste solo ; brancher une salle réelle appartient à S3.
- Le renderer du jeu n'est pas touché : il tourne encore sur PixiJS jusqu'à S3.
- L'éditeur n'est pas touché : S5.
- La suppression effective de `prediction.ts` et de la moitié prédictive de `net.ts` suit le
  basculement du jeu, donc S3. S2 les rend inutiles, il ne les retire pas.
