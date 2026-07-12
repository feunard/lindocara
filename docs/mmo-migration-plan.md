# Audit technique et plan de migration MMO multizone

Date de l'audit : 12 juillet 2026  
Portée : branche active du dépôt LindoCara.  
Statut : document de préparation ; aucun routage, protocole ou comportement de jeu n'est modifié.

## Statut d'implémentation après sécurisation de la présence

Les étapes de persistance et d'autorité de présence ont été réalisées sans activer le multizone :

- `character` porte désormais `zone_id`, `instance_id`, `session_epoch` et
  `ward_run_expires_at` via la migration additive `0006_cultured_captain_midlands.sql` ;
- `CharacterPresence`, adressé par `characterId`, détient un bail de 30 secondes renouvelé toutes
  les 10 secondes par la room ;
- D1 reste l'unique source monotone de l'epoch : chaque acquisition incrémente atomiquement
  `character.session_epoch` ;
- le DO de présence conserve seulement le propriétaire actif, son `connectionId` non devinable,
  l'epoch, la room, la zone, l'instance et les échéances du bail ;
- une reprise gèle et sauvegarde l'ancien runtime avant l'incrément quand celui-ci répond, puis
  l'incrément D1 interdit dans tous les cas ses écritures tardives ;
- toutes les sauvegardes utilisent `WHERE character.id = ? AND session_epoch = ?`. Un rejet ferme
  la socket obsolète et produit le log structuré `stale_character_save_rejected` ;
- l'échéance `ward_run` est absolue, persistée dans D1 et dans l'attachment WebSocket ; elle ne
  redémarre pas à la reconnexion ;
- le routeur reste volontairement `WORLD.getByName("world")`.

## Statut d'implémentation du routage multizone

Le catalogue partagé `src/shared/zones.ts` est actif. Il contient `verdant-reach` et la petite
zone technique `mmo-test-zone`, valide les identifiants d'instance, et construit une clé non
ambiguë `zoneId:instanceId`. Le Worker lit exclusivement la localisation D1 du personnage avant
d'acquérir sa présence et d'appeler `WORLD.getByName(roomKey)`.

`World` valide la localisation interne, utilise les dimensions, le terrain, les spawns, les
monstres, les quêtes et les sites de la zone courante, et applique sa capacité. Les rooms isolent
leur état mutable. Verdant Reach reste identique ; la zone technique est sans contenu de gameplay
et couvre les tests. Les portails, le handoff jouable et l'instanciation automatique restent hors
de cette étape.

Le futur handoff interzone doit conserver cet ordre : geler la source, sauvegarder avec l'epoch
source, acquérir un nouvel epoch pour la destination, revérifier l'autorité après admission, puis
seulement activer le joueur dans la destination.

## 1. Résumé exécutif

LindoCara est aujourd'hui un vertical slice MMO correctement autoritaire, mais son unité de
coordination est une instance unique de `World`. Le Worker authentifie le compte, vérifie que le
personnage lui appartient, puis route toutes les connexions vers le même Durable Object nommé
`world`. Ce choix simplifie fortement la cohérence du combat, des monstres, des quêtes, du butin et
du chat, mais rend impossible une montée en charge par zones sans introduire au préalable une
identité de zone persistante et une autorité globale par personnage.

La priorité n'est donc pas de découper `world.ts`. La priorité est de rendre l'emplacement d'un
personnage explicite, de garantir qu'un seul bail de session peut être actif pour ce personnage,
et de tester les courses de connexion et de sauvegarde. Ensuite seulement, le routeur pourra
choisir une room déterministe.

Constats majeurs :

- la simulation joueur et la validation des actions sont autoritaires côté serveur ;
- le tick et la diffusion des snapshots sont tous deux à 20 Hz ;
- les joueurs distants et les monstres sont interpolés avec un retard de 150 ms ;
- la position locale est prédite à partir des mêmes fonctions pures que le serveur ;
- D1 est la persistance longue durée, avec sauvegarde des profils sales toutes les cinq secondes
  et à la déconnexion ;
- les WebSockets hibernables conservent une pièce jointe sérialisée environ chaque seconde quand
  le profil est sale ;
- la reconnexion automatique côté navigateur n'existe pas ; une fermeture met fin à la session de
  jeu jusqu'à une action utilisateur ou un rechargement ;
