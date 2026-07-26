# Audit de l’aventure initiale

## Éléments conservés

- Aubeval, les Bois des Murmures, le Marais de Verre, la Citadelle et le Sanctuaire ;
- la Source comme fondement politique du royaume ;
- Varkesh rebelle après la découverte des convois, avec une culpabilité propre ;
- Lyra prise entre vérité et stabilité ;
- Elyne, Talen, Serah, Maëlys, Nhalgor, Morvane, Eryndor et Varos ;
- les cloches, les doubles registres, les serments militaires et les bibliothèques séparées ;
- la génération déterministe du bundle et ses UUID stables ;
- les quêtes structurées et les programmes de défaite de monstres.

## Incohérences et faiblesses

- cinq maps seulement représentaient prologue, cinq actes, guerre et épilogue ;
- le Marais était le terrain des Bois retourné horizontalement ; Aubeval et la Citadelle
  partageaient le même terrain ;
- chaque région proposait presque la même boucle : trois activations, boss, retour ;
- Varkesh, Morvane, Nhalgor et Eryndor devaient être vaincus, malgré les ambiguïtés annoncées ;
- Varos n’agissait qu’au Sanctuaire ;
- l’Éclipse, la Source et le mot Liin n’avaient pas de règles stables ;
- les héros arrivaient sans raison personnelle ;
- douze switches et trois variables ne produisaient presque aucun changement visible ;
- le choix final était binaire et les deux branches n’exécutaient pas la fin de partie ;
- aucune téléportation n’était utilisée ;
- aucune route n’était conditionnée par l’avancement ;
- la bataille finale et l’épilogue n’existaient pas ;
- les quêtes secondaires tardives demandaient surtout de lire des sites dans l’ordre ;
- plusieurs phrases employaient précisément les abstractions interdites, par exemple « où
  l’histoire fait mal », sans fait concret.

## Personnages sous-exploités

- Lyra, Serah, Talen et Maëlys étaient principalement des donneurs de quête ;
- Varkesh et Nhalgor mouraient avant de pouvoir défendre leur position ;
- Eryndor était un sous-boss sans mémoire ni mandat temporaire ;
- la faute historique des Bois était absente ;
- Varos ne sauvait personne et ne formulait aucune alternative crédible.

## Capacités réelles du moteur

### Exécutables

- événements `action` et `player-touch` ;
- programme d’un monstre lors de sa défaite ;
- choix de une à quatre options et branches imbriquées ;
- conditions sur switch, seuil de variable et self-switch ;
- mutations de switch, variable et self-switch ;
- attente bornée, sortie de programme et boucles budgétées ;
- or, consommables, boutique ;
- activités et aires structurées pour les quêtes ;
- acceptation, progression et complétion de quêtes ;
- téléportations intra-map et inter-map validées par le serveur ;
- pages d’événement réévaluées après mutation de l’état partagé ;
- fin autoritaire de l’aventure.

### Typées mais non exécutées

- `auto` ;
- `parallel` ;
- `event-touch` ;
- déplacement autonome des pages.

La nouvelle campagne ne s’appuie sur aucune de ces quatre fonctions.

## Limite essentielle et extension retenue

Les maps importées ne pouvaient créer aucun garde, alors que le runtime possédait déjà le combat
garde-monstre. La guerre demandant des alliés qui combattent réellement, l’extension générique
`guard` réutilise ce système. Elle ne donne aucun résultat autoritaire au client et ne crée aucun
état global.

## Tests initiaux

Le test existant validait l’enveloppe, la marche, la densité, cinq boss obligatoires et l’absence de
téléportations. Il ne vérifiait ni la faisabilité des branches, ni les fins, ni les prérequis, ni les
conséquences. Ces assertions doivent être remplacées par des invariants de campagne.
