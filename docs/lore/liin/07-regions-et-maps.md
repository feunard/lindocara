# Régions et maps

La campagne utilise les seize maps autorisées par le format de bundle. Aucun terrain n’est un
miroir d’un autre. Les eaux, cours, couloirs et clairières forment des masques distincts, vérifiés
par les tests.

| Ordre | Map | Fonction narrative et géographie |
| --- | --- | --- |
| 1 | Route des Bornes arrachées | convoi brisé, vanne, camp de secours, première borne de sceau |
| 2 | Aubeval — Les Digues hautes | marché, quai pauvre, caserne, archives, mémorial, maisons réquisitionnées |
| 3 | Faubourg de la Porte | rue murée et enfumée, ligne rebelle, digue, infirmerie, réduit de Varkesh |
| 4 | Relais des Quatre Dettes | route de transition, relais postal, camp de réfugiés, borne rapide |
| 5 | Bois des Murmures — Clairécorce | villages de Sève et d’Écorce, coupes royales, ancienne route |
| 6 | Sanctuaire des Racines | trois chambres rituelles, passages de mémoire, cœur de Morvane |
| 7 | Marais de Verre — Les Saules | hameaux sur îlots, pontons, digues, clocher englouti |
| 8 | Archives sous la Vase | trois époques séparées par des portes, salle des doubles registres |
| 9 | Citadelle — Les Trois Cours | cour des conscrits, cour inquisitoriale, rempart des morts |
| 10 | Fort des Serments | cellules, intendance, archives, quartiers d’officiers, salle de commandement |
| 11 | Sanctuaire de l’Aube | jardins, canaux, quartiers de serviteurs, deux monastères, infrastructure royale |
| 12 | Crypte d’Eryndor | salles AC 0, AC 9 et AC 14, chambre des Sans-Sceau |
| 13 | Guerre de l’Aube | fronts ouest/est, poste de soins, porte effondrée, passage des serviteurs |
| 14 | Galeries de la Source | conduits, trois ancrages, échos de la bataille, boucle royale |
| 15 | Cœur du Pacte | nouvelle Couronne, chambre de l’avatar, mécanisme originel |
| 16 | Plaine des Liin | mémoriaux, délégations variables, services sauvés ou perdus, conclusion |

## Aubeval

La rivière explique la ville : les quartiers aisés sont derrière la digue haute, le faubourg sert
de zone d’expansion des crues et les maisons de service occupent les quais. Le registre des convois
se trouve près de la caserne, pas dans un temple. Des chariots murés dans une cour montrent que les
disparitions passent par une logistique ordinaire.

Les événements déjà accomplis conservent une page de retour : le registre, la vanne et le mode de
publication restent consultables. Le relais rapide régional s’ouvre lorsque les quatre tables du
Relais ont été lues.

## Bois des Murmures

Clairécorce occupe une ancienne route de pierre que les racines ont reprise. Le village de Sève est
près des arbres nourriciers ; celui d’Écorce garde le pont et les tables. La coupe du Conclave
montre que l’exploitation est aussi un conflit territorial.

Le Sanctuaire des Racines est une map distincte : ses téléportations représentent des salles
rituelles conservées dans plusieurs états de mémoire, et non un déplacement arbitraire.

## Marais de Verre

Les îlots suivent les anciennes digues. Les maisons noyées restent alignées sous l’eau, ce qui
permet de comprendre que la crue fut provoquée. Les pontons relient le présent ; les portes de
mémoire mènent aux Archives sous la Vase.

Une poterne vers la Citadelle s’ouvre depuis l’autre côté après l’arrivée dans les Trois Cours et
pose `0060`. Les civils sauvés font apparaître un camp conditionnel dans l’épilogue.

## Citadelle des Cendres

Chaque cour correspond à une époque de construction et à une faction. Les cellules sont proches de
l’intendance parce que les prisonniers étaient comptés comme ressources. Les archives surplombent
la voie du Sanctuaire.

Le Fort des Serments contient les décisions de commandement. Le canal des Archives, la porte du
Fort et la poterne du Marais sont des événements de passage explicites, pas des sorties nommées
« prochaine map ».

## Sanctuaire

La surface montre les bénéfices avant la salle royale : soins, semences, digues miniatures et
quartiers qui assurent la maintenance. Les jardins morts signalent les canaux détournés vers la
nouvelle Couronne. Les deux monastères sont séparés physiquement par le conduit principal.

La Crypte répartit trois fragments datés, AC 0, AC 9 et AC 14, dans des salles distinctes. Leur ordre
est donné par les dates ; ils peuvent être examinés dans n’importe quel ordre, puis la mémoire
centrale s’active au troisième. La sortie mène au camp de guerre.

## Guerre et dessous

La map de guerre possède plusieurs fronts visibles et des gardes simulés par le serveur autoritaire,
issus des pages conditionnelles `guard`. Leur présence dépend des switches de factions. Les monstres réapparaissent :
la carte reste trop vaste pour être « nettoyée ».

Le passage des serviteurs mène aux Galeries. Les ancres sont reliées par les couloirs praticables ;
une fausse porte royale téléporte au point de reprise, et le mécanisme originel téléporte vers le
Cœur. Celui-ci sépare l’avatar de Varos du mécanisme afin que le combat ne puisse pas être confondu
avec la solution.

La Plaine des Liin ne résume pas seulement la fin générale. Des pages conditionnelles montrent le
mandat de Lyra, la ligne de Serah, le dossier final de Varkesh, les services préservés et les
conséquences régionales des scores accumulés.

## Sécurité des transitions

Chaque commande `teleport` est vérifiée contre :

- l’existence de la map ;
- les limites de grille ;
- la collision cuite et les colliders d’éléments ;
- l’absence d’arrivée sur un déclencheur `player-touch` ;
- l’absence d’arrivée près d’un déclencheur `player-touch`, donc de boucle automatique ;
- la présence, dans les tests de campagne, des quatre raccourcis bidirectionnels prévus.

Les mauvaises réponses aux énigmes reviennent à un point de reprise marchable. Les raccourcis sont
des bornes, portes de service ou canaux anciens dont l’ouverture est racontée.