- l'exclusion des connexions concurrentes est désormais portée par un DO déterministe par
  personnage et protège aussi les futurs noms de room ;
- `world.ts` concentre 1 452 lignes et toutes les responsabilités de room, mais un déplacement
  massif immédiat augmenterait le risque sans résoudre le problème d'autorité inter-room.

## 2. État actuel de l'architecture

### 2.1 Frontière HTTP et authentification

`wrangler.jsonc` envoie uniquement `/api/*` au Worker grâce à `assets.run_worker_first`, tandis que
les autres chemins sont servis comme SPA. `src/server/index.ts` gère l'inscription, la connexion,
la session, le roster et l'upgrade WebSocket.

Une session est un cookie `HttpOnly`, `SameSite=Lax`, signé par HMAC-SHA-256 et valable sept jours.
Le cookie représente le compte. Pour rejoindre le monde, le navigateur fournit un identifiant de
personnage dans `/api/ws?character=<uuid>`. Le Worker :

1. exige un upgrade WebSocket ;
2. vérifie la signature et l'expiration du cookie ;
3. vérifie dans D1 que le personnage appartient au compte ;
4. retire les en-têtes entrants et transmet seulement `Upgrade` et `x-character-id` au DO ;
5. choisit inconditionnellement `WORLD.idFromName("world")`.

Le Durable Object ne reçoit ni mot de passe ni identité de compte. Il fait confiance au
`x-character-id` interne posé après le contrôle d'appartenance.

### 2.2 Diagramme textuel des flux

```text
Navigateur
  | POST /api/register ou /api/session
  v
Worker index.ts -- Drizzle --> D1 account
  | Set-Cookie HMAC
  v
Navigateur
  | GET /api/characters
  | WebSocket /api/ws?character=<id> + cookie
  v
Worker index.ts
  | vérifie cookie
  | vérifie character.account_id dans D1
  | WORLD.idFromName("world")
  | x-character-id interne
  v
Durable Object World unique
  | remplace une socket existante du même personnage dans CET objet
  | charge character depuis D1
  | accepte la socket hibernable
  | envoie welcome + WorldInfo + snapshots + SelfState
  v
Boucle 20 Hz
  | 1 commande de mouvement maximum par joueur et par tick
  | simulation joueurs -> IA monstres -> butin -> snapshot
  | attachment DO ~1 s si dirty
  | sauvegarde D1 ~5 s si dirty
  v
Tous les clients de la room
  | local : prédiction + replay des commandes non acquittées
  | distants : interpolation à now - 150 ms
  v
PixiJS (monde) + Zustand (pont) + React (HUD)
```

### 2.3 Simulation, ticks et snapshots

`src/shared/simulation.ts` fixe `TICK_HZ = 20`, `TICK_MS = 50 ms` et `TICK_DT = 0,05 s`.
`World.#startLoop()` utilise un `setInterval` à `TICK_MS`. La boucle s'arrête lorsque la room est
vide et redémarre à la première connexion.

À chaque tick, `World.#advance()` :

1. traite les résurrections ;
2. retire au maximum une commande de la file de chaque joueur ;
3. répète brièvement la dernière intention en cas de paquet manquant, puis arrête le joueur après
   cinq ticks affamés ;
4. applique `step()` puis `resolveTerrain()` ;
5. collecte le butin ;
6. sérialise éventuellement l'attachment et planifie les sauvegardes D1 ;
7. avance tous les monstres et résout leurs attaques ;
8. supprime le butin expiré ;
9. diffuse un snapshot complet des joueurs, monstres et objets au sol.

Il n'existe pas de fréquence de snapshot distincte : un snapshot complet est diffusé à chaque
tick, donc à 20 Hz. Le champ `tick` est local à l'instance `World` et repart de zéro après une
reconstruction du DO ; ce n'est pas une horloge globale ni un identifiant persistant.

### 2.4 Prédiction, réconciliation et interpolation

Le client accumule le temps de frame et émet une commande séquencée pour chaque `TICK_DT`. Il
applique immédiatement `predictStep()`, qui réutilise `step()` et `resolveTerrain()` de
`src/shared/`. Le serveur applique exactement une commande par tick et renvoie le plus grand
numéro appliqué dans `ack`.

