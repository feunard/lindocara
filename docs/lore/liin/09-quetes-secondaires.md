# Quêtes secondaires

Les dix-huit quêtes secondaires sont automatiques et abandonnables. Les objectifs dont l’ordre est
imposé par une porte restent séquentiels ; les enquêtes dont les indices sont accessibles dans
plusieurs ordres sont simultanées, afin qu’une découverte précoce ne soit jamais perdue. Leurs
activités sont émises par les événements qui changent déjà l’état du monde : la récompense
narrative est appliquée sur place, tandis que la quête accorde expérience et or.

## Aubeval et faubourg

- `0010` **Trois places vides** — inspecter l’unique événement des trois maisons murées. Il consigne
  trois absences différentes et pose `0062`, Civils sauvés et Fragments Liin. Il ne prétend pas
  que les absents sont vivants.
- `0011` **La digue et la fièvre** — décider à la Vanne des Tisserands entre travail humain et prix
  de la Source. Les deux options stabilisent la digue avec des coûts différents.
- `0012` **Les maisons réquisitionnées** — copier le plan des saisies à Aubeval, puis évacuer la rue
  du Four dans le faubourg. Les deux faits relient l’ordre administratif à ses victimes.

## Relais et Bois

- `0013` **Le relais des quatre dettes** — ouvrir dans l’ordre libre les tables du grain, du
  passage, des noms et de la veille. Chaque table émet sa propre activité ; la quatrième pose
  `0011` et ouvre la borne rapide Aubeval–Relais (`0058`).
- `0014` **Les étrangers de l’hiver** — copier les deux couches de l’écorce où « étrangers » fut
  remplacé par « volontaires ». Pose `0064`, Mémoire et Preuves.
- `0015` **Deux lois sous les feuilles** — lire l’événement des trois systèmes de marques, puis
  choisir Sève ou Écorce. La quête montre le coût territorial du choix principal.
- `0016` **Ce que Morvane retient** — accomplir le rite, puis statuer sur Morvane. Cette quête
  partage les activités de l’acte principal afin que combat et négociation restent tous deux
  faisables.

## Marais et Archives

- `0017` **Les voix empruntées** — rendre sa voix à Mila, puis consigner les trois fragments placés
  sur des îlots distincts. L’objectif `fragment_marais` a une cible de trois.
- `0018` **Une digue sans miracle** — choisir à la Digue des Saules entre équipes réparties et vanne
  royale. Le texte nomme immédiatement la rive qui supporte le risque.
- `0019` **La faute de Talen** — après le sort des Archives, entendre son aveu complet et choisir
  procès public ou réparation surveillée.

La poterne Marais–Citadelle n’est pas une récompense abstraite de quête : elle est levée depuis la
Citadelle, pose `0060`, puis devient un aller-retour conditionnel.

## Citadelle et Fort

- `0020` **Les lettres des conscrits** — classer le sac postal et organiser son départ. Un seul
  événement représente le travail collectif ; il ne demande pas trois interactions identiques.
- `0021` **Les brasiers retournés** — saisir le dépôt inquisitorial, distribuer les soins et
  conserver l’ordre de brûler les archives comme preuve.
- `0022` **Le procès de Sael** — décider dans la cour ancienne de rompre maintenant le serment des
  morts ou d’en reporter la rupture. Les deux branches émettent `delivrer_morts`, avec des scores
  opposés.

## Sanctuaire et Crypte

- `0023` **Les jardins qui nourrissent** — réduire le canal avec réserves organisées ou maintenir
  son débit jusqu’après la guerre. Les deux branches préservent les jardins et rendent leur prix
  public.
- `0024` **Les bibliothèques jumelles** — réunir les catalogues, puis lire le conduit des
  prélèvements. La seconde activité est aussi une étape de la quête principale.
- `0025` **Le neuvième chariot** — examiner le chariot muré et ses bracelets. L’événement confirme
  l’origine commune des Sans-Sceau sans définir leur personnalité.

## Guerre et dessous

- `0026` **Ceux qui tiennent le front** — engager les réserves sur un secteur. Vaincre l’avatar de
  Varos est un objectif `defeat-target` explicitement facultatif, crédité au groupe proche.
- `0027` **Le chemin des serviteurs** — ouvrir le conduit, puis les trois ancres. Les portes qui
  attribuent tous les prix à un souverain renvoient au début, sans effacer les ancres déjà posées.

## Effets différés visibles

Les quêtes secondaires alimentent les scores utilisés par les fins et les pages conditionnelles de
l’épilogue : familles sauvées, dispensaire, archive ambulante, table des dettes et brume résiduelle.
Les routes `0058` à `0061` restent des événements de monde explicites, jamais des récompenses
invisibles ajoutées par le journal.
