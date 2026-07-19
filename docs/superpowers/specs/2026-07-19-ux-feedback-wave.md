# Tranche 4.5 — la vague de retours UX

Source : retours utilisateur du 2026-07-19, verbatim ci-dessous, à exécuter APRÈS la tranche 4
et AVANT la tranche 5. Critère de sortie : des heures de test Playwright réel — créer des
aventures en ligne, multi-cartes, multi-joueurs, depuis zéro, sans accroc.

## Les remarques (traduites en exigences)

1. **Pas de dark mode.** Tout en light, thème par défaut.
2. **L'éditeur s'ouvre sur le choix d'une aventure** — en sélectionner une ou en créer une.
   Pas d'éditeur sans aventure.
3. **Créer une aventure crée automatiquement une carte** avec son spawn.
4. **L'aventure se sauvegarde explicitement** à la création.
5. **Les cartes appartiennent à UNE aventure.** Pas de partage entre aventures. Le modèle
   membership actuel (AdventureSettingsDialog, adventure_map en n-n) est faux — devient une
   possession 1-n. Implique schéma + validation + suppression du picker de membership.
6. **La carte de départ se configure dans le panneau Cartes** de l'éditeur (le make-first
   supprimé en tranche 2 revient, au bon endroit cette fois).
7. **Une nouvelle carte = 5×5 de terre, spawn au centre, eau autour.** Toujours.
8. **La grille est visible par défaut** dans l'éditeur.
9. **Retour visuel au survol** quand un élément est sélectionné : preview sur la cellule
   (bordure élargie…), et **fond rouge opaque si la pose est illégale**.
10. **Le Test de carte est ultra laggy** — diagnostiquer et corriger (piste : le sandbox
    preview et/ou le teardown-rebuild du stage; mesurer d'abord).
11. **Sélection exclusive** : pas Herbe ET un marqueur en même temps (le dual-highlight déjà
    consigné en revue tranche 2, maintenant confirmé utilisateur).
12. **Les marqueurs doivent devenir des événements typés.** Un spawn, une entrée, une sortie,
    un spawn de monstre = des events avec un type, pas un système parallèle. Design à écrire :
    migration des markers existants, impact sur le graphe d'aventure (les liens exit→entry) et
    sur le monster-system. La plus grosse pièce de la vague.
13. **Catalogue minimal et fiable** : garder UN buisson, UN arbre, UN monstre. Masquer le
    reste tant que non testé rigoureusement.

## Ordre suggéré

Schéma d'abord (5), puis le flux d'entrée (2-4, 6, 7), puis l'éditeur (8, 9, 11, 13), la perf
(10), et le design markers→events (12) en dernier car il mérite sa propre mini-spec.

## Verbatim utilisateur

> pas de dark mode dans l'app, tout en light et default theme / quand tu ouvres l'éditeur, tu
> dois d'abord select une aventure ou en créer une / quand tu créé une aventure, tu as
> automatiquement une map avec spawn de créer / il faut "save" l'aventure quand tu l'as crée /
> les cartes sont liés à l'aventure, tu peux pas utiliser une carte d'aventure X dans une autre
> aventure, le "Editeur d'aventures" est totalement faux maintenant / la premiere map (map de
> départ) se configure dans l'editeur, dans le panel "Cartes" / une nouvelle map c'est toujous
> 5x5 blocks de terre, avec le spawn au milieu, et le reste c'est de la water / il faut voir
> les grids sur la map par défaut dans l'editeur / il faut voir un :hover "preview" quand on
> select un element qu'on hover la map (il faut un retour visuel, genre le border la cellule
> est plus large, etc..), et surtout il faut ajouter un opaque red bg si on peut pas poser sur
> cette cellule / le test map est ultra laggy / on devrait pas pouvoir select Herbe ET un
> marqueur en même temps / je comprends pas l'utiliser des markers, ça devrait être des events
> avec un type d'events / afficher uniquement les décorations qu'on a testé rigoureusement,
> aujourd'hui y'en a bcp d'invalide. Garde juste un buisson et un arbre. Garde juste un
> monstre. Fait simple.

## Amendement du 2026-07-19 (après tâche 2)

14. **Pas de page/formulaire de création.** « Nouvelle aventure » crée immédiatement (création
    atomique existante, nom par défaut) et atterrit dans l'éditeur. **Le nom se demande au
    premier save, via un popup.** Le max joueurs (défaut 4) se configure dans les réglages de
    l'aventure via un dialog des menus de l'éditeur — plus jamais à la création.

> Verbatim : « je suis pas fan de la page de création de aventure, je préfère qu'on fasse
> directement une aventure, et qu'on peut changer le nom de l'aventure quand on va la save pour
> la premiere fois via un popup. Also, on configure le max player dans des settings de
> l'aventure via un dialog dans les menus de l'éditeur. Par défaut on dit que c'est 4 joueurs max. »

## Amendement 2 du 2026-07-19

15. **Pas de page picker.** Ouvrir l'éditeur ouvre L'ÉDITEUR, directement. Charger une aventure
    existante : menus → Fichier → « Charger une aventure » → dialog listant les aventures.
    Décision d'implémentation (renversable) : à l'ouverture, l'éditeur charge la DERNIÈRE
    aventure éditée (mémoire client) ; s'il n'y en a aucune, il en crée une immédiatement
    (remarque 14). Ça évite de fabriquer une aventure fantôme à chaque ouverture.

> Verbatim : « quand on ouvre l'editeur, je veux ouvrir directement l'editeur, je veux pas une
> page intermédiaire qui liste les aventures. je veux ouvrir directement l'éditeur. et si je veux
> load une aventure existant, j'utilise les menus -> fichiers -> charger aventures -> dialog avec
> la liste des aventures »