À réception d'un snapshot, le client :

- retire les commandes `seq <= ack` ;
- repart de la position autoritaire ;
- rejoue les commandes encore en vol ;
- abandonne la prédiction au-delà de 40 commandes en attente ;
- lisse pendant 100 ms une petite erreur et applique immédiatement une correction supérieure à
  96 pixels.

Le joueur local est dessiné au présent. Les autres joueurs et les monstres sont interpolés entre
deux snapshots reçus, à `performance.now() - 150 ms`. Le butin n'est pas interpolé. Si le buffer
ne contient pas deux snapshots encadrant cet instant, le client utilise le snapshot le plus
récent ; il n'extrapole pas.

### 2.5 Persistance D1 et reprise d'un Durable Object

Le schéma D1 possède deux tables métier : `account` et `character`. Le personnage porte la
position, les statistiques, l'apparence, la classe, l'équipement, l'inventaire et l'état de quête.
`profile.ts` est la frontière unique de chargement et de sauvegarde du profil complet.

Un profil modifié est marqué `dirty`. La room :

- sérialise un attachment WebSocket toutes les 20 itérations, soit environ une seconde, si le
  profil est sale ;
- sauvegarde D1 toutes les 100 itérations, soit environ cinq secondes, si le profil est sale ;
- sérialise immédiatement un attachment lors de l'acceptation initiale ;
- sauvegarde via `ctx.waitUntil()` lors d'une fermeture ou d'une erreur de socket ;
- sérialise les sauvegardes D1 par personnage dans `#profileSaves` pour éviter le réordonnancement
  des écritures au sein de cette instance.

À la reconstruction d'une instance, le constructeur réhydrate ses joueurs à partir des
attachments de `ctx.getWebSockets()` et redémarre la boucle si nécessaire. Les monstres, le butin,
les délais de réapparition des sites et le compteur de ticks sont recréés en mémoire ; ils ne sont
pas persistés.

### 2.6 Reconnexion et double connexion actuelles

Le navigateur n'a ni backoff ni reprise automatique. `WorldClient` signale la fermeture,
`session.ts` arrête les entrées et l'ambiance, vide le handle de jeu et affiche un état déconnecté.
Le cookie reste valide, donc un rechargement peut refaire le parcours d'authentification et
rejoindre le personnage.

`CharacterPresence` sérialise désormais les acquisitions pour un personnage, demande à l'ancienne
room de le figer et de le sauvegarder, incrémente atomiquement son epoch D1, puis installe le
nouveau bail. L'ancienne socket reçoit `presence.replaced` et le code 4001. Une room qui ne répond
pas reste malgré tout neutralisée par l'écriture conditionnelle sur `session_epoch`.

### 2.7 Responsabilités et couplages de `world.ts`

`World` possède actuellement : admission et remplacement de socket, parsing/rate limiting,
files d'entrée, simulation joueur, combat de base, compétences, soins, IA et combat des monstres,
respawn, quêtes, sites de récolte, minuterie, génération et collecte du butin, progression/XP,
état privé, snapshots, chat, sauvegarde, attachments et cycle de vie de la boucle.

Les dépendances les plus fortes sont :

```text
entrée combat
  -> recherche de cible + visibilité + cooldown
  -> dégâts monstre
  -> mort monstre
     -> XP / niveau du joueur
     -> progression de quête de type kill
     -> création du butin de room
     -> dirty + state/event/snapshot

entrée interaction
  -> proximité NPC/site + état de quête
  -> progression / minuterie / récompense
  -> inventaire + dirty + state/event

tick monstre
  -> sélection du joueur vivant le plus proche hors zone sûre
  -> mouvement/collision
  -> dégâts joueur
  -> mort/respawn joueur + dirty

sauvegarde
  <- toutes les mutations persistantes précédentes
```

Ce graphe impose que le combat, l'IA, le butin au sol et la quête locale restent dans la même
autorité de zone. En revanche, `profile.ts`, les règles pures de `shared/`, le protocole actuel et
le client réseau n'ont pas besoin d'être réécrits pour préparer le premier découpage.

## 3. Ce qui peut être conservé

