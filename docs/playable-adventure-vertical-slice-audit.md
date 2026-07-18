# Audit — tranche verticale d’aventure jouable

## Référence et état de départ

Le `main` distant a été récupéré avec `git pull --ff-only origin main` avant toute modification.
Le SHA réellement audité est `b908873f68fab83e52324983597d304ecfc5f31c`. Le travail est isolé sur
`feat/playable-adventure-vertical-slice`.

La référence était saine avant le chantier : `npm ci` a réussi après une première tentative
interrompue par la limite de temps de l’outil (aucune erreur npm), `npm run check` a réussi avec
622 tests Worker et 111 tests UI, `npm run build` a réussi et `git diff --check` a réussi. Biome a
signalé un unique avertissement préexistant dans `src/client/adventure-draft.ts:66`. jsdom a aussi
émis quatre avertissements préexistants sur `HTMLCanvasElement.getContext`. Le build signale un
chunk client de 1,33 Mo et embarque les 126 assets d’éditeur, ce qui confirme le chargement eager à
corriger. `npm ci` signale quatre vulnérabilités modérées dans les dépendances.

## Ce qui existe réellement

- D1 possède déjà les comptes, anciens personnages, cartes et éléments, aventures et graphe,
  parties persistantes, membres colorés et héros rattachés à un compte et une partie.
- Les frontières CRUD cartes, aventures, parties et héros sont couvertes par les tests Worker et
  les écrans React correspondants existent.
- Les cartes transportent déjà terrain, décors, spawn historique, entrées, sorties et spawns de
  monstres avec espèce et rayon de patrouille. L’éditeur PixiJS sait les placer et les valider.
- `World` fournit déjà le déplacement autoritaire, la prédiction/réconciliation, AOI/deltas,
  combat, classes, monstres catalogue, navigation, loot, progression, mort/résurrection, sauvegarde
  fenced, reconnexion et transition entre zones catalogue.
- Le runtime sait charger une carte D1 et envoyer ses tuiles et éléments au client. Le renderer et
  la mini-carte savent afficher une zone D1 inconnue du catalogue.
- Les limites de structure sont déjà de 16 cartes et 128 liens côté parseur partagé.

## Ce qui n’est encore que documenté ou incomplet

- La coupure d’admission décrite dans
  `docs/superpowers/specs/2026-07-18-admission-cutover-design.md` n’est pas implémentée : il n’existe
  ni `hero-profile.ts`, ni `HeroPresence`, ni WebSocket `?party=&hero=`.
- Une partie n’est pas encore l’identité du Durable Object. `World` est toujours une salle unique
  indexée par carte/instance, sans salles internes par carte ; deux parties ne sont donc pas encore
  isolées par leur identité persistante.
- `world/map-zone.ts` ignore explicitement `monsterSpawns` et construit `monsters: []`. Les entrées,
  sorties et destinations du graphe d’aventure ne sont pas hydratées dans le runtime et `END` ne
  peut pas terminer une partie.
- Le canal `party` actuel désigne le groupe temporaire en jeu, pas la partie D1 persistante.
- La validation d’aventure exige une fin déclarée mais ne prouve ni son accessibilité depuis le
  départ, ni l’accessibilité de toutes les cartes membres. Le plafond HTTP reste à 16 Kio.
- Une carte utilisée peut gagner une sortie non liée : la garde actuelle protège seulement la
  suppression des identifiants déjà référencés et ne revalide pas l’aventure entière.
- Les cartes sont globales : aucun `account_id` ni contrôle d’auteur n’existe. Elles n’ont pas non
  plus de révision monotone.
- L’éditeur n’a pas d’état de chargement explicite, d’historique, de dirty state, de sélection ou
  d’inspecteur. Sa prévisualisation omet les marqueurs. L’éditeur d’aventure ne conserve pas un
  brouillon lors d’un détour par une carte et n’offre pas de test via le vrai serveur.
- L’éditeur et le jeu dupliquent le rendu des assets catalogués. Ils chargent chacun tout le
  catalogue éditeur ; le jeu n’anime que la première frame des éléments de carte.
