# Architecture technique de la campagne

## Sources d’autorité

- `scripts/legacy/liin-adventure/campaign.ts` : identifiants de maps, switches, variables, UUID stables,
  terrain commun et helpers de commandes ;
- `scripts/legacy/liin-adventure/maps.ts` : terrain, éléments, événements, téléportations et monstres ;
- `scripts/legacy/liin-adventure/quests.ts` : définitions des quêtes et récompenses ;
- `scripts/legacy/liin-adventure/build.ts` : assemblage, validation sémantique et écriture du JSON ;
- `adventures/legacy/liin-adventure-ia.json` : artefact généré, jamais édité à la main ;
- `docs/lore/liin/` : contrat narratif maintenu en regard de ces sources.

## Identifiants

Les UUID de maps et d’événements sont dérivés par SHA-256 d’une clé stable préfixée par la campagne.
Une réécriture de texte ne casse donc pas les références. Les ids de registre et de quête restent
des ordinaux sur quatre chiffres, déclarés une seule fois.

## Pages et choix

Les états politiques utilisent des switches exclusifs. Les scores utilisent des additions de
variables. Chaque branche de choix importante applique explicitement :

- le switch de décision ;
- les scores immédiats ;
- l’activité de quête ;
- le texte de conséquence.

Les événements à plusieurs pages placent l’état le plus avancé en dernier, conformément à la règle
XP du moteur.

## Progression et portes

Les sorties fonctionnelles ne peuvent pas porter de condition. Les passages narrativement
conditionnés sont donc des événements normaux :

- page 1 : porte fermée et indication concrète du prérequis ;
- page 2 conditionnée : dialogue bref puis `teleport` ;
- arrivée hors de toute case ou case adjacente à un déclencheur `player-touch`.

Les retours et bornes rapides suivent le même modèle. Les tests construisent le graphe statique de
toutes les commandes de téléportation, vérifient les quatre raccourcis bidirectionnels et simulent
les états décisifs.

## Énigmes récupérables

Une séquence utilise un compteur :

- l’étape correcte n’est acceptée que lorsque les étapes précédentes ont posé la valeur attendue ;
- une erreur explique la contradiction, remet le compteur à zéro et téléporte au point de reprise ;
- un événement manuel permet toujours la remise à zéro ;
- la réussite pose un switch et une activité, ce qui rend les répétitions inoffensives.

## Quêtes

Les activités scriptées ne sont jamais aussi des références `interact` de quête, car la conversation
de quête a priorité sur le programme d’événement. La campagne utilise `activity`, `reach` et un seul
`defeat-target` facultatif pour l’avatar de Varos. Les boss optionnels ne sont jamais un prérequis
unique d’une quête principale ; leur résolution alternative émet la même activité structurée.

Une enquête libre utilise le mode simultané lorsque ses indices peuvent être rencontrés dans
plusieurs ordres. Une étape séquentielle est protégée par la géographie ou par une page
conditionnelle. Le parcours automatisé remet les faits au moteur réel de progression et termine les
vingt-cinq quêtes.

## Bataille

Les événements `guard` sont évalués depuis l’état autoritaire de partie. Leurs pages peuvent porter
des conditions, jamais des commandes. Les gardes n’accordent ni XP ni butin et leurs victimes
n’avancent pas une quête de joueur. Leur combat est un état de fond, pas une source de récompenses.
Le snapshot de garde restant générique, l’identité de faction est donnée par la position et les
événements narratifs voisins.

## Limites conservées

- au plus 16 maps, 64 événements par map, 64 quêtes et 200 commandes par page ;
- un choix possède au plus quatre options ;
- une boîte de dialogue possède au plus 200 caractères ;
- aucune énigme ne dépend du nombre de joueurs ;
- aucun client ne choisit une destination ou un résultat autoritaire.