- l'autorité serveur et le principe « intent, jamais outcome » ;
- `simulation.ts`, `prediction.ts` et les règles pures de collision/progression ;
- l'invariant une commande par tick et l'acquittement par séquence ;
- la séparation PixiJS / Zustand / React ;
- les sessions de compte et le contrôle d'appartenance du personnage ;
- D1 + Drizzle comme persistance durable du profil ;
- les WebSockets hibernables et leurs attachments ;
- le cycle de vie qui arrête une room vide ;
- les codes d'événements localisés côté client ;
- la majorité des tests unitaires de simulation, prédiction, protocole et gameplay ;
- le contenu de `World` comme autorité d'une room pendant les premières étapes.

## 4. Ce qui devra évoluer

- remplacer la constante globale `WORLD_NAME` par une résolution déterministe
  `character -> zone -> room`, seulement après les garde-fous d'unicité ;
- ajouter une identité de zone persistante au profil ;
- distinguer coordonnées locales de zone et identité de zone ;
- introduire une autorité de présence par personnage, indépendante des rooms, avec un epoch de
  connexion monotone ;
- empêcher toute sauvegarde provenant d'un epoch obsolète ;
- définir un handoff atomique entre source et destination ;
- transmettre la configuration de la zone au `World` sans dépendre d'un état global mutable ;
- rendre les identifiants de monstres, butins et ticks uniques au moins dans le namespace de la
  room ;
- décider si une zone est une room unique ou plusieurs instances/canaux, puis rendre ce choix
  stable et observable ;
- ajouter métriques structurées : zone, room, nombre de joueurs, epoch, cause de fermeture,
  durée de sauvegarde et refus de sauvegarde obsolète ;
- plus tard, extraire de `world.ts` des services purs par agrégat, par petites étapes couvertes par
  des tests, sans déplacer la boucle ni l'état de room d'un seul coup.

## 5. Risques de la migration

### Critiques

1. **Duplication inter-room — garde-fou installé.** `CharacterPresence` arbitre désormais les
   acquisitions en dehors de `World`, mais l'activation multizone reste interdite avant les tests
   complets de handoff.
2. **Écrasement tardif D1 — garde-fou installé.** Le `session_epoch` conditionne les sauvegardes ;
   il faut conserver ce fencing dans toutes les futures écritures de personnage.
3. **Handoff partiel.** Une coupure entre le retrait de la source et l'admission de la destination
   peut perdre le joueur ; l'ordre inverse peut le dupliquer.
4. **Coordonnées historiques — migrées.** Les lignes existantes reçoivent `verdant-reach/main`
   sans modifier `x/y`.
5. **Récompense pendant un transfert.** Un monstre, un loot ou une quête peut muter le profil au
   moment où celui-ci est figé pour changer de zone.

### Élevés

- collision d'identifiants si les entités restent nommées uniquement par un index local ;
- confusion entre hibernation d'une room et déconnexion réelle du personnage ;
- double émission de `onClose` côté client, car `error` et `close` appellent actuellement le même
  handler sans garde ;
- surcharge réseau : chaque room diffuse encore un snapshot complet à 20 Hz à tous ses membres ;
- absence de reconnexion automatique et de reprise explicite du dernier epoch ;
- les autres états purement locaux de room (monstres, butin, cooldowns de sites) restent perdus
  lors d'une reconstruction ; la minuterie `ward_run` est maintenant une échéance persistée.

### Migration des personnages existants

- une valeur par défaut incorrecte pour `zone_id` rendrait les coordonnées historiques invalides ;
- `x/y` doivent rester inchangés pour la zone legacy afin d'éviter une téléportation massive ;
- les nouvelles colonnes doivent être additives, non nulles avec une valeur par défaut compatible,
  puis lues en mode tolérant pendant un déploiement ;
- aucune suppression ou renommage de colonne ne doit accompagner la première activation ;
- les écritures de l'ancienne version et de la nouvelle doivent rester compatibles pendant un
  rollback Worker.

## 6. Ordre exact de migration recommandé

### Étape 0 — Verrouiller le comportement actuel

Travail : ajouter les tests manquants et des journaux structurés sans modifier le routage.

Fichiers : `test/world.test.ts`, `test/worker.test.ts`, `test/db.test.ts`, éventuellement
`src/server/world.ts` pour l'observabilité uniquement, `wrangler.jsonc` pour le taux
d'échantillonnage si décidé.

Critères d'acceptation :

