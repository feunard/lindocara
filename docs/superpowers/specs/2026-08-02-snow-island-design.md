# L'île de neige — design

Date : 2026-08-02
Statut : validé en brainstorming, prêt pour le plan d'implémentation

## Objectif

Ajouter au labo une **quatrième île, gelée, au nord**, dont la quasi-totalité des assets est
**générée localement** par le studio `~/git/pixel-art-model` : surfaces de tileset, sprites, sons,
voix et musique. Elle sert deux buts à la fois — une zone jouable avec ses propres règles (la glace
glisse, la neige freine, la glace fine cède), et la première mise à l'épreuve du studio d'assets sur
un biome entier.

Elle exerce aussi trois mécaniques que le vrai jeu réclamera : un **modèle de déplacement à
friction**, des **zones** qui portent leur ambiance, et une **musique déclenchée à l'entrée**.

## Décisions de cadrage

| Sujet | Décision |
| --- | --- |
| Emplacement | **Quatrième île au nord**, dans le monde existant. Hors de portée à pied : on y va à la nage, comme chez Grota. |
| Tileset | **Surface générée, géométrie conservée.** On part du tileset Tiny Swords, dont la découpe 4×4 et les raccords sont exacts, et on ne génère que l'apparence. Un modèle de diffusion ne produit pas des raccords au pixel près. |
| Repli tileset | Re-teinte procédurale, **décidée sur capture** et non par principe. |
| Déplacement | **Un seul modèle à friction variable**, pas deux systèmes côte à côte. |
| Glace fine | État par case, qui **regèle** après un délai — un trou définitif empêche de réessayer. |
| Zones | Une zone porte musique, nappe d'ambiance **et** taux de souffle. |
| Revue des assets | **Humaine, obligatoire, par artefact.** Le studio prouve sa plomberie, pas qu'un son ressemble à ce qu'il prétend. |

## Les matières

`TerrainMaterial` passe de deux valeurs à cinq : `sable | herbe | neige | glace | glace-fine`.

C'est tout ce que le mailleur de terrain a besoin de savoir : il choisit déjà son atlas par matière
(`materialAt` → `atlases`, `apps/lab/src/main.ts`), donc les nouvelles surfaces sont des entrées
supplémentaires dans un objet qui existe. **Le terrain n'oblige à toucher aucune ligne de
`@lindocara/hd2d`.** C'est précisément l'indirection pour laquelle le mailleur a été écrit, et cette
île en est le premier usage réel.

### Ce qui, en revanche, touche bien `hd2d`

Deux effets de la liste d'ambiance vivent dans le moteur, pas dans le labo, et il faut le savoir
avant d'écrire le plan :

- **les aurores boréales** sont dans `packages/hd2d/src/sky.ts` et son `SkyShader` — c'est là que
  vivent le dégradé, le halo et les étoiles procédurales ;
- **le pulse du blizzard** passe par le brouillard, dont le mélangeur d'ambiances (`mood.ts`) porte
  la portée.

Les deux se font **par extension de l'ambiance existante**, pas par un cas particulier « neige » :
`hd2d` ne doit à aucun moment apprendre qu'un biome de neige existe. Une aurore est un canal
d'ambiance de plus, comme `stars` en est déjà un.

## Le déplacement — un modèle, trois frictions

Aujourd'hui l'entrée fixe la vitesse : on va à `HERO.speed` ou on est arrêté. Pour que la glace
glisse il faut de l'inertie, et plutôt que d'ajouter un cas particulier, **le modèle est remplacé** :

```
vitesse += entrée · accélération · dt
vitesse *= exp(−friction(matière) · dt)
```

- **herbe** — friction assez haute pour que le comportement soit **indiscernable de l'actuel** ;
- **neige** — friction plus haute encore, et vitesse de pointe réduite : on peine ;
- **glace** — friction quasi nulle : on garde son élan, tourner dérape, on ne s'arrête pas net. **On
  garde le contrôle**, et c'est voulu.

Un seul modèle et trois nombres valent mieux que deux systèmes qui cohabitent, et la neige profonde
sort gratuitement de la même équation.

### La glisse verrouillée : essayée, puis abandonnée (2026-08-03)

Une variante a été implémentée puis **annulée le même jour**, et la trace en vaut la peine.

L'idée était la règle de Pokémon Argent : entrer sur la glace **verrouille la direction**, l'entrée
est ignorée, on file en ligne droite jusqu'à buter — l'objectif étant de rendre possibles des
**énigmes de glace**. Elle a été livrée, testée, et jouée.

**Verdict de l'auteur, après essai : « c'est nul. »** Retour à la glisse qu'on maîtrise un peu.

Ce qu'on en retient :

- **La glisse contrôlée est plus agréable à jouer** qu'un déplacement contraint, même quand le
  déplacement contraint permet des énigmes. Le plaisir du mouvement l'a emporté sur le potentiel de
  conception.
- **Le labo a fait exactement ce pour quoi il existe** : la variante a été construite, jouée, jugée
  et jetée en quelques heures, sans toucher au jeu. C'est moins cher que d'en débattre.
- La règle pure (`glissementSuivant`), ses onze tests et le tracé de butoirs sont dans l'historique
  git (commits `80429f79` et `2f78f890`, annulés par `56e47b38`) si l'idée revient un jour.

**Le son de glisse reste**, piloté par l'intensité du dérapage : nul quand la vitesse est alignée
avec l'entrée, maximal quand elle en diffère. C'est lui qui rend la glisse lisible à l'oreille.

