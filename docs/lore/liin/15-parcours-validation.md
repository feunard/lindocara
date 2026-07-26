# Parcours de validation

## Portée des contrôles

La campagne est vérifiée à trois niveaux complémentaires :

1. le générateur refuse un bundle dont une map, une référence, une quête ou une téléportation est
   invalide ;
2. `liin-adventure-bundle.test.ts` interprète les commandes d’événements, les conditions, les
   choix, les switches et les variables sans se contenter de chercher du texte ;
3. les tests autoritaires du serveur couvrent l’apparition et le combat des gardes alliés
   conditionnels.

Le parcours de coopération maximale est rejoué décision par décision depuis Iven jusqu’au Cœur du
Pacte. Il ne reçoit aucun score artificiel : toutes ses valeurs proviennent des commandes réellement
attachées aux événements. Le journal de faits ainsi produit est ensuite donné au moteur pur de
quêtes : les sept quêtes principales et les dix-huit secondaires atteignent toutes l’état
`completed`. Des suites de choix distinctes produisent aussi les conclusions Liberté, Ordre et
Mémoire sans injection de score. Enfin, les six fins sont testées avec des profils d’état explicites
afin de vérifier séparément leurs seuils et leur exclusivité.

## Matrice des parcours

| Parcours demandé | Décisions représentatives | Résultat contrôlé |
| --- | --- | --- |
| liberté | preuve publiée, faubourg évacué sans attendre, Écorce aidée, conscrits libérés, communes au commandement, offre de Varos refusée | Couronne détruite si les protections et les alliés ont été préparés ; Nouvelle Éclipse sinon |
| ordre | preuve confiée à Lyra, Varkesh capturé, Sève protégée, Morvane apaisé, commandement de Lyra, trêve logistique acceptée | Couronne réformée si ordre, concorde et stabilité atteignent leurs seuils |
| mémoire | tous les fragments du Marais et d’Eryndor, Archives préservées, Talen affecté à la réparation, noms portés comme Liin | Source scellée ou Pacte restauré selon concorde et alliés |
| peu de quêtes secondaires | seules les preuves et activités imposées par les portes principales, un front secouru | aucune porte principale ne dépend d’une quête secondaire ; les meilleures fins deviennent plus difficiles |
| toutes les quêtes secondaires | familles sauvées, quatre dettes lues, fautes des Bois copiées, digues réparées, soins rendus, lettres livrées | épilogue enrichi par le camp, le dispensaire, l’archive, la table des dettes et les forces recrutées |
| Varkesh mort | option d’exécution, puis résolution de son affrontement | seul `Varkesh mort` est posé ; Serah reçoit sa page de deuil et choisit encore justice ou vengeance |
| Varkesh vivant | capture ou trêve limitée | capture et trêve restent exclusives ; Serah reçoit la page correspondant exactement au sort choisi |
| peu d’alliés | refus des recrutements, contrôle technique, un seul front stabilisé | passage souterrain possible, mais restauration collective insuffisante et bataille extérieure plus pauvre |
| meilleure coopération | trêve limitée avec Varkesh, Écorce, Morvane libéré, Nhalgor préservé, conscrits libres, Maëlys, serviteurs, deux fronts | seuils de mémoire, concorde, alliés, stabilité, Liin et dettes consenties atteints par exécution réelle ; Pacte restauré |
| mauvaise fin | rupture ou restauration sans structure de remplacement | seule `Nouvelle Éclipse` est posée ; l’épilogue décrit la victoire militaire devenue crise mondiale |

## Invariants vérifiés

- Les trois sentences de Varkesh aboutissent à un seul état parmi mort, capturé ou trêve.
- Serah conserve ensuite un choix propre ; la capture de son père ne lui impose plus
  automatiquement la justice.
- Une mauvaise réponse remet chaque énigme à zéro et ramène à une case de reprise atteignable.
- Les trois ancres sont nécessaires au mécanisme originel et peuvent être activées seul.
- Les réserves de guerre ne peuvent tenir que deux fronts ; un seul suffit pour le conduit secret.
- Neuf conditions de faction — cinq contingents et quatre commandements exclusifs — déterminent les
  gardes actifs sur la map de guerre.
- Les six switches de fin sont mutuellement exclusifs dans chaque simulation.
- Chaque Livre des Liin termine effectivement l’aventure pour la fin correspondante.
- Les variables de familles sauvées, soins, Liin, dettes consenties et pression de l’Éclipse
  déplacent du contenu dans l’épilogue.
- Aucun événement essentiel n’emploie un déclencheur automatique, parallèle ou de contact non
  exécuté par le runtime actuel.

## Un à quatre joueurs

Le contenu n’exige ni séparation permanente du groupe, ni présence simultanée sur plusieurs cases,
ni inventaire individuel précis, ni compteur lié au nombre de participants. Les énigmes sont des
séquences publiques de partie, les choix ont une conséquence de partie et les portes lisent l’état
autoritaire commun. Un joueur peut donc accomplir chaque chemin ; deux à quatre joueurs partagent le
même état sans multiplier les prérequis.

## Reprise et absence de blocage

Chaque transition principale possède un texte de prérequis concret. Les combats de Varkesh,
Morvane, Nhalgor et de l’avatar ont une voie narrative alternative lorsque le combat n’est pas la
seule réponse prévue. Les bassins réinitialisent les deux énigmes ordonnées. La galerie permet de
revenir au champ de bataille, et les quatre raccourcis se débloquent depuis le côté narrativement
logique. Aucune fin ne requiert de vaincre tous les monstres de la guerre.