- deux connexions simultanées du même personnage dans la room unique produisent une seule socket
  active et la nouvelle reprend exactement l'état sauvegardé ;
- une sauvegarde lente suivie d'une seconde mutation ne peut pas réordonner les états ;
- fermeture normale, erreur WebSocket et suppression de personnage sauvegardent/kickent comme
  attendu ;
- le débit de snapshots observé reste de 20 Hz à tolérance de scheduler près ;
- toute la suite actuelle reste verte.

Retour arrière : retrait des tests/mesures seulement ; aucun changement de données.

### Étape 1 — Introduire un catalogue de zones sans router différemment

Travail : créer des identifiants stables et une configuration pure de zone. Le catalogue ne
contient initialement que `verdant-reach`; le routeur résout encore toujours le DO `world`.

Fichiers prévus :

- nouveau `src/shared/zones.ts` pour `ZoneId`, limites et spawn de repli ;
- nouveau `src/server/world-router.ts` pour une fonction pure de résolution ;
- `src/server/index.ts` pour appeler cette fonction sans changer le nom effectivement choisi ;
- tests unitaires du catalogue et du routeur.

Critères d'acceptation : même URL, même protocole, même DO nommé `world`, mêmes positions et aucun
changement visible de gameplay.

Retour arrière : rétablir l'appel direct actuel ; aucune donnée n'a changé.

### Étape 2 — Rendre la zone persistante, en lecture compatible — réalisée

Migration D1 prévue, additive :

```sql
ALTER TABLE character ADD zone_id text NOT NULL DEFAULT 'verdant-reach';
ALTER TABLE character ADD instance_id text NOT NULL DEFAULT 'main';
ALTER TABLE character ADD session_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE character ADD ward_run_expires_at integer;
```

`zone_id` donne un sens à `x/y`. `session_epoch` permet de rejeter les sauvegardes d'une room
obsolète. Aucun champ de présence temporaire n'est ajouté à D1 : cette coordination appartient à
un Durable Object, pas à une table métier supplémentaire.

Fichiers prévus : `src/server/db/schema.ts`, nouvelle migration numérotée et snapshot Drizzle,
`src/server/profile.ts`, `src/server/characters.ts`, `test/db.test.ts`.

Déploiement sûr :

1. appliquer la migration avec les valeurs par défaut ;
2. déployer une version qui lit/écrit les colonnes mais continue à utiliser la room unique ;
3. vérifier que 100 % des personnages existants ont `verdant-reach` et conservent leurs `x/y` ;
4. garder les colonnes lors de tout rollback.

Critères d'acceptation : les anciens personnages réapparaissent exactement au même endroit ; les
nouveaux ont la zone legacy ; aucune requête ne dépend encore d'une deuxième zone.

Retour arrière : redéployer l'ancien Worker. Les colonnes additives restent en base et sont
ignorées ; ne pas tenter de les supprimer en urgence.

### Étape 3 — Créer l'autorité de présence par personnage — réalisée

Travail : ajouter un Durable Object déterministe `CharacterPresence`, nommé par `characterId`.
Il attribue un epoch monotone, mémorise la room active, coordonne le kick de l'ancienne room et
refuse les admissions obsolètes. Le Worker reste encore routé vers la room `world`.

Fichiers prévus : nouveau `src/server/character-presence.ts`, `src/server/index.ts`,
`src/server/world.ts` pour admission/kick interne, `wrangler.jsonc`, types Worker générés et tests
workerd. Une migration Durable Objects Wrangler ajoute la nouvelle classe SQLite ; aucune nouvelle
table D1 métier.

Règle de sauvegarde : chaque joueur en mémoire porte son epoch. `saveProfile` met à jour la ligne
uniquement si l'epoch correspond à `character.session_epoch`. Une sauvegarde obsolète doit être un
échec explicite et observable, jamais un succès silencieux.

Critères d'acceptation : une course de deux admissions produit exactement un gagnant ; l'ancienne
room est figée/kickée ; une sauvegarde de l'ancien epoch ne modifie aucun champ ; une reprise après
hibernation conserve l'epoch.

Retour arrière : feature flag serveur ramenant l'admission au chemin historique tant que plusieurs
rooms ne sont pas activées. Conserver `session_epoch` et le DO de présence déployé.

