# Les questions de la tranche 6

Pré-design, 2026-07-20. La tranche 5 (interpréteur) est fusionnée et déployée. La tranche 6 du
roadmap — « Tester + le reste de la maquette » — regroupe des morceaux indépendants; ces questions
fixent leur périmètre et leur ordre avant toute ligne de code. Chaque question vient avec une
recommandation acceptable d'un mot. La boussole WoW continue de s'appliquer.

## Q1 — Le bouton « Tester » : dans quelle partie joue-t-on ?

- **A. Une partie éphémère solo** — créée à la volée pour l'auteur, jetée à la sortie; l'état
  d'aventure (interrupteurs/variables) part de zéro à chaque test.
- **B. Une partie de test persistante par aventure** — l'auteur retrouve son état entre deux tests
  (plus proche du « Play » d'XP, mais l'état sale piège les tests).
- **C. Rejoindre une vraie partie existante.**

**Recommandation : A** — un test reproductible part toujours de zéro; c'est aussi le moins de
plomberie (la création de partie existe, il manque le mode jetable). Un bouton « réinitialiser
l'état » deviendrait inutile.

## Q2 — « Base de données… » : qu'édite-t-on dans le tileset ?

- **A. Lecture seule + le champ terrain tag** — l'écran montre le tileset Tiny Swords livré
  (passable, priorité) et permet d'éditer le terrain tag par tuile; les changements restent
  globaux (le fichier de données versionné).
- **B. Des overrides par aventure en D1** — chaque aventure peut redéfinir passable/priorité/tag
  par tuile (le vrai modèle XP, mais un cache de collision par aventure et une migration).

**Recommandation : A d'abord** — le tag gagne son consommateur (« sur quoi marche le héros ? »)
sans toucher au modèle de collision; B reste possible plus tard sans jeter A.

## Q3 — Commandes audio/écran : pour qui ?

Vocabulaire proposé : jouer un effet sonore (la banque Tiny Swords embarquée), fondu écran
(entrée/sortie), flash, teinte. Portée :

- **A. Le déclencheur seul** (cohérent avec les dialogues par joueur — boussole WoW).
- **B. Toute la carte** (ambiance partagée).

**Recommandation : A** — un fondu d'écran pendant la cinématique d'un joueur ne doit pas aveugler
les trois autres. Une commande « ambiance de carte » (BGM partagé) pourra venir séparément.

## Q4 — Itinéraires de déplacement (move routes) : maintenant ou après ?

Les événements sont aujourd'hui statiques; les faire bouger = simulation serveur, collision,
interpolation côté client — le plus gros morceau de la tranche.

- **A. Reporter à une tranche 7 dédiée** — la tranche 6 livre Tester, Base de données, audio/écran,
  terrain tag, événement-touche, « Saisir un nombre », événements communs.
- **B. Inclure dès maintenant.**

**Recommandation : A** — tout le reste de la tranche 6 est livrable vite et rend l'outil
complet pour des aventures jouables; le mouvement des événements mérite son propre design
(il rouvre la grille spatiale, l'AOI et le budget de tick).

---

Réponds par exemple : « Q1 A, Q2 A, Q3 A, Q4 A » — et le design de la tranche 6 s'écrit là-dessus.