- `sameBakedWorld` et `configureMapTerrain` ignorent une révision : un même identifiant de carte
  court-circuite actuellement toute reconstruction.

## Ancien flux encore principal

Après connexion, Zustand et `App` conduisent encore à `CharacterSelect`.
`startGame(character)` ouvre `/api/ws?character=<id>`. `server/index.ts`, `World`, la persistance,
le harness WebSocket et les tests d’intégration dépendent de `profile.ts` et `CharacterPresence`.
Les héros de partie sont aujourd’hui seulement créés/listés/supprimés : aucun bouton ne les admet
dans le jeu. Les anciennes tables et frontières resteront temporairement comme voie de rollback,
mais seront retirées du parcours UI et du runtime principal après migration des tests.

## Migrations retenues

1. Ajouter `map.account_id` et `map.revision`. Les lignes historiques dont l’auteur peut être
   déduit sans ambiguïté d’une unique aventure seront rattachées à cet auteur ; les autres seront
   mises en quarantaine sans exposition ni mutation par un compte. Aucune ligne historique ne
   deviendra implicitement publique. Toutes les nouvelles cartes auront un propriétaire explicite.
2. Faire porter l’auteur à toutes les frontières cartes/aventures, renforcer la validation de
   graphe, revalider les aventures avant une modification de carte et rendre les admissions de
   membre atomiques avec erreurs métier déterministes.
3. Compléter l’état d’édition autour de `MapData`, puis relier les deux éditeurs par un contexte de
   retour typé et un brouillon durable en mémoire.
4. Généraliser le profil runtime autour d’un profil de héros, ajouter `HeroPresence`, puis basculer
   l’admission et les clients vers `(partyId, heroId)` sans accepter de carte ou position client.
5. Faire évoluer le Durable Object existant en session de jeu identifiée par `partyId`, avec un
   état de salle par `mapId`. Les systèmes actuels restent les moteurs autoritaires et reçoivent
   les collections de la salle active ; aucun second moteur n’est créé.
6. Hydrater les monstres et sorties depuis la carte et le graphe serveur, persister les transitions
   fenced, rendre la victoire idempotente, puis basculer le chat de partie sur la session D1.
7. Introduire `mapId + revision` dans le protocole et les caches, extraire le rendu catalogué
   partagé et rendre le chargement d’assets ciblé.

## Risques de régression

- Une refactorisation multi-salle peut casser l’ordre du tick, les grilles non autoritaires,
  l’AOI, les save queues ou l’arrêt de facturation ; chaque salle devra conserver les mêmes
  invariants et la session devra arrêter son tick quand elle est vide.
- Le fencing ne tolère pas une sauvegarde hybride personnage/héros. La bascule doit être complète
  sur chaque chemin d’admission, remplacement, déconnexion et transition avant de désactiver
  l’ancien flux.
- Les cartes globales historiques n’ont pas d’auteur fiable. Une reprise trop permissive créerait
  une fuite inter-compte ; une reprise trop stricte pourrait masquer un ancien brouillon. La
  quarantaine et une note de migration explicite privilégient la sécurité.
- Une transition doit vider les caches monde/deltas et tous les sprites de l’ancienne salle avant
  le nouvel état complet, sans casser la prédiction ou rejouer des commandes d’un autre état.
- Les anciennes quêtes/cimetières catalogue ne sont pas définis pour les cartes auteur. La V1 doit
  initialiser les données temporaires de classe sans inventer de contenu auteur hors périmètre.
- La suppression récente de `assets/LICENSE.md` contenait des affirmations juridiques non
  vérifiées. Seule une note neutre de provenance Tiny Swords sera restaurée, avec obligation de
  vérifier les conditions originales d’achat avant distribution.

## Découpage

Les commits sépareront : audit ; propriété/révision/intégrité D1 ; éditeur de cartes ; continuité
des brouillons d’aventure ; admission/persistance héros ; session multi-salle et transitions ;
caches/assets/UI ; tests et documentation finale. Les migrations D1 seront générées par Drizzle et
inspectées ; les migrations Durable Object resteront append-only et les bindings seront régénérés.