### Étape 4 — Préparer un `World` paramétré par zone

Travail : faire dériver carte, monstres, NPC et quêtes d'une configuration immuable sélectionnée
par le nom du DO. Toujours une seule zone active en production.

Fichiers prévus : `src/shared/game.ts`, `src/shared/zones.ts`, `src/server/world.ts`, fichiers de
layout du client, renderer et tests. Le protocole ne change pas encore : `WorldInfo` transporte déjà
les dimensions, obstacles, NPC et sites nécessaires à une partie du rendu.

Critères d'acceptation : `verdant-reach` est byte-compatible ou fonctionnellement identique aux
snapshots actuels ; aucune constante de carte incorrecte n'est partagée entre zones ; la prédiction
utilise la collision de la zone courante.

Retour arrière : catalogue à une entrée et configuration legacy.

### Étape 5 — Activer deux rooms sans transition de zone

Travail : autoriser un routage déterministe contrôlé par feature flag pour des comptes de test,
mais sans portail ni changement de zone en jeu. Le personnage rejoint la room indiquée par son
`zone_id` persistant.

Fichiers prévus : `src/server/world-router.ts`, `src/server/index.ts`, tests Worker/DO et
observabilité. Le nom recommandé est versionné, par exemple `zone:<zoneId>:room:0`, jamais dérivé
d'une chaîne fournie directement par le client.

Critères d'acceptation : deux zones isolent joueurs, chat, monstres et butin ; le même personnage
ne peut pas être actif dans les deux ; un redémarrage rejoint la zone persistée ; la zone inconnue
revient vers un spawn sûr documenté.

Retour arrière : désactiver le flag et router toutes les admissions vers `world`. La zone persistée
est conservée mais ignorée temporairement.

### Étape 6 — Concevoir et tester le handoff interzone

Travail : introduire un état de transfert côté serveur : `active -> frozen -> persisted -> claimed
-> active`. La source cesse d'accepter les actions avant la sauvegarde. `CharacterPresence`
attribue le nouvel epoch et la destination charge uniquement cet état. Une expiration ramène le
personnage dans une zone sûre.

Cette étape nécessitera probablement une évolution minimale et versionnée du protocole pour
indiquer au client de reconnecter sa WebSocket. Elle est volontairement postérieure aux étapes
compatibles avec le protocole actuel.

Critères d'acceptation : aucun tick ne simule le personnage dans deux rooms ; aucune action n'est
acceptée après le gel ; perte réseau à chaque point du transfert aboutit soit à la source, soit à la
destination, jamais aux deux ; inventaire, XP, HP, quête et position ne régressent pas.

Retour arrière : désactiver les portails/transferts et conserver les joueurs dans leur zone
persistée actuelle.

### Étape 7 — Extraire progressivement `world.ts`

Après stabilisation multizone seulement, extraire des fonctions/services purs dans cet ordre :

1. construction et snapshots des entités de room ;
2. file d'entrée et mouvement ;
3. IA des monstres ;
4. résolution combat/soins/compétences ;
5. quêtes et butin ;
6. persistance/admission.

Chaque extraction conserve `World` comme orchestrateur et doit être un refactoring sans changement
de protocole ou gameplay.

## 7. Tests manquants avant modification d'architecture

- course réelle de deux upgrades WebSocket simultanés pour le même personnage ;
- tentative de connexion du même personnage à deux noms de DO ;
- sauvegarde obsolète rejetée par epoch ;
- ordre des sauvegardes quand une écriture D1 est lente ou échoue ;
- admission pendant une sauvegarde de déconnexion ;
- erreur D1 pendant `loadProfile` et pendant `saveProfile` ;
- reconnexion après hibernation avec queue, `ack`, `lastSeq` et attachment ;
- reprise après fermeture anormale sans `webSocketClose` utile ;
- unicité et isolation des joueurs, chat, monstres et loot entre deux rooms ;
- conservation exacte de tous les champs lors d'un aller-retour de zone ;
- transfert interrompu avant gel, après gel, après sauvegarde et après claim ;
- rollback Worker avec le schéma D1 enrichi ;
- migration d'une ligne personnage créée par chaque ancienne migration pertinente ;
- zone inconnue/corrompue et coordonnées hors limites ;
- comportement du client sur coupure puis reconnexion, aujourd'hui non couvert par les tests UI ;
- test de `WorldClient.sample()` sur jitter, absence de paire de snapshots et reset du tick ;
- budget de taille/fréquence des snapshots avec plusieurs populations de room.

