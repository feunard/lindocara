# The interpreter's multiplayer questions

Tranche 5 pre-design, 2026-07-19. These are GAME decisions, not technical ones — the roadmap
commits to settling them with you before a line of interpreter code. Each question comes with a
recommendation you can accept with one word, or override.

RPG Maker XP is single-player: "the hero", one dialogue box, the world pauses. Lindocara has up
to four heroes in the same running adventure, possibly on different maps. Every command in the
wireframe's catalogue hits this.

## Q1 — When a player triggers an NPC dialogue, who sees it?

- **A. Only the triggering player.** Others keep playing; the event runs "for" one hero.
- **B. Everyone in the party**, wherever they are; the game pauses for all (closest to XP).
- **C. Everyone ON THAT MAP sees the bubble; only the trigger interacts.**

**Recommandation : A**, avec l'état partagé (interrupteurs) comme canal de coordination — un
événement peut activer un interrupteur que les autres voient immédiatement. B fige quatre
joueurs sur le choix d'un seul et invite le grief; C est un joli milieu mais double le
protocole (spectateur vs acteur) pour un gain faible en tranche 5.

## Q2 — Peut-on s'éloigner pendant un dialogue ?

- **A. Oui** — le dialogue suit (fenêtre UI), le mouvement reste libre; s'éloigner au-delà d'un
  rayon ferme le dialogue proprement.
- **B. Non** — le héros en dialogue est immobilisé (file de commandes gelée, comme la mort).

**Recommandation : B pour le déclencheur, libre pour les autres** (cohérent avec Q1-A). Le gel
réutilise exactement la mécanique existante : la file est vidée à l'entrée du dialogue comme aux
transitions de vie, donc pas de sprint accumulé à la fermeture.

## Q3 — « Téléporter le héros » : lequel ?

- **A. Le déclencheur seul.**
- **B. Toute la partie** (rassemblement forcé).
- **C. Deux commandes distinctes dans le catalogue** (« le héros » = déclencheur; « l'équipe » =
  tous, avec l'infra de handoff multi-cartes existante).

**Recommandation : C** — c'est un mot de plus dans le catalogue et ça évite de choisir pour
l'auteur. Le handoff existe déjà (épochs de présence); « l'équipe » le déclenche pour chacun.

## Q4 — Deux joueurs déclenchent le même événement au même tick ?

- **A. Il tourne deux fois** (une instance par déclencheur).
- **B. Verrou par événement** : une seule instance à la fois; le second déclencheur est ignoré
  (ou mis en file) jusqu'à la fin.

**Recommandation : B (ignoré, pas de file)** — c'est le comportement le moins surprenant pour un
coffre ou une porte, et le verrou par `(party, event)` tombe naturellement chez le coordinateur
qui possède déjà l'état. A rend chaque événement auteur-piégeable (double loot).

## Q5 — L'or et les objets (« Modifier l'or / les objets ») : par héros ou par partie ?

- **A. Par partie** (bourse commune — cohérent avec « la partie est la sauvegarde »).
- **B. Par héros** (le déclencheur reçoit).

**Recommandation : A pour l'or, B pour les objets** — la bourse commune suit la philosophie de
sauvegarde partagée; les objets dans l'inventaire du déclencheur suivent le système d'inventaire
existant (par héros) sans le refondre. Signalé : l'inventaire est encore session-only dans cette
tranche du jeu — la commande objets pourrait devoir attendre que l'inventaire devienne durable.

## Q6 — « Processus parallèle » et « Automatique » (déclencheurs sans joueur) ?

- **A. Reportés** — tranche 5 ne livre que Touche action / Contact (les trois déclencheurs à
  joueur); auto/parallèle viennent après, avec leur budget par tick.
- **B. Inclus dès le début.**

**Recommandation : A** — auto/parallèle sont la moitié de la complexité du budget par tick
(boucles sans joueur, rooms vides…) pour une fraction de la valeur initiale. Le champ existe
déjà dans les données (tranche 3); seul le moteur les ignorerait d'abord.

---

Réponds par exemple : « Q1 A, Q2 ok, Q3 ok, Q4 ok, Q5 or partagé objets héros, Q6 ok » — et la
spec de la tranche 5 s'écrit là-dessus.