**La contrainte qui pin cette section :** à la friction de l'herbe, une même séquence d'entrées doit
produire la même trajectoire qu'aujourd'hui, à epsilon près. C'est un test, pas une intention — sans
lui, « indiscernable » n'est qu'une affirmation.

### Ce que ça engage pour S2

Ces règles sont exactement celles qui remontent dans `@lindocara/engine` en S2 pour devenir
**autoritatives côté serveur et partagées avec la prédiction réseau** (voir
[le spec du reboot](./2026-08-02-hd2d-reboot-design.md), section « Ce que S1 a appris sur S2 »).
Introduire l'inertie ici, c'est décider que le jeu aura de l'inertie.

C'est un avantage assumé : le labo existe pour essayer une règle de déplacement avec un retour
visuel **avant** qu'elle ne devienne intouchable. Mais c'est une décision de conception du jeu, pas
un détail de biome, et le plan de S2 devra en tenir compte — l'inertie change ce que la prédiction
doit rejouer.

## La glace fine

Un état par case, en trois temps : **intacte** → **craquelée** sous le poids (elle craque, on a le
temps de partir) → **rompue**, on tombe à l'eau.

Elle **regèle** après un délai. Dans un labo, un trou définitif empêche de réessayer — et réessayer
est tout ce qu'on y fait.

C'est la partie la plus invasive du chantier : elle touche l'eau et le souffle. **C'est aussi la
première à couper** si le reste dérape.

## Les zones

Une zone est une région nommée qui porte son ambiance :

```ts
{ centre, rayon, musique, nappe, souffle }
```

À chaque frame on détermine dans quelle zone est le héros ; au changement, **fondu croisé** — et
`apps/lab/src/core/audio.ts` a déjà ce fondu, il sert au basculement jour/nuit. La musique de zone
n'est donc pas une mécanique neuve, c'est le même fondu piloté par la position au lieu de l'heure.

La zone polaire porte aussi le **taux de souffle** : l'eau glacée le consomme deux fois plus vite.
Une seule notion explique la musique, le vent et la noyade plus rapide.

**Ce n'est pas propre à la neige.** Une zone qui réclame son thème est exactement ce dont le vrai
jeu aura besoin ; la construire ici, c'est la construire une fois.

## L'ambiance

- **Souffle visible** du héros, cadencé comme les pas. C'est ce qui dit « il fait froid » mieux que
  tout le reste, pour trois lignes de particules.
- **Chutes de neige** — `createParticleField` existe, c'est un jeu de réglages.
- **Blizzard** — le brouillard pulse par rafales ; la mécanique de bourrasque des props se réutilise
  telle quelle.
- **Aurores boréales** la nuit, dans le shader de la voûte, à la place des étoiles.
- **Traces de pas** dans la neige, qui s'effacent lentement.
- **Source chaude fumante** — pendant exact du feu de camp : une flaque de lumière chaude au milieu
  du blanc, avec de la vapeur. Le point de repos de la zone, et sa seule couleur.

## Le PNJ

Un habitant de la banquise, doublé, sur la machinerie de Grota **telle quelle** : sprite d'attente,
quatre répliques, le bandeau qui se cale sur la durée de la prise. Rien de neuf à écrire — c'est un
second contenu dans un système qui en attend un.

## Les assets générés

Une quinzaine d'artefacts, tous par `python3 studio.py` depuis `~/git/pixel-art-model`, avec `--out`
pointant directement dans `apps/lab/assets/` (voir la section « Generating assets » de l'`AGENTS.md`
racine) :

| Voie | Artefacts |
| --- | --- |
| sprite | deux surfaces de tileset (neige, glace), sapin enneigé, stalagmite, le PNJ |
| sfx | pas dans la neige, pas sur la glace, glisse, craquement, rupture, plouf glacé, rafale, nappe de vent polaire |
| music | le thème de la zone |
| voice | quatre répliques du PNJ |

Aux vitesses mesurées sur cette machine, c'est de l'ordre de dix minutes de calcul.

**Chaque artefact demande un œil et une oreille.** Le studio le dit lui-même : `doctor` prouve la
plomberie, il ne peut pas dire si un bêlement ressemble à un mouton. C'est une étape du plan, pas une
case à cocher — et le repli du tileset se décide là, sur capture.

Tout ce que le studio produit est sous licence Apache 2.0 ou MIT et donc distribuable ; le tileset
dérivé reste soumis aux termes du pack de Pixel Frog.

## Risques

- **La surface de tileset générée peut ne pas se lire comme de la neige** à l'échelle du jeu, où une
  case fait 64 px et où le tilt-shift floute l'arrière-plan. Repli : re-teinte procédurale.
- **L'inertie change le modèle de déplacement** dont S2 hérite. Assumé, mais c'est ce qu'il faut
  retenir de ce chantier bien plus que la neige.
- **La glace fine touche l'eau et le souffle** — la partie la plus invasive, et la première à
  couper.
- **La revue des assets ne s'automatise pas.** Quinze artefacts à juger un par un ; en sous-estimer
  le coût, c'est livrer un biome qui sonne faux.

## Hors périmètre

- Les autres îles ne changent pas. Le labo reste par ailleurs le témoin du PoC.
- Rien de ceci ne touche le jeu : `renderer`, `client`, `editor` et `server` ne sont pas concernés.
- Le portage de ces règles dans `@lindocara/engine` appartient à S2, pas à ce chantier.