## 8. Stratégie de tests future

### Tests purs

- catalogue et résolution déterministe des zones ;
- validation/fallback des positions ;
- machine d'état du handoff ;
- comparaison d'epochs et construction des clés de room ;
- conservation de `step/reconcile` pour chaque géométrie de zone.

### Tests workerd intégrés

- vrais Durable Objects `World` et `CharacterPresence` ;
- vraies WebSockets et D1 avec les migrations livrées ;
- deux rooms actives dans un même test ;
- injections de courses via promesses contrôlées, sans mocker les résultats de gameplay ;
- assertions par identifiants, jamais par nombre global de sockets, conformément aux contraintes
  actuelles du pool.

### Tests UI/client

- état visible pendant reconnexion et transfert ;
- remise à zéro des commandes en vol lors d'un changement de room ;
- chargement du nouveau `WorldInfo` avant de reprendre la prédiction ;
- absence de mélange de buffers de snapshots entre zones ;
- fermeture unique même si `error` puis `close` sont émis.

### Validation de déploiement

- migration D1 locale puis environnement de préproduction ;
- cohorte interne derrière feature flag ;
- métriques de claims, kicks, epochs obsolètes, échecs de sauvegarde et transferts expirés ;
- test de rollback avant toute ouverture publique ;
- activation progressive zone par zone.

## 9. Stratégie globale de retour arrière

1. Toutes les migrations D1 initiales sont additives et compatibles avec l'ancien Worker.
2. Le nom historique `world` reste disponible jusqu'à validation complète des deux premières zones.
3. Le routage multizone et les transferts sont contrôlés séparément par configuration serveur.
4. Un rollback désactive d'abord les nouveaux transferts, attend ou expire les handoffs, puis route
   les nouvelles connexions vers `world`.
5. Les sauvegardes restent protégées par epoch même en rollback ; on ne réactive jamais les
   écritures aveugles après avoir ouvert plusieurs rooms.
6. Les colonnes D1 et migrations DO ne sont pas supprimées pendant l'incident.
7. Un export D1 et un compteur des personnages par `zone_id` précèdent chaque activation majeure.

## 10. Inventaire des fichiers concernés

### Audités pour ce plan

- `README.md`, `AGENTS.md`, `package.json`, `wrangler.jsonc` ;
- `.github/workflows/ci.yml`, `.github/workflows/deploy.yml` ;
- tous les fichiers de `src/server/` ;
- `src/shared/simulation.ts`, `prediction.ts`, `protocol.ts`, `game.ts`, `skills.ts`, modèle de
  personnage et dictionnaires i18n ;
- `src/client/game/net.ts`, `session.ts`, `input.ts`, `renderer.ts` et layouts associés ;
- schéma Drizzle, migrations SQL et métadonnées ;
- tests Worker/workerd et tests React/jsdom.

### Modifications prévues par ordre

1. tests et observabilité ;
2. `zones.ts` et `world-router.ts` sans changement de routage ;
3. schéma/migration/profile pour `zone_id` et `session_epoch` ;
4. `CharacterPresence` et protection des sauvegardes ;
5. paramétrage de `World` ;
6. activation contrôlée du routeur ;
7. handoff et évolution versionnée du protocole ;
8. extraction progressive des sous-domaines de `world.ts`.

## 11. Dette restante

- Le commentaire de script `npm run check` dans `AGENTS.md` résume lint/typecheck/test, tandis que
  le script exécute également `test:ui`.
- Le parsing serveur valide strictement les messages clients, mais `parseServerMessage()` vérifie
  seulement la forme de premier niveau puis caste les structures imbriquées. Ce n'est pas une
  faille d'autorité serveur, mais cela réduit la robustesse du client face à une réponse tronquée ou
  incompatible.
- Le système ne dispose pas encore d'un test direct du nombre de snapshots par seconde ni d'un
  test unitaire du buffer d'interpolation.

Ces points sont consignés ici ; ils ne sont pas corrigés dans cette mission afin de respecter le
périmètre documentaire et l'interdiction de modifier le gameplay ou le protocole.
