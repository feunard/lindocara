# Bataille finale — La guerre de l’Aube

## Principe jouable

La map `Guerre de l’Aube` contient neuf événements monstres répartis en trois groupes :
légionnaires occidentaux, créatures de l’Éclipse à l’est et briseurs de ligne au centre. Ils
réapparaissent selon le cycle normal des monstres. Les tuer soulage momentanément une position,
mais aucune quête ne compte l’élimination totale et aucune porte ne s’ouvre sur ce critère.

Quinze événements de garde sont écrits, dont douze au plus peuvent être actifs ensemble :

- le Veilleur du conduit est toujours présent ;
- dix gardes, par paires, dépendent des renforts d’Aubeval, des Bois, du Marais, de la Citadelle et
  du Sanctuaire (`0041` à `0045`) ;
- quatre gardes de commandement sont mutuellement exclusifs et dépendent du choix Lyra, Serah,
  Maëlys ou Conseil technique (`0027` à `0030`).

Les gardes et monstres se déplacent et combattent dans leurs rayons autoritaires. Le champ reste
actif pendant que les joueurs discutent aux postes de décision.

## Extension générique `guard`

Un événement `guard` porte un rayon de patrouille et une ou plusieurs pages conditionnelles sans
commandes. Le serveur :

1. choisit la page active avec la règle commune de l’état d’aventure ;
2. projette l’événement actif vers la simulation de gardes existante ;
3. conserve position et points de vie lorsque le même garde reste actif ;
4. crée un renfort nouvellement acquis à pleine vie ;
5. retire un garde dont aucune page ne satisfait plus l’état.

Les gardes n’accordent ni butin ni expérience et leurs victimes ne créditent pas les quêtes des
joueurs. Sur une map sans zone sûre, ils engagent les monstres dans leur rayon de détection tout en
restant bornés par leur patrouille. Le client ne décide d’aucun résultat.

Le modèle de garde existant n’embarque pas encore une apparence ou un nom de faction dans le
snapshot réseau : les identités sont donc établies par leur position, les événements de
commandement et les dialogues voisins, tandis que le combattant utilise l’apparence générique des
gardes.

## Trois objectifs incompatibles

La variable `0018` compte les fronts secourus. Les trois événements emploient le même programme :

- **ouest — Capitaine Orve** : tenir la route d’évacuation du faubourg (`0046`) ;
- **est — Haran** : empêcher la levée de céder vers les jardins (`0047`) ;
- **centre — Sœur Ane** : évacuer l’infirmerie sous le tir (`0048`).

Les deux premières réserves engagées réussissent. Au troisième poste, le programme constate que les
deux réserves mobiles sont déjà affectées et refuse de promettre un renfort inexistant. Les pages de
la herse et de la levée changent après `0046` ou `0047`.

Un front tenu suffit à atteindre le **Conduit des serviteurs**. Le passage pose `0049`, ouvre le
raccourci Sanctuaire–Guerre (`0061`) et téléporte vers les Galeries. Le groupe peut donc repartir
après un secours urgent ou assumer le coût d’un second objectif ; il ne peut pas sauver les trois.

## Mission sous la forteresse

Les Sans-Sceau peuvent entrer dans le mécanisme sans être immédiatement inscrits comme nouveaux
débiteurs. Dans les Galeries, trois ancres exigent chacune un prix explicite :

- **grain** : vider les réserves de marche ou promettre publiquement une part de trois récoltes ;
- **garde** : limiter le serment à une année ou rompre immédiatement les anciens serments ;
- **nom** : porter les noms comme Liin ou en remettre des copies aux communautés.

Chaque ancre pose son switch (`0071` à `0073`), ajoute une unité à `Ancres des galeries` et à
`Dettes assumées`, puis applique les scores propres au prix choisi. Le mécanisme originel ne s’ouvre
qu’à trois ancres. La fausse porte où un roi reçoit seul les prix renvoie au début des Galeries sans
effacer les ancres.

Le Tube de commandement possède des pages conditionnées par `0046`, `0047` et `0048`. Orve, Haran
ou Sœur Ane y rapportent la situation extérieure pendant que le groupe avance : la bataille ne
disparaît pas quand la map change. La page commune annonce aussi les morts tombés à la herse depuis
la descente du groupe ; le temps souterrain garde ainsi un coût humain mesurable.

## Varos et le choix décisif

Dans le Cœur, Varos décrit sa Couronne uniforme comme une amélioration réelle et un crime durable.
Le groupe peut :

- affronter son avatar, puis rejoindre le mécanisme après sa défaite ;
- refuser ce combat et répondre directement à son argument, ce qui augmente son influence.

L’avatar n’est qu’un objectif secondaire facultatif. Sa défaite pose `0050` et
`vaincre_avatar`, mais le mécanisme exige toujours l’une des quatre familles de décision :
restaurer le Pacte, détruire ou sceller, réformer la Couronne, ou accepter Varos.

Une tentative insuffisamment préparée n’ouvre pas une réponse parfaite cachée :

- restauration, destruction ou scellement insuffisant mène à la Nouvelle Éclipse ;
- une réforme sans scores suffisants ou sans contrôle légitime remet les canaux à Varos ;
- accepter directement Varos produit aussi sa victoire.

## Un à quatre joueurs

Chaque front, ancre, bassin et porte fonctionne par interaction ordinaire. Aucun levier simultané ne
dépend du nombre de joueurs. L’exécution d’un événement est verrouillée par identifiant côté
serveur : dans un groupe, une seule branche politique peut muter l’état partagé.
