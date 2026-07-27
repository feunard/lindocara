# Refonte jouable de Liin - audit de travail

Ce document pilote la refonte de l'aventure. Il ne remplace pas la bible narrative : il relie les
intentions existantes a ce que le joueur doit effectivement voir, comprendre et faire.

## A conserver

- La Source, la Couronne, l'Eclipse, les Liin et les Sans-Sceau.
- Lyra, Varkesh, Serah, Elyne, Talen, Maelys, Varos, Eryndor, Nhalgor et Morvane.
- Les factions, les choix politiques ambigus, la bataille dependante des alliances et les six
  familles de fins.
- Les UUID existants, la generation deterministe, l'autorite serveur, les transitions cloturees et
  les reprises anti-softlock.
- La progression regionale actuelle, lorsque son ordre sert la comprehension et le rythme.

## A reecrire

- Les seize cartes partageant le canevas `60x45`, le sol presque uniforme et les memes points de
  dispersion decorative.
- Les dialogues qui exposent la cosmologie avant que le joueur ait vecu ses premiers effets.
- Les objectifs abstraits, les quetes silencieusement acceptees et les secondaires sans donneur ni
  retour visible.
- Les rencontres constituees d'ennemis isoles sans territoire, formation ou fonction tactique.
- Les consequences conservees uniquement dans des variables jusqu'a l'epilogue.
- Les transitions sans categorie geographique ou narrative et le graphe d'aventure vide.

## Capacites presentes

- Relief a trois niveaux, falaises collisionnees, rampes laterales bidirectionnelles et couches
  superieures figees au pinceau.
- Evenements a pages conditionnelles, scripts, choix, activites, transitions autoritaires et
  marqueurs de quete.
- Quetes manuelles avec acceptation, refus, abandon, retour au donneur et choix de recompense.
- Conditions de monde partagees par le groupe, gardes autoritaires conditionnels et monstres
  autoritaires.
- Elements de catalogue avec colliders sous-cellulaires et rendu partage entre editeur et jeu.

## Systemes generiques a completer

1. **Population active** : executer cote serveur les mouvements `fixed`, `random`, `approach` et
   `custom` deja stockes par les evenements normaux; synchroniser leur position et conserver une
   interaction fiable en multijoueur.
2. **Rencontres conditionnelles** : activer et retirer des groupes de monstres selon l'etat du
   groupe. Varkesh, Morvane, Nhalgor et Varos ne doivent pas exister avant leur scene.
3. **Presentation des quetes** : distinguer principale, secondaire et information; exposer zone,
   repere et commanditaire; afficher les quetes disponibles sans les accepter.
4. **Suivi limite** : une principale et deux secondaires au maximum dans le HUD, avec un journal
   separe entre actives, disponibles, terminees et abandonnees.
5. **Etats visuels** : permettre aux pages conditionnelles de changer populations, symboles,
   reserves et installations avant l'epilogue.
6. **Transitions classees** : separer les sorties geographiques des entrees, raccourcis, passages
   magiques, souvenirs et reprises de securite; produire le graphe principal uniquement avec les
   liens geographiques.

## Cartes a reconstruire

