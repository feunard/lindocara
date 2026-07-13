# Navigation des monstres

## Solution choisie

La navigation utilise une grille générée par zone et un A* incrémental en quatre directions. Ce
choix réutilise directement les rectangles de `TerrainGeometry`, qui restent la vérité autoritaire
de la carte, sans introduire un navmesh ou un moteur générique disproportionné. Les quatre voisins
interdisent les coupes de coin et chaque arête est échantillonnée avec la taille réelle d'une
entité. `resolveTerrain()` reste appliqué à chaque déplacement : un chemin ne remplace jamais la
collision finale.

La configuration est portée par `ZoneDefinition.navigation`. Verdant Reach emploie des cellules de
48 px ; la zone de test, plus petite, emploie 40 px. La grille est créée dans le Durable Object de
la room à partir de `zone.terrain`, puis conservée avec le cache et la file de calcul dans cette
room. Aucun état mutable de navigation n'est global.

## Cache, invalidation et budget

- Cache LRU simple de 128 chemins, indexé par cellule de départ et d'arrivée.
- Une cible doit se déplacer d'au moins 72 px avant d'invalider sa destination.
- Deux demandes pour la même cible sont espacées d'au moins 650 ms.
- Une nouvelle cible de menace invalide immédiatement l'ancienne demande.
- Une seule demande par monstre reste dans la file, limitée à 48 entrées.
- Le budget est de 180 nœuds A* développés par tick dans Verdant Reach et 96 dans la zone de test.
- Une recherche individuelle est limitée à 2 400 nœuds et peut continuer sur plusieurs ticks.
- Le comportement de secours attend le chemin sans avancer à travers l'obstacle. Une file pleine
  ou un monstre bloqué invalide le chemin et provoque un nouvel essai espacé.

Verdant Reach représente environ 5 900 cellules avant filtrage. Le plafond théorique est donc
3 600 développements de nœuds par seconde à 20 Hz, indépendamment du nombre de monstres. Une
réponse trouvée dans le cache ne consomme aucun développement A*.

## États et abandons

Les états sont `idle`, `patrol`, `chase`, `return`, `waiting_path` et `unreachable`.

- La patrouille choisit une destination stable pendant 60 ticks pour éviter les oscillations tout
  en continuant son circuit autour du point d'apparition.
- Une ligne de vue libre utilise un trajet direct ; sinon le monstre suit les centres des cellules.
- La cible de menace la plus élevée déclenche `chase` et un changement de cible recalcule le chemin.
- Une cible à plus de 1 100 px, morte, déconnectée, en zone sûre ou dont la menace expire est
  abandonnée.
- Une recherche impossible retire sa menace et ignore cette cible pendant cinq secondes.
- Sans cible, un monstre déplacé par une poursuite revient d'abord à son point d'apparition, puis
  reprend sa patrouille.
- Vingt ticks sans progrès invalident le chemin avec la raison `stuck`.

## Ajouter une zone

Déclarer la géométrie autoritaire et la configuration dans `shared/zones.ts` :

```ts
navigation: {
  ...DEFAULT_ZONE_NAVIGATION,
  cellSize: 48,
  nodeBudgetPerTick: 180,
}
```

Le moteur ne contient aucun branchement par identifiant de zone. Une zone très dense peut réduire
la cellule pour la précision et ajuster son budget après mesure. Les points d'apparition et les
objectifs doivent rester sur une cellule connectée et praticable.

## Diagnostic de développement

Définir `NAVIGATION_DEBUG="true"` dans `.dev.vars`, démarrer le serveur local puis ouvrir le jeu
avec `?navdebug=1`. Le client demande alors explicitement les données de diagnostic. Le rendu
affiche le chemin, ses nœuds, la destination, l'état et la dernière raison d'abandon. Sans la
variable Worker, le message est ignoré ; la production ne configure pas cette variable et
n'émet donc aucune donnée de navigation.

## Limites

- Les obstacles sont statiques ; les joueurs et les autres monstres ne modifient pas la grille.
- Il n'y a pas encore d'évitement collectif ni de séparation de foule.
- Le cache exact par cellules aide surtout les retours, patrouilles et destinations partagées ; il
  ne cherche pas à fusionner des chemins partiellement identiques.
- Le choix du plus petit score dans l'ensemble ouvert reste linéaire. Les budgets actuels le
  bornent ; un tas binaire ne devient pertinent qu'avec des cartes ou budgets nettement supérieurs.