| Region | Fonction et rythme | Geographie et repere | Populations, dangers et consequences |
| --- | --- | --- | --- |
| Prologue | secours puis menace courte | convoi brise, ravin et feu de signal | voyageurs blesses, pillards en embuscade |
| Aubeval | enquete urbaine et choix public | porte fortifiee, marche, digue et terrasse administrative | habitants, ouvriers, marchands, soldats; quartier bas evacue ou reinvesti |
| Faubourg | evacuation, infiltration, confrontation | maisons requisitionnees et arene fermee | refugies, troupes de Varkesh; Varkesh conditionnel |
| Relais | respiration et ouverture du voyage | auberge-carrefour et ecuries | voyageurs et nouvelles consequences |
| Clairecorce | exploration et conflit territorial | deux communautes, routes anciennes, arbres nourriciers et coupe | patrouilles de Seve/Ecorce, frontieres modifiees par l'alliance |
| Sanctuaire des Racines | rituel et confrontation emotionnelle | racines en terrasses et chambre-memoire | gardiens, echos personnels et acces conditionnels |
| Marais de Verre | sauvetage et exploration fragmentee | ilots, pontons, maisons noyees et clocher englouti | survivants deplaces, noyaux ennemis sur les digues |
| Archives | enquete chronologique resserree | salles de consultation, depots et aile interdite | archivistes, temoins, peu de combat |
| Citadelle | infiltration ou soulevement | enceinte, cours, cellules, intendance et commandement | zones factionnelles, prisonniers liberes, gardes remplaces |
| Fort | occupation militaire et preuves | cour, caserne, reserves, archives et defenses | garnison structuree et reponse visible au choix politique |
| Sanctuaire de l'Aube | revelation puis choix logistique | infrastructure sacree sur plusieurs niveaux | gardiens, soigneurs et reseaux actives |
| Crypte | exploration facultative et dette locale | nef, tombeaux, ossuaire et caveau | groupes territoriaux, raccourci gagne |
| Guerre | pression continue et fronts incompatibles | lignes de defense, triage et breches | vagues, allies visibles, pertes immediates |
| Galeries | course contre la montre | puits, embranchements et machines | equipes de sape, effondrements, echos de la surface |
| Coeur | combat puis decision separee | anneaux de defense et Source centrale | elites par couches, choix final lisible |
| Epilogue | parcours court de consequences | promenade memoriale recomposee | delegations, absences et installations selon la fin |

## Risques

- Une quete dont le donneur est aussi l'evenement objectif peut masquer son propre script : les
  donneurs et les cibles doivent rester distincts.
- Le redimensionnement peut rendre une arrivee, un objectif ou une reprise inaccessible; chaque
  destination doit etre verifiee sur la collision bakee.
- Une page conditionnelle trop generale placee apres une page specifique peut masquer une reaction.
- Un monstre narratif instancie avant son switch peut etre tue trop tot. C'est le bug actuel de
  Varkesh et il compromet le choix execution/capture.
- Une couche visuelle ne doit jamais devenir une seconde source de collision.
- Le mouvement des PNJ ne doit pas dependre du client ni modifier l'issue d'un combat.

## Ordre d'implementation

1. Verrouiller les rencontres conditionnelles et reproduire/corriger le cas Varkesh.
2. Completer le modele de quete et la population autoritaire reutilisable.
3. Reconstruire Aubeval, ses transitions, ses quetes et ses etats visibles.
4. Verifier Aubeval dans le jeu et l'editeur, puis corriger la densite, les collisions et le suivi.
5. Refaire les regions dans leur ordre de parcours, sans operation de dispersion commune.
6. Reecrire les dialogues apres stabilisation de la geographie et des actions.
7. Valider les branches, les six fins, le multijoueur, les reprises et le rendu de chaque region.

## Etat de la refonte

- Les seize cartes ont maintenant dix couples de dimensions, des compositions propres a chaque
  region, un relief collisionne, des escaliers jouables et au moins un detour recompense.
- Aubeval a ete reconstruite comme carte pilote avec porte, marche, quartier bas, digue, caserne,
  archives, memorial, terrasses administratives et populations conditionnelles.
- Varkesh et les autres confrontations narratives sont conditionnels; leur page active gouverne
  aussi les commandes de defaite.
- Les PNJ mobiles sont simules par le serveur et les quetes manuelles sont proposees par leur donneur.
- Le graphe de voyage est derive des transitions classees; les enigmes et reprises internes en sont
  exclues.
- Le rendu de controle produit des PNG sans interface depuis les vrais atlas, couches et elements de
  catalogue avec `npm run adventure:render`.
