# Le rendu HD-2D â€” ce qui fait le style, et les piÃ¨ges

Sprites pixel art plantÃ©s dans une vraie scÃ¨ne 3D Ã©clairÃ©e â€” la recette d'Octopath
Traveler et de The Adventures of Elliot, appliquÃ©e aux assets **Tiny Swords**
(Pixel Frog). Three.js, pas de moteur.

> **Origine.** Ce document est le carnet de bord du PoC `poc-hd-2d`, Ã©crit pendant que le rendu se
> cherchait, puis rapatriÃ© ici quand le chantier S1 a portÃ© ce PoC en `@lindocara/hd2d` et
> `apps/lab` (voir [le spec du reboot](./superpowers/specs/2026-08-02-hd2d-reboot-design.md)). Le
> dÃ©pÃ´t d'origine n'existe plus ; les chemins ci-dessous ont Ã©tÃ© repointÃ©s vers le code portÃ©.
>
> **C'est un registre de piÃ¨ges autant qu'une explication.** Chaque section dit ce qui a Ã©tÃ©
> essayÃ© et n'a pas marchÃ©, la mesure qui a tranchÃ©, et pourquoi un rÃ©glage vaut ce qu'il vaut.
> S3 (le renderer du jeu) et S5 (la scÃ¨ne de l'Ã©diteur) le reliront autant que S1 l'a fait.
>
> **S3's first increment has landed** (2026-08-04): the game itself now draws through this engine and
> the PixiJS renderer is deleted. What that file knew, and what the port cost, is the section
> [The game's renderer](#the-games-renderer--what-retiring-pixijs-cost-and-taught) near the end.
> It is written in English â€” the repository's language rule applies to everything written from now
> on; the French sections above stay as they were written.

![jour](hd2d/day.png)
![nuit](hd2d/night.png)

## Lancer

```bash
npm run lab
```

| EntrÃ©e | Effet |
| --- | --- |
| `ZQSD` / `WASD` / flÃ¨ches | dÃ©placer le hÃ©ros |
| `espace` | sauter |
| `1` | attaquer â€” un coup d'Ã©pÃ©e, sans consÃ©quence pour l'instant |
| `N` | jour â†” nuit |
| molette | zoom |
| clic droit + glisser | pivoter la camÃ©ra (Â±20Â°, revient seule au relÃ¢chement) |
| `F` | parler â€” Ã  Grota, le panda de la petite Ã®le du sud |
| `Ã©chap` | couper court Ã  la conversation |
| clic sur un mouton | il bÃªle â€” et si vous insistez, il Ã©clate |
| `B` | afficher les volumes de collision |
| `H` | masquer le bloc d'aide |
| `M` | couper le son |
| entrer dans l'eau | on nage : plus lent, pas de saut, souffle comptÃ© |

Le curseur est celui du pack (`UI/Pointers`), et il passe Ã  la **main** au survol
d'un mouton â€” la seule chose cliquable de la scÃ¨ne. Le menu contextuel de Chrome
est supprimÃ© sur le canvas, puisque le clic droit y sert Ã  pivoter ; il reste
disponible partout ailleurs dans la page.

Le rendu est plafonnÃ© Ã  60 fps (`TARGET_FPS` dans `apps/lab/src/settings.ts`) : au-delÃ  on
brÃ»le du GPU pour rien, la vitesse de jeu ne bouge pas â€” tout est en delta-time.

## Le chargement

Tout est tÃ©lÃ©chargÃ© et dÃ©codÃ© avant que la scÃ¨ne ne se construise, et le
pourcentage est **pesÃ© en octets** (`packages/hd2d/src/loader.ts`), pas en nombre de
fichiers : une nappe d'ambiance pÃ¨se 700 ko quand un bruit de pas en fait 30.
Compter les fichiers aurait fait filer la barre Ã  90 % en une fraction de seconde
puis l'aurait laissÃ©e coincÃ©e lÃ  tout le reste du temps â€” la barre de progression
qu'on ne veut pas. Les en-tÃªtes HTTP reviennent bien avant les corps,
donc le total est connu dÃ¨s le dÃ©part et le pourcentage ne recule jamais. Le
tÃ©lÃ©chargement pÃ¨se 85 %, le dÃ©codage â€” images vers textures, OGG vers tampons
audio â€” les 15 derniers.

Vient ensuite un bouton **JOUER**, et il n'est pas dÃ©coratif : un navigateur
n'autorise le son qu'aprÃ¨s un geste, et il n'y en a aucun au chargement d'une
page. Sans lui, la scÃ¨ne dÃ©marrait muette jusqu'Ã  ce qu'on touche une touche par
hasard â€” et le plus souvent on ne remarquait mÃªme pas ce qui manquait. Le
contexte audio, lui, naÃ®t suspendu : c'est justement ce qui permet de tout
dÃ©coder pendant le chargement et de n'avoir plus qu'Ã  le rÃ©veiller au clic.

La boucle de rendu, elle, tourne **derriÃ¨re** l'Ã©cran de chargement : le premier
plan est dÃ©jÃ  cadrÃ© et les shaders dÃ©jÃ  compilÃ©s, si bien que le voile se lÃ¨ve
sur une image vivante et non sur une frame noire.

## Ce qui fait le style

Le pixel art ne fait pas le HD-2D : ce sont les couches en dessous.

| IngrÃ©dient | OÃ¹ |
| --- | --- |
| **DÃ©cor en vraie 3D** â€” chaque tuile est un bloc, les falaises sont des parois | `packages/hd2d/src/terrain/mesh.ts` |
| **Autotiling** â€” les bordures organiques du pack, choisies par masque de voisinage | `packages/hd2d/src/terrain/mesh.ts` |
| **Un tileset par palier** â€” l'altitude se lit Ã  la teinte de l'herbe | `packages/hd2d/src/terrain/mesh.ts` |
| **Sprites billboardÃ©s** â€” plans strictement verticaux, pivotÃ©s sur les pieds, Ã©tirÃ©s pour compenser la plongÃ©e | `packages/hd2d/src/billboard.ts` |
| **CamÃ©ra quasi-orthographique** â€” FOV 22Â°, 38Â° au-dessus de l'horizon | `CAMERA` dans `apps/lab/src/settings.ts` |
| **Ã‰clairage temps rÃ©el** â€” soleil, hÃ©misphÃ©rique, feu de camp qui vacille, tous avec ombres portÃ©es | `apps/lab/src/main.ts`, `apps/lab/src/world/props.ts` |
| **Ombres reÃ§ues par les sprites** â€” le hÃ©ros s'assombrit sous un arbre, sous un nuage | `packages/hd2d/src/billboard.ts` |
| **Contre-jour** cantonnÃ© aux sprites par un calque : un liserÃ© sur une seule de leurs arÃªtes | `apps/lab/src/main.ts`, `RIM_LAYER` |
| **Occlusion de contact** en vertex color â€” le pied des falaises, le creux des marches | `packages/hd2d/src/terrain/mesh.ts` |
| **Ombres de nuages** â€” une couverture qui dÃ©rive et multiplie l'albÃ©do, dÃ©cor **et** sprites | `packages/hd2d/src/clouds.ts` |
| **Mer Ã  profondeur** â€” turquoise sur les hauts-fonds, bleu au large, quatre houles analytiques pour la normale | `packages/hd2d/src/terrain/mesh.ts` |
| **Ã‰cume animÃ©e** glissÃ©e sous les cases de terre du rivage | `packages/hd2d/src/terrain/mesh.ts` |
| **Rafales de vent** â€” la phase d'oscillation se dÃ©duit de la position, la bourrasque traverse l'Ã®le | `apps/lab/src/world/props.ts` |
| **Braises, lucioles, pollen** â€” des points additifs pour meubler le vide entre les sprites | `packages/hd2d/src/particles.ts` |
| **Fondu jour â†” nuit** de toute l'ambiance, couleurs comprises, et azimut du soleil qui dÃ©rive | `packages/hd2d/src/mood.ts` |
| **Nuit noire** â€” loin du feu, il n'y a plus rien : c'est la source posÃ©e qui Ã©claire, pas le ciel | `MOODS.night` dans `apps/lab/src/settings.ts` |
| **Tilt-shift** â€” flou gaussien sÃ©parable pilotÃ© par la position verticale Ã  l'Ã©cran. C'est *la* signature | `packages/hd2d/src/shaders.ts` |
| **Bloom + Ã©talonnage + vignette + MSAA** | `packages/hd2d/src/pipeline.ts` |

La bande nette du tilt-shift suit le hÃ©ros Ã  l'Ã©cran : il reste net oÃ¹ qu'il aille.

Le brouillard suit le zoom â€” rÃ©glÃ© en dur, il noierait l'Ã®le dÃ¨s qu'on recule â€”
mais **pas des deux cÃ´tÃ©s Ã  la mÃªme vitesse**. Le suivre Ã  l'identique rendrait
le dÃ©zoom parfaitement neutre : la mÃªme image, en plus petit. Le plan proche
reste donc proportionnel, si bien que le hÃ©ros garde exactement sa nettetÃ© Ã 
tous les zooms, pendant que le plan lointain grandit moins vite
(`CAMERA.fogFar = 0.38`). La bande se resserre Ã  mesure qu'on recule : l'Ã®le se
dissout par les bords et la maquette gagne son lointain. Le rayon du tilt-shift
suit la mÃªme intention (`zoomBoost`). Ã€ la distance de rÃ©fÃ©rence, les deux
n'ont aucun effet : la vue par dÃ©faut est inchangÃ©e.

Il y a bien une **voÃ»te cÃ©leste** (`packages/hd2d/src/sky.ts`) â€” dÃ©gradÃ©, halo de
l'astre, Ã©toiles procÃ©durales â€” mais autant le dire : Ã  38Â° de plongÃ©e et 22Â° de
champ, la camÃ©ra regarde de 27Â° Ã  49Â° *sous* l'horizon, Ã  tous les zooms. Le ciel
n'entre jamais dans le cadre. Ce qu'on voit en haut de l'image, c'est la mer
lointaine noyÃ©e dans le brouillard â€” et c'est pour Ã§a que le brouillard prend la
couleur d'horizon de cette voÃ»te : la bande haute devient un vrai horizon
dÃ©gradÃ©. Le reste ne se rÃ©vÃ¨le qu'en redressant `CAMERA.pitch`.

### La nuit

Elle ne se contente pas de teinter la scÃ¨ne en bleu : **loin d'une source, il
n'y a plus rien**. On s'Ã©carte du feu de quelques pas et le hÃ©ros n'est plus
qu'une silhouette ; Ã  l'autre bout de l'Ã®le, c'est du noir.

C'est le modÃ¨le de Minecraft, sans avoir Ã  le simuler. La clartÃ© d'un bloc y
vaut le maximum entre la lumiÃ¨re du ciel â€” au plus bas la nuit â€” et celle des
sources posÃ©es, qui dÃ©croÃ®t avec la distance. Ici la somme des deux fait la mÃªme
chose : un clair de lune ramenÃ© Ã  0.62, juste de quoi qu'une silhouette et une
ombre portÃ©e existent encore, et un foyer dont la dÃ©croissance en 1/dÂ² creuse le
noir dÃ¨s qu'on s'en Ã©carte. Son intensitÃ© nominale est montÃ©e Ã  13 en
compensation : c'est tout ce qu'il y a *autour* qui descend, pas la flaque.

Trois rÃ©glages tiraient dans l'autre sens et il a fallu les corriger :

- le **lift** de l'Ã©talonnage, Ã  0.015, relevait les noirs â€” soit exactement ce
  qu'on ne veut pas ici. Ã€ zÃ©ro ;
- le **contre-jour**, Ã  0.5, dÃ©tourait chaque sprite d'un liserÃ© bleu partout, y
  compris au fond du noir. Ã€ 0.12 ;
- le **brouillard**, dont la couleur d'horizon restait un bleu clair : le
  lointain gardait un halo qu'aucune lumiÃ¨re ne justifiait. L'horizon de nuit est
  descendu Ã  `#080e1e`, et la portÃ©e s'est resserrÃ©e â€” au-delÃ , il n'y a de toute
  faÃ§on plus rien Ã  voir.

Trop bas, Ã§a ne marche pas non plus : Ã  0.34 de lune, l'Ã®le disparaissait
purement et simplement et il ne restait que la flaque du feu dans du vide.

Reste que rendre la nuit noire rend la lumiÃ¨re du foyer d'autant plus visible â€”
et elle se lisait alors comme **un gros rond**. Trois choses le corrigent :

- **une longue traÃ®ne.** Un `createRadialGradient` ne peut donner qu'un disque Ã 
  pente constante, et cette pente rÃ©guliÃ¨re, l'oeil la lit comme un contour. La
  tache est donc fabriquÃ©e pixel par pixel, avec un alpha qui dÃ©croÃ®t en
  puissance 3 : il n'y a plus de rayon oÃ¹ elle Â« s'arrÃªte Â» ;
- **un contour qui ondule.** Le rayon est modulÃ© par trois harmoniques de
  l'angle. Ce n'est plus un cercle, c'est une flaque ;
- **deux couches.** Une seule tache, si douce soit-elle, garde un rayon dominant
  qu'on finit par retrouver. Une petite sous le foyer et une large trÃ¨s diluÃ©e
  par-dessus, de formes, de phases et de vitesses diffÃ©rentes, Ã  poids Ã©gal :
  donner le dessus Ã  la petite lui rend aussitÃ´t son statut de tache principale,
  et le rond revient.

La source elle-mÃªme tremble de quelques centimÃ¨tres au fil du vacillement : les
ombres qu'elle porte bougent, et le bord de la flaque cesse d'Ãªtre une frontiÃ¨re
fixe.

## Grota

Le seul PNJ de la scÃ¨ne : un panda au chapeau de paille (Enemy Pack), plantÃ© sur
le mamelon de la **petite Ã®le du sud**. C'est-Ã -dire lÃ  oÃ¹ l'on ne va qu'Ã  la
nage â€” un ermite qu'il faut aller chercher vaut mieux qu'un ermite sur le
chemin, et Ã§a donne enfin une raison d'aller lÃ -bas.

Il ne fait que deux choses : se balancer, et se tourner vers qui l'approche. Il
porte un collider, on ne lui marche pas dessus.

`F` ouvre le bandeau, `F` dÃ©roule, `Ã©chap` coupe court. Tant que la rÃ©plique
s'Ã©crit, `F` la **termine** ; une fois Ã©crite, elle passe Ã  la suivante â€” la
convention de tous les jeux Ã  dialogues, et elle Ã©vite d'avoir Ã  choisir entre
lire Ã  son rythme et ne pas attendre. S'Ã©loigner referme : un bandeau orphelin Ã 
l'Ã©cran pendant qu'on nage n'aurait aucun sens.

Pendant la conversation, le hÃ©ros est **spectateur** : ni pas, ni saut, ni coup.
Les commandes sont neutralisÃ©es dans la boucle et non dans `hero.js` â€” c'est la
scÃ¨ne qui sait qu'une conversation est en cours, pas le personnage. Le zoom et la
rotation de camÃ©ra, eux, restent libres : ils ne sont pas de son ressort.

Le bandeau n'a pas de cadre : c'est un noir dont les deux bords se fondent dans
la scÃ¨ne. Un rectangle franc poserait une boÃ®te par-dessus le jeu ; le dÃ©gradÃ© le
fait affleurer. Il est centrÃ© horizontalement et **centrÃ© dans la moitiÃ© basse**
de l'Ã©cran â€” son axe tombe donc aux trois quarts de la hauteur. Le bloc d'aide,
qui occupe le mÃªme bas d'Ã©cran, s'efface le temps de la conversation ; c'est une
classe distincte de `hidden`, sinon parler annulerait le choix fait avec `H`.

### Sa voix

Grota est **doublÃ©** : quatre prises, une par rÃ©plique (`assets/voices/`,
converties en Opus mono 56 kbit/s â€” 670 ko de MP3 tombent Ã  265). Elles ne
passent pas par `jouer()`, qui tire une variante et une hauteur au hasard : c'est
exactement ce qu'il ne faut pas faire Ã  une voix.

Le point qui compte, c'est que **c'est la voix qui donne le tempo, pas
l'inverse**. `sayLine()` renvoie la durÃ©e de la prise, et le bandeau en dÃ©duit sa
cadence de frappe : `longueur / durÃ©e`. Une rÃ©plique de neuf secondes Ã©crite Ã 
42 caractÃ¨res par seconde serait finie en une seconde et demie, et le panda
parlerait devant un texte dÃ©jÃ  terminÃ©. Le texte s'achÃ¨ve Ã  88 % de la prise, de
sorte que le chevron apparaisse quand il finit sa phrase et non trois mots plus
tard. Sans prise dÃ©codÃ©e, on retombe sur la cadence fixe.

La **validation** est un Â« toc Â» de bois. Le pack n'a aucun son d'interface â€” que
du combat, des portes et des pas â€” mais un pas sur planche, dÃ©tachÃ© de la marche,
n'est plus qu'un bloc de bois frappÃ© : c'est le son de validation des jeux Ã 
dialogues, et il va bien Ã  un panda en chapeau de paille. On prend les variantes
**sans chaÃ®ne** (le cliquetis d'armure du hÃ©ros n'a rien Ã  faire lÃ ) et on les
monte d'un tiers en hauteur : Ã  leur vitesse d'origine, elles traÃ®naient encore
le poids d'une semelle. Une cloche synthÃ©tisÃ©e marchait aussi, mais elle sonnait
comme une rÃ©compense d'interface au milieu d'une scÃ¨ne qui n'en a aucune.

Il ne sonne qu'au **passage d'une rÃ©plique Ã  la suivante**. Rattraper le texte
d'un coup ne valide rien â€” on n'a pas encore lu la rÃ©plique, on a juste demandÃ© Ã 
la voir en entier â€” et la voix continue. Fermer sur la derniÃ¨re ne sonne pas non
plus. VÃ©rifiÃ© en comptant les sources crÃ©Ã©es dans le contexte audio : ouverture 1
(la voix), rattrapage 0, passage 2 (le toc et la voix suivante).

Enfin, **deux lignes de texte sont rÃ©servÃ©es d'avance**. Le bloc est centrÃ©
verticalement : si sa hauteur change quand le texte passe Ã  la ligne, c'est le
nom au-dessus qui remonte â€” et Â« Grota Â» sursautait en pleine frappe. RÃ©server
2.2em n'en couvrait qu'une et un tiers ; il en faut 3.3 (2 Ã— 1.65).

### Autotiling

Le tileset du Free Pack fait 9Ã—6 cases et contient **deux** blocs 4Ã—4 :

- colonnes 0-3 : herbe bordÃ©e par l'**eau** â€” le liserÃ© blanc y est dÃ©jÃ  peint ;
- colonnes 5-8 : herbe bordÃ©e par un **vide** â€” bordure touffue, faite pour
  coiffer une paroi. C'est celle-lÃ  qu'il faut ici, et les lignes 4-5 en dessous
  portent la paroi de pierre qui s'y raccorde pile.

Chaque bloc est un autotile 4Ã—4 : un carrÃ© 3Ã—3 (coins, bords, centre) plus une
colonne et une ligne pour les bandes d'une seule case de large. Le choix est
**sÃ©parable** â€” la colonne ne dÃ©pend que des arÃªtes ouvertes Ã  l'ouest et Ã 
l'est, la ligne que de celles au nord et au sud :

```js
const axis = (a, b) => (a && b ? 3 : a ? 0 : b ? 2 : 1)
```

Une arÃªte est Â« ouverte Â» face au vide, face Ã  un voisin plus bas, ou face Ã  une
autre matiÃ¨re de mÃªme niveau. Un voisin *plus haut* ne l'ouvre pas : on est au
pied de sa falaise, c'est elle qui porte la bordure.

Les parois suivent la mÃªme logique horizontalement (about gauche, morceau
courant, about droit) et sont dÃ©coupÃ©es en un quad par palier franchi : le
premier porte la retombÃ©e sous l'arÃªte, les suivants une bande rÃ©pÃ©table.

Le pack livre ce tileset en **cinq teintes**. Chaque palier prend la sienne
(`LEVEL_URL`) : l'altitude se lit Ã  la couleur de l'herbe elle-mÃªme, pas Ã  une
correction plaquÃ©e aprÃ¨s coup.

L'Ã©cume suit la mÃªme logique sans Ãªtre un autotile : la tache est centrÃ©e sur la
case de **terre** et glissÃ©e dessous. Le sol la masque partout oÃ¹ il la recouvre,
seul son dÃ©bord dÃ©passe â€” le liserÃ© Ã©pouse donc exactement le dÃ©coupage des
cases. PosÃ©e sur l'eau, elle formait au contraire des pavÃ©s flottant au large.

## DÃ©placement

Le relief se franchit **en sautant** : aucune marche ne se gravit Ã  pied
(`WORLD.maxStep = 0`), et le saut culmine Ã  1.35 unitÃ©, soit un palier (0.9) et
jamais deux. Les descentes, elles, sont libres â€” on tombe, avec de la vraie
gravitÃ©. Un *coyote time* de 120 ms pardonne le saut dÃ©clenchÃ© juste aprÃ¨s avoir
quittÃ© le bord.

Les props ont une empreinte circulaire (`apps/lab/src/world/colliders.ts`), rangÃ©e dans
une grille spatiale. Leur rayon est bien plus petit que le sprite : on bute sur
le tronc de l'arbre, pas sur son feuillage. Chaque axe est testÃ© sÃ©parÃ©ment, ce
qui fait glisser le long des obstacles au lieu de coller.

Le hÃ©ros a **une seule empreinte** (`HERO.radius`), la mÃªme face au relief et
face aux props, mais son centre est **dÃ©calÃ© vers le fond** (`HERO.offset`). Le
sprite est un plan vertical : son corps se dessine vers le haut de l'Ã©cran, donc
vers le fond. Une empreinte centrÃ©e sur ses pieds paraissait posÃ©e devant lui et
le laissait chevaucher les murs situÃ©s derriÃ¨re.

MesurÃ© : 0.47 d'un mur au nord, 0.19 au sud, 0.33 sur les cÃ´tÃ©s.

Le relief est testÃ© sur ce **disque** et non sur le point central
(`terrain.maxHeightAround`) : sinon le personnage enfonce sa demi-largeur dans
les falaises avant d'Ãªtre arrÃªtÃ©. Le rayon doit rester **sous la demi-case** :
au-delÃ , le disque mord en permanence les cases voisines et le hÃ©ros se retrouve
bloquÃ© dÃ¨s qu'un relief le jouxte, quel que soit le cÃ´tÃ©.

Un disque plus large que le dÃ©bord d'une falaise crÃ©e un Ã©tat oÃ¹ l'on est
**dÃ©jÃ ** en faute : en tombant d'un palier, le hÃ©ros atterrit Ã  son pied, disque
mordant encore la case du dessus. Refuser tout dÃ©placement dans cet Ã©tat le
cimente sur place â€” y compris pour s'en Ã©loigner. La rÃ¨gle est donc : un
dÃ©placement est acceptÃ© s'il est valide, **ou** s'il n'aggrave pas un chevauchement
dÃ©jÃ  prÃ©sent. Le sol sous le centre, lui, n'est jamais assoupli, sinon on
gravirait une falaise en la poussant. Les props ont la mÃªme Ã©chappatoire.

AprÃ¨s une chute qui laisse le hÃ©ros Ã  0.32 du mur â€” donc en chevauchement â€”, il
repart Ã  pleine vitesse en s'Ã©loignant et longe la paroi, tout en restant bloquÃ©
vers elle.

## Mode debug

`B` affiche les volumes rÃ©ellement testÃ©s par les collisions, sans les sprites :
contour vert des cases praticables, arÃªtes rouges des marches infranchissables
(avec un montant vertical pour en lire la hauteur), cercles orange des props, et
l'empreinte du hÃ©ros. Quand un dÃ©placement paraÃ®t anormal, c'est lÃ  qu'on voit
pourquoi.

![debug](hd2d/debug.png)

## La nage

L'eau n'est plus un mur : c'est une surface. En y entrant, le hÃ©ros fait un
plouf, s'enfonce sous le plan d'eau â€” qui le masque Ã  mi-corps â€” et un disque
sombre le signale Ã  la surface. Il avance Ã  45 % de sa vitesse, ne saute plus, et
son souffle est comptÃ© (11 s, jauge Ã  l'Ã©cran). Ã€ zÃ©ro il se noie et rÃ©apparaÃ®t au
point de dÃ©part. Depuis l'eau on se hisse sur une rive de plain-pied, jamais sur
une falaise.

C'est ce qui donne son intÃ©rÃªt Ã  la **petite Ã®le du sud** : on ne l'atteint qu'Ã 
la nage. Les Ã®les sont dÃ©crites en coordonnÃ©es monde (`ILES` dans `terrain.js`),
donc agrandir la carte n'en change ni la taille ni la position.

MesurÃ© : 1.89 u/s Ã  la nage contre 4.2 Ã  pied, saut sans effet, noyade puis
rÃ©apparition au point de dÃ©part.

**In the GAME, two of those sentences read differently** (the rule is the same `stepHero`; what
differs is who owns the consequence). Drowning is not a respawn at the starting point: the client
reports a bare `{t:"drowned"}`, the room refuses it unless that client's own position stream has the
hero alive and swimming, and then kills it IN PLACE â€” the body stays where it went under and the
ordinary corpse run brings it back. The game now shows a rounded breath countdown while swimming,
and `window.__lindocara.self()` exposes the raw reserve, maximum and vertical velocity.

## Les moutons

Ils errent au hasard sur leur palier (`apps/lab/src/world/sheep.ts`), font demi-tour
plutÃ´t que de tomber Ã  l'eau, et alternent repos et sautillement. Un clic les
fait bÃªler, de plus en plus aigu ; au quatriÃ¨me, ils Ã©clatent â€” comme les
critters de Warcraft 3.

Chaque mouton a sa hauteur de voix, et elle monte de 1.5 demi-ton Ã  chaque clic.
Le bÃªlement Ã©tait synthÃ©tisÃ© faute de mouton dans le pack ; ce sont maintenant
**quatre prises maison**, de 0.97 s Ã  1.97 s â€” un bÃªlement n'a pas de durÃ©e
standard, et c'est tant mieux.

C'est ce passage Ã  de vraies prises qui a fait descendre le pas de 2.5 Ã  1.5
demi-ton : transposer un enregistrement coÃ»te bien plus cher qu'une dent de scie.
Au troisiÃ¨me clic, l'ancien pas montait le mouton de 7.5 demi-tons, soit une
lecture Ã  1.55x â€” un dessin animÃ©, plus un animal. Effet de bord bienvenu : une
transposition par la vitesse raccourcit le son d'autant, donc un mouton pressÃ©
bÃªle plus court.

## Le son

Ã‰chantillons du **Free Fantasy SFX Pack de TomMusic**, jouÃ©s par WebAudio
(`apps/lab/src/core/audio.ts`). Les pas prennent les variantes **Â« Chain Â»** : le hÃ©ros
porte une armure, et le cliquetis fait la moitiÃ© du travail.

- **pas** â€” cadencÃ©s Ã  la distance parcourue (un tous les 1.2 unitÃ©), pas au
  temps : la cadence suit donc la vitesse et ne se dÃ©rÃ¨gle pas. Terre battue sur
  l'herbe, version sans armure et plus discrÃ¨te sur le sable.
- **saut / rÃ©ception** â€” le poids de la rÃ©ception suit la vitesse de chute.
- **attaque** â€” le sifflement de lame seul, jamais un impact : le hÃ©ros frappe
  dans le vide. Ces Ã©chantillons n'ont **aucun transitoire d'attaque**, ils
  enflent pendant 170 ms jusqu'Ã  une crÃªte â€” et c'est cette crÃªte que l'oreille
  prend pour le coup. Le son part donc 30 ms aprÃ¨s l'appui, *avant* la sortie de
  lame : sa montÃ©e couvre l'armement et culmine sur la bonne image. CalÃ© sur la
  frame de frappe, il culminait aprÃ¨s la fin du geste, et Ã§a s'entendait. Le
  troisiÃ¨me Ã©chantillon montait 115 ms plus lentement que les deux autres et
  faisait traÃ®ner une attaque sur trois : `sync-assets.sh` lui rogne sa montÃ©e
  pour aligner les trois crÃªtes.
- **bÃªlement** â€” quatre prises maison, le pack n'ayant pas de mouton. Elles
  arrivaient rendues sur 2.04 s chacune, bÃªlement puis longue queue de rÃ©verbe,
  et aucune ne commenÃ§ait au mÃªme endroit : `sync-assets.sh` les taille une par
  une. La troisiÃ¨me dÃ©marrait *en plein son* et claquait Ã  chaque clic â€” c'est
  son fondu d'entrÃ©e qui l'Ã©teint.
- **eau** â€” entrÃ©e, sortie, et une brasse toutes les 0.85 s tant qu'on avance.
- **ambiance** â€” forÃªt de jour et forÃªt de nuit en fondu croisÃ© sur la touche
  `N`, plus une nappe de mer constante en dessous.
- **feu de camp** â€” boucle de torche attÃ©nuÃ©e par la distance au hÃ©ros (0.5 au
  contact, 0 au-delÃ  de 13 unitÃ©s). Pas de vrai panner : une attÃ©nuation suffit
  et ne coÃ»te qu'un gain.
- **musique** â€” **aucune piste pour l'instant** : les arrangements essayÃ©s
  Ã©taient sous droits, ce qui va pour bricoler en local mais pas pour servir
  depuis une URL publique. `M` rÃ©pond Â« aucune piste Â» et le HUD n'annonce rien.

  La mÃ©canique, elle, est entiÃ¨re : dÃ©poser des fichiers dans `public/music/` et
  les dÃ©clarer dans `MUSIQUE` (`audio.js`) suffit Ã  la rallumer. Elle attend deux
  arrangements, un par heure du jour â€” une piste unique se dÃ©clare deux fois avec
  la mÃªme URL. La musique entre 10 s aprÃ¨s le premier geste, en fondu de 6 s,
  joue jusqu'au bout puis se tait 30 s avant de repartir : une boucle sans
  respiration s'entend au bout de deux tours, une pause non. Comme les deux
  arrangements n'ont pas forcÃ©ment la mÃªme durÃ©e, **un seul joue Ã  la fois** :
  changer d'heure reprend l'autre au mÃªme endroit du morceau, en fondu croisÃ© de
  2.5 s. Les faire tourner en phase laisserait la version nuit jouer aprÃ¨s la fin
  de l'autre, puis se superposer Ã  la relance.

Chaque dÃ©clenchement tire une variante au hasard **et** une hauteur lÃ©gÃ¨rement
diffÃ©rente. Sans Ã§a, cinq Ã©chantillons en boucle s'entendent au bout de dix
secondes.

Le dÃ©codage dÃ©marre au chargement mais reste muet : un navigateur n'autorise le
son qu'aprÃ¨s un geste. Tant qu'un Ã©chantillon n'est pas dÃ©codÃ©, il ne se joue
simplement pas â€” rien ne bloque la scÃ¨ne.

### Deux ou trois piÃ¨ges rencontrÃ©s

- **Un quad ne projette pas d'ombre par dÃ©faut.** Three.js rend les faces
  *arriÃ¨re* dans la shadow map pour Ã©viter l'acnÃ© ; un plan simple n'en a pas, donc
  rien n'est Ã©crit. D'oÃ¹ `shadowSide: DoubleSide` sur les sprites *et* sur le sol.
- **Pencher un sprite vers la camÃ©ra l'enfonce dans ce qu'il y a derriÃ¨re.**
  Face Ã  une camÃ©ra qui plonge, Â« faire face Â» revient Ã  se coucher en arriÃ¨re :
  le sommet part vers le fond, et un hÃ©ros au pied d'une falaise disparaissait
  dedans. Les sprites sont donc strictement verticaux, et l'Ã©crasement dÃ» Ã  la
  plongÃ©e est compensÃ© par un **Ã©tirement** (`SPRITE_STRETCH`).
- **Toutes les frames d'une feuille ne sont pas une animation.** Celle de
  l'arbre contient le balancement (4 frames), la rÃ©action quand on l'abat, et la
  souche ; les buissons sont rembourrÃ©s de doublons de la premiÃ¨re frame. Les
  jouer bout Ã  bout donne des Ã -coups. ComptÃ© sheet par sheet, par diffÃ©rence
  de pixels.
- **Une ombre peinte dans la feuille ne fonctionne qu'Ã  plat.** Sur un sprite
  vertical elle se dresse elle aussi, Ã©crasÃ©e derriÃ¨re les pieds. Inutile de la
  remplacer par un dÃ©calque au sol : le sprite projette dÃ©jÃ  une vraie ombre via
  la shadow map, et un dÃ©calque en plus ne fait qu'ajouter un disque sombre sous
  le personnage. Le seuil d'alpha Ã  0.5 supprime l'ombre peinte, la shadow map
  fait le reste â€” et le saut reste lisible, l'ombre s'Ã©cartant d'elle-mÃªme.
- **Un `alphaTest` est binaire : il ne restitue pas la semi-transparence, il la
  force Ã  plein.** Descendu Ã  0.25 pour rÃ©cupÃ©rer les pixels fins, il a transformÃ©
  l'ombre douce peinte au pied de chaque sprite en une tache opaque Ã  bord franc
  â€” une tache figÃ©e qui ne suivait aucune lumiÃ¨re. RemontÃ© Ã  0.5 : elle disparaÃ®t,
  et tout le dÃ©cor porte dÃ©sormais sa vraie ombre projetÃ©e.
- **Un sprite plat s'Ã©teint sous une lumiÃ¨re zÃ©nithale.** Les normales du plan
  regardent la camÃ©ra, pas le ciel. Elles sont donc bombÃ©es Ã  la main
  (gauche/droite/haut) pour que le sprite rÃ©agisse comme un volume.
- **â€¦et il s'Ã©teint complÃ¨tement dÃ¨s qu'une source passe derriÃ¨re lui.** Le
  hÃ©ros Ã  deux pas du feu, dos Ã  la flamme, devenait noir : son plan regarde la
  camÃ©ra, la lumiÃ¨re vient de l'autre cÃ´tÃ©, le produit scalaire est nÃ©gatif. Rien
  Ã  redire physiquement, et complÃ¨tement faux Ã  l'oeil â€” on le voit prÃ¨s du feu,
  on attend qu'il soit Ã©clairÃ©. Aucun rÃ©glage de lumiÃ¨re n'y change quoi que ce
  soit, et les demi-lambert non plus : Ã  contre-jour franc le scalaire vaut
  -0.97, un Â« wrap Â» mÃªme total en tire 1 %. L'appoint est donc calculÃ© Ã  la
  main (`fillFromPointLight`) et donnÃ© au matÃ©riau en **Ã©missif**, proportionnel
  Ã  ce que la vraie lumiÃ¨re RATE : lÃ  oÃ¹ le sprite fait face Ã  la flamme il vaut
  zÃ©ro, et c'est la lumiÃ¨re ponctuelle qui joue, avec ses ombres portÃ©es. Le
  total ne dÃ©pend plus de l'orientation, seulement de la distance.
- **Un Ã©missif qui sert de lumiÃ¨re doit Ãªtre modulÃ© par la texture.** AjoutÃ© tel
  quel, `totalEmissiveRadiance` dÃ©pose un aplat orange uniforme sur le sprite :
  les zones sombres brillent autant que les claires, et Ã§a se lit comme un halo,
  pas comme une surface Ã©clairÃ©e. Une ligne dans le shader
  (`totalEmissiveRadiance *= diffuseColor.rgb`) et l'armure du hÃ©ros redevient
  une armure prise dans la lumiÃ¨re du feu.
- **Un dÃ©calque de sol non Ã©clairÃ© se met Ã  briller la nuit.** L'Ã©cume en
  `MeshBasicMaterial` gardait sa luminositÃ© de plein jour et explosait sous le
  bloom une fois la nuit tombÃ©e. Elle est passÃ©e en matÃ©riau Ã©clairÃ©.
- **De l'eau translucide repasse par-dessus l'Ã©cume.** L'Ã©cume est opaque (elle
  est en dÃ©coupe), donc peinte *avant* les transparents. L'eau translucide la
  recouvrait de 12 %. Elle est devenue opaque.
- **Des nuages visibles masquent le hÃ©ros.** Ã€ 38Â° de plongÃ©e, leur plan croise
  la ligne de visÃ©e. Ils ont d'abord Ã©tÃ© rendus en `colorWrite: false` â€” invisibles,
  mais toujours dessinÃ©s dans la passe d'ombre. Ã‡a marchait, sauf que leurs bords
  Ã©taient aussi nets que ceux d'un tronc, et que les sprites ne recevaient rien.
  Il n'y a plus aucune gÃ©omÃ©trie : une carte de couverture dÃ©rive et multiplie
  l'albÃ©do du dÃ©cor **et** des sprites. Bords doux par construction, pas de passe
  d'ombre, et le hÃ©ros s'assombrit quand un nuage lui passe dessus.
- **`EffectComposer` ne multiÃ©chantillonne pas, et le corriger naÃ¯vement coÃ»te
  cher.** Sa cible interne n'a pas de `samples` : le `antialias: true` du renderer
  ne concerne que le framebuffer par dÃ©faut, oÃ¹ l'on ne dessine qu'un quad plein
  Ã©cran. RÃ©sultat, rien n'Ã©tait lissÃ©. Mais lui *donner* une cible MSAA est pire :
  il la clone pour son ping-pong, et chaque passe plein Ã©cran se met Ã  Ã©crire
  quatre Ã©chantillons par pixel pour rien â€” mesurÃ© Ã  **+5 ms la frame**. Le
  multiÃ©chantillonnage n'a de sens que lÃ  oÃ¹ il y a de la gÃ©omÃ©trie : la scÃ¨ne va
  dans sa propre cible MSAA, la chaÃ®ne d'aprÃ¨s travaille sur des cibles simples.
- **L'Ã©talonnage tournait en espace linÃ©aire.** PlacÃ© avant `OutputPass`, son
  contraste pivotait autour d'un 0.5 linÃ©aire â€” soit 0.73 Ã  l'Ã©cran. Le
  Â« contraste 1.06 Â» Ã©crasait les ombres bien plus qu'il n'ouvrait les hautes
  lumiÃ¨res, et le lift de la nuit dÃ©lavait les noirs sans commune mesure avec sa
  valeur. PassÃ© *aprÃ¨s*, 0.5 dÃ©signe enfin le gris moyen qu'on voit. Le flou du
  tilt-shift, lui, reste avant : un flou n'est juste qu'en linÃ©aire.
- **Une mer claire vire au blanc.** C'est un plan horizontal, il prend le soleil
  de plein fouet, et ACES dÃ©sature tout ce qui monte vers les hautes lumiÃ¨res :
  un turquoise pÃ¢le finissait en nappe grise, et changer sa teinte n'y faisait
  rien. Les couleurs de l'eau sont donc volontairement *sombres* et saturÃ©es.
  MÃªme piÃ¨ge cÃ´tÃ© rugositÃ© : Ã  0.12 la mer est un miroir, le lobe spÃ©culaire du
  soleil couvre le cadre entier et l'Ã©cran blanchit d'un coup quand l'azimut
  s'aligne. 0.46 casse la lumiÃ¨re en Ã©clats au lieu de l'Ã©taler.
- **La tache d'Ã©cume n'occupe que 39 % de sa frame.** MesurÃ© : 75 px opaques sur
  192, alpha franc, sans dÃ©gradÃ©. Un quad dimensionnÃ© sur la case donnait donc une
  pastille de 0.39 unitÃ©, entiÃ¨rement cachÃ©e sous la tuile de terre â€” on ne voyait
  rien du tout. Le quad se dimensionne sur la **pastille**, pas sur la frame.
- **La portÃ©e d'une lumiÃ¨re ponctuelle est une coupure.** L'attÃ©nuation atteint
  zÃ©ro pile Ã  `distance`, et avec une dÃ©croissance de 1.6 elle y arrive encore
  vive : le foyer traÃ§ait un cerne net au sol, Ã  seize unitÃ©s de lui. PortÃ©e
  doublÃ©e et dÃ©croissance physique (2) : la flaque s'Ã©teint d'elle-mÃªme bien
  avant la coupure, qui ne se voit plus.
- **Un contre-jour qui Ã©claire aussi le dÃ©cor n'est plus un liserÃ©, c'est un
  voile.** Le liserÃ© marche parce que les normales des sprites sont bombÃ©es Ã 
  gauche et Ã  droite : une lumiÃ¨re latÃ©rale n'allume qu'une de leurs deux arÃªtes.
  AppliquÃ©e au sol et aux falaises, la mÃªme lumiÃ¨re ne faisait que les dÃ©laver.
  En three, une lumiÃ¨re n'Ã©claire un objet que si leurs calques se croisent : le
  contre-jour vit donc sur un calque oÃ¹ seuls les sprites sont inscrits.
- **Une lumiÃ¨re ponctuelle qui projette, c'est six rendus de la scÃ¨ne.** Un par
  face du cube. C'Ã©tait le poste le plus cher de la frame, pour une ombre qui ne
  se lit qu'Ã  quelques unitÃ©s du foyer et pas du tout en plein jour : elle est
  rÃ©duite Ã  sa portÃ©e utile et coupÃ©e tant qu'il fait jour.
- **Une lune qui Ã©claire depuis l'autre cÃ´tÃ© jette les ombres vers la camÃ©ra.**
  Toute la scÃ¨ne part alors de travers. La lune vient donc du mÃªme quadrant que
  le soleil.
- **Un curseur CSS est rendu Ã  sa taille intrinsÃ¨que en pixels CSS.** LivrÃ© tel
  quel en 64 px, le pointeur du pack est donc rÃ©-Ã©chantillonnÃ© en douceur sur un
  Ã©cran Retina, et le pixel art bave â€” dans un projet qui passe son temps Ã 
  garder ses pixels francs, Ã§a se voit. Il est donc doublÃ© au plus proche voisin
  et dÃ©clarÃ© `image-set(url(â€¦) 2x)` : il tombe pile sur un Ã©cran dense, et sur un
  Ã©cran simple le navigateur le rÃ©duit d'un facteur 2, ce qui rend exactement les
  pixels d'origine. Le point chaud, lui, se donne dans les coordonnÃ©es de l'image
  d'origine â€” la pointe de la flÃ¨che, mesurÃ©e Ã  (22, 17).
- **Un atlas et des mipmaps ne font pas bon mÃ©nage.** Les niveaux infÃ©rieurs
  mÃ©langent les tuiles voisines et font baver les bordures : les tilesets sont
  donc sans mipmaps, avec des UV rentrÃ©es d'un demi-texel.
- **â€¦et l'Ã©cume est un atlas, ce que personne n'avait vu.** C'est une bande de
  huit frames de 192 px, Ã©chantillonnÃ©e frame par frame exactement comme un
  tileset â€” mais elle n'Ã©tait pas dÃ©clarÃ©e comme telle. Les mipmaps moyennaient
  donc les huit frames *entre elles* : la tache perdait tout son dessin et
  devenait un aplat gris, et l'alpha moyennÃ© rongeait la dÃ©coupe de l'`alphaTest`,
  d'oÃ¹ des bavures verticales le long du rivage. C'est un dÃ©calque posÃ© Ã  plat et
  vu en fuyante : il est presque toujours en minification, donc le dÃ©faut Ã©tait
  permanent. RÃ©glÃ© comme les tilesets â€” pas de mipmaps, demi-texel de garde.
- **Une pastille glissÃ©e sous le sol laisse des miettes aux angles.** Le dÃ©bord
  de l'Ã©cume ressort partout oÃ¹ la case voisine est de l'eau ; aux marches du
  littoral, seul le bout d'un coin dÃ©passe et se lit comme une moucheture
  flottant au large. Le dÃ©bord se rÃ¨gle donc au plus juste (`FOAM_SPREAD`) :
  1.56 semait des taches, 1.42 donne un liserÃ© continu.

## The game's renderer â€” what retiring PixiJS cost, and taught

S3's first increment (2026-08-04) moved the game itself onto this engine and deleted the PixiJS
renderer â€” `packages/renderer/src/renderer.ts` and its four satellites, 5 800-odd lines.

This is the same kind of registry as the French one above: what was tried, what the measurement said, and what a future reader
must not redo. Everything below was found while porting terrain, actors and scenery onto `hd2d`.

### Pitfalls found porting the game onto the engine

- **One canvas holds one WebGL context, for the life of the page.** Nothing detaches one.
  `forceContextLoss()` least of all: it goes through `WEBGL_lose_context.loseContext()`, which
  *loses* the context without *detaching* it, so a later `getContext()` returns the same dead object
  and the next engine initialises on a corpse â€” measured on the game's `#stage`, and the page froze
  (a screenshot call timed out at 5 s; that timeout is the evidence). Leaving it alone is strictly
  better: the second engine inherits a live context and renders, merely warning about a missing
  stencil buffer. With one engine left this is no longer reachable by switching renderers â€” but the
  rule is not moot, because the editor's future HD-2D preview will want a second context on that
  same shared canvas. The note lives in `packages/hd2d/src/pipeline.ts`'s `dispose()`; do not add
  `forceContextLoss()` back.
- **â€¦and a SECOND session on the same canvas inherits that context, warnings and all.** Reachable by
  ordinary play now that HD-2D is the only path: leave `/game`, come back, and a second
  `WebGLRenderer` is built on the first one's context. Measured: it renders correctly â€” the terrain
  pixels of the two sessions are byte-identical â€” but three logs two
  `texImage3D: FLIP_Y or PREMULTIPLY_ALPHA isn't allowed for uploading 3D textures` while uploading
  the grading LUT, because the new renderer's unpack state does not match what the context was left
  in. Noise rather than damage, and unfixed: the fix belongs in `@lindocara/hd2d`'s pipeline, and the
  first session is silent.
- **A pipeline that writes on a canvas it does not own must give it back.** `pipeline.dispose()`
  records `canvas.style.imageRendering` before overwriting it and restores *what was there* â€” it
  knows nothing about the game and reads the same for the lab or an editor preview. Measured: `""`
  before, `"auto"` during, `""` after.
- **A camera that follows must SNAP on its first frame.** The scene is built parked over the map's
  spawn; damping toward the hero from there is a one-second fly-in on every single join, which reads
  as a feature and is a bug. Only the first focus snaps; every frame after it damps
  (`1 - exp(-follow Â· dt)`, the lab's own exponential).
- **`setFocusY` damps 8 % per call, so calling it once beside the framing is very nearly a no-op**
  that *reads* as "the tilt-shift band tracks the target". It must be called every frame, from
  `render()`. Caught only by asking what one call actually moves.
- **A billboard's vertical stretch is computed from the camera's plunge, so the two must read one
  constant.** `HD2D_CAMERA.pitch` is exported for that reason alone: a stretch computed for an angle
  the camera does not have is a whole scene of subtly wrong sprites, with nothing on screen naming
  the cause.
- **Actor sheets must NOT be declared atlases â€” the exact inverse of the tileset rule above.** A
  tileset is sampled by sub-rectangle and needs its mipmaps suppressed; a sprite is seen at every
  distance and needs them. The lab's own catalogue marks the four tilesets and the foam, and nothing
  else, and that is not an oversight.
- **A sheet's frame grid can be read off the image only if every frame is square.** True of all 40
  unit and enemy sheets (`width % height === 0`, verified programmatically), so an actor's layout is
  derived rather than tabulated. **Scenery is not like that**: a building is 128Ã—192, a rock 64Ã—64, a
  bush eight frames wide, and each carries its own measured ground line. Guessing there draws a house
  as a 3Ã—3 square and stands a tree in the ground â€” the catalogue already holds all four numbers and
  they must be read, not inferred.
- **A `cols Ã— rows` billboard cannot frame a sub-rectangle of a shared sheet.** Nine of the
  catalogue's 144 placeable assets are crops out of one image (the six Update-010 trees share a
  768Ã—576 PNG). They are skipped with one warning each, and a map dressed mostly out of them comes up
  sparse. Fixing it needs a second framing path in `makeBillboard` â€” an explicit UV rect rather than
  a grid index.
- **Warn once per asset id, not once per placement.** The first version of the scenery placer logged
  a line per prop, so exactly the map that trips the pitfall above â€” dozens of the same unsupported
  tree â€” is the map that floods the console and hides everything else.
- **A foot offset is per asset, not per kind.** Units share the pack's measured 56/192, so one
  constant is honest for players and guards. Enemies do not: their ground lines cluster near 0.30 of
  the frame but a troll and a pig rider sit ~0.3 tiles off it in opposite directions, and that cost
  is being paid today because no per-species measurement crosses the actor seam.
- **Scenery and actors want different lifecycles, so they get different code.** The actor registry
  exists to keep sprites alive ACROSS frames: diff, move, turn, drop, rebuild on a texture change â€”
  every one of those behaviours is about things that move. Scenery is placed once when the map lands
  and given back when the map goes. Folding it into the registry costs either a per-frame diff over
  hundreds of immobile trees or a second lifecycle inside it; both were refused.
- **Draw one thing per frame of a prop sheet: frame 0.** A tree's sheet also holds its felling and
  its stump; a bush is padded with duplicates of its first frame. Nothing animates on this path yet,
  and when it does it must animate the measured run, not the sheet.

### What `renderer.ts` knew, and where that knowledge is now

The deleted file held rules nobody had written down. Three groups, with different fates:

- **The camera rules survive as pure, tested functions that nothing calls.**
  `world-view.ts`'s `gameCameraScale` (which deliberately CLAMPS how close and how far the game
  camera may sit, so a zoom control multiplies its result instead of widening the clamp),
  `cameraAxisOffset` (which centres a world smaller than the viewport rather than pinning it to a
  corner), `elevatedCameraAxisOffset`, and `terrain-visuals.ts`'s `elevationCameraRise` are all
  still here, still covered by `world-view.test.ts` and `terrain-visuals.test.ts`. **The HD-2D camera
  honours none of them**: it follows the hero with no map-bound clamping at all, so a hero at a map
  edge sees past it. The load-bearing detail those functions encode, and which cost a bug once
  already: **the elevation rise is applied AFTER map-bound clamping**, never folded into the camera
  target, or a stair near the north edge silently loses the whole effect. Whoever gives the HD-2D
  camera bounds must apply them in that order.
  `renderer.ts` also snapped rather than damped whenever the target jumped more than 640 px (a
  teleport, a map handoff) and damped at `1 - exp(-dt Â· 8.5)` otherwise. The HD-2D scene uses the
  same shape with `follow: 6`, and snaps only on the first frame â€” a teleport currently sweeps.
- **The draw-ordering rules died, and mostly deserved to.** `mapElementRenderLayer` routed an
  authored prop into one of three containers by its `renderLayer` (`ground` â†’ the decor layer,
  `object`/`canopy` â†’ the actor layer so painter's-algorithm sorting could interleave them with
  heroes, `sky` â†’ above everything). A depth buffer does that job now without being told, which is
  the single largest thing 3D buys here. **But the `sky` case has no equivalent**: an authored prop
  that asked to draw above everything now simply obeys geometry. If a map ever needed that, this is
  where it went.
  Two smaller losses in the same family: elevation shadow layers were maintained per level
  (a level-1 prop's shadow had to be drawn into the level-1 container or it landed on the wrong
  ground), and `EVENT_GRAPHIC_FIT_TILES` scaled an authored event's graphic to fit a fixed number of
  tiles. That constant is gone with its file, so **event graphics now draw at the pack's native
  scale** â€” the same authored map reads differently than it did before this increment. That is a
  deliberate consequence, not a regression to chase: native scale is the pack's own scale system (see
  "Toutes les framesâ€¦" and `tiny-swords-art.ts`'s own note about never fitting a frame to a box),
  and fitting-to-a-box is what shrank an NPC once already.
- **The feedback rules survive intact and are enforced.** `feedback.ts` still owns
  `MAX_ACTIVE_WORLD_EFFECTS` (28), `shouldFloatEvent` (which system/loot/quest prose belongs in
  React's event log rather than the world) and `questSiteFeedback`. The last one is a security
  property, not a style one: **it must keep returning a zero signal alpha**, because a non-zero one
  would leak the expected rune order to anyone reading pixels. Whoever re-implements world effects on
  billboards inherits that rule along with the file. `Hd2dVisualLayer` enforces the 28-effect cap,
  while quest-site presentation still consumes no expected-order signal.

### Gaps closed after the first game port

The first S3 game increment deliberately shipped terrain and frame-zero actors before the rest of
the PixiJS presentation. The following list is retained as the migration record; these are closed
properties of the current renderer, not an outstanding no-op list:

- **~~Cliffs are drawn but not collided.~~ CLOSED** by S3's tile-units increment. The pixel
  projection that flattened every non-water cell is deleted along with the whole TILEâ†’PIXEL BRIDGE;
  the server collides against the heightfield itself (`canStand`, `packages/engine/src/
  terrain-access.ts`) and so does the client, from the same string with the same function â€” one
  bakes to move, the other to validate. A cliff face is solid on both sides of the wire.
- **~~High ground is unreachable, and nobody else's elevation is visible.~~ CLOSED** by S3's
  client-movement increment (2026-08-06), in two halves that had to land together:
  - **Reaching it.** `stepHero` runs on the client (`packages/client/src/game/hero-controller.ts`),
    so the jump, the fall, the water and the canopy are real gameplay rather than a lab
    demonstration. `MAX_STEP` is still 0 â€” a grounded body does not climb, it jumps â€” and that
    remains the rule, not a gap to fix.
  - **Seeing it.** A hero's elevation is now a fact its OWN client computed, so the room relays it
    with three locomotion flags beside it (`PlayerSnapshot.airborne`/`swimming`/`gliding`) and
    `billboards.ts` reads them: a swimmer is drawn at the water line, an airborne or gliding hero at
    its reported elevation, and only a walking one is stood on the terrain under it
    (`elevationOf`). The trap this closed is worth naming, because it fails silently in the most
    convincing way there is: ground-snapping every actor to `heightAt` looks perfectly correct on
    your own screen â€” you are drawn from your own state â€” while making every OTHER player's jump
    invisible and standing every swimmer on the seabed. `hd2d-remote-state.test.ts` is what holds
    it closed.
- **Remote heroes preserve their vertical pose.** Snapshots carry elevation, locomotion flags and `vy`; billboards use them for water-line placement, airborne height, squash/stretch and the glider canopy.
- **Bomb aiming is a real ground raycast.** `screenToWorld` intersects the visible terrain, stairs or
  water and refuses out-of-map points; `showPeasantBombAim` draws the accepted direction.
- **Actors animate authored sheets.** Idle/run/attack selection follows movement and authoritative
  action timelines. Multi-contact actions pin their declared contact frame to each server impact;
  Iron Guard loops its guard strip, while stealth, silhouettes and Ranger afterimages preserve their
  old opacity/tint language.
- **Corpses and ghosts have distinct presentation.** Bodies use fallen billboards and ghosts retain
  their movement pose at reduced opacity.
- **Combat and skill assets are restored on HD-2D.** `combat-art.ts` remains the exhaustive mapping;
  the texture registry preloads it and `visual-layer.ts` animates each sheet from the terrain line.
  Combat does not layer generic Three.js rings, beams, spheres or particle bursts over authored art;
  camera impulses remain presentation-only. Projectiles use their Tiny Swords sheets and trails
  rather than geometric substitutes: their old centre pivot is preserved in the billboard plane,
  and angle-aware clearance keeps left/right/up/down shots above terrain without changing server
  collision elevation. Healing, poison/Rupture, Shadow Dance, monster specials, teleportation and
  the homemade bomb all consume their authored art; Lumen traversal specifically restores the old
  rounded violet `Dust_02` strip rather than borrowing a terrain cloud.
- **Combat chrome follows the rendered target.** Enemy health bars use authoritative HP and the
  existing proximity/display setting above the world billboard. Hit sheets and damage labels carry
  the authoritative `targetId`, then attach to the target's interpolated on-screen position; a small
  camera-relative depth bias keeps transparent impact art behind the target instead of covering it.
- **Persistent secondary visuals use their original art.** Loot crops the original world atlas and
  the Peasant camp uses the retained makeshift-camp illustration, planted as a lit HD-2D billboard.
- **Snow and ice use committed dedicated tilesets** under `packages/client/public/assets/lindocara/
  hd2d/`; they no longer alias the same Tiny Swords teal sheet.

## RÃ©glages

Tout est dans **`apps/lab/src/settings.ts`** : camÃ©ra, vitesse et saut du hÃ©ros, tailles de
sprites, intensitÃ© du tilt-shift, et les deux ambiances jour / nuit.

En cours d'exÃ©cution, `window.lab` expose la scÃ¨ne, la camÃ©ra, le renderer et
`applyMood()` â€” pratique pour bidouiller depuis la console du navigateur.

## Assets

**Tiny Swords** (Pixel Frog) pour l'image, **Free Fantasy SFX Pack** (TomMusic) pour le son.
`apps/lab/scripts/sync-assets.sh` copie vers `apps/lab/public/tex/` et `public/sfx/` les seuls
fichiers utilisÃ©s, avec des noms sans espaces servables par Vite. Les tilesets y vont entiers :
c'est la gÃ©omÃ©trie qui les dÃ©coupe.

Les packs Tiny Swords se lisent depuis `packages/catalog/assets/`, que le dÃ©pÃ´t possÃ¨de dÃ©jÃ . Le
pack SFX pÃ¨se 371 Mo et vit **hors dÃ©pÃ´t** : pointer `LAB_SFX_PACK` dessus pour relancer le script.

Le pack audio n'embarque pas de texte de licence, seulement un mot de l'auteur â€”
Ã  vÃ©rifier auprÃ¨s de lui avant toute diffusion publique.

## Hors pÃ©rimÃ¨tre du PoC

Ce carnet dÃ©crit un PoC de **rendu**, pas un dÃ©but de jeu. Ce qui suit en Ã©tait volontairement
absent, et le reste tant que le labo reproduit le PoC â€” S2 et S3 changeront la donne :

- attaque, ennemis, IA â€” alors que les feuilles de sprites les contiennent
- sprites directionnels : le chevalier n'a que le profil, il est miroitÃ©, il ne
  se retourne jamais de dos ou de face
- transition progressive jour â†’ nuit (le basculement est sec)
- le mouton du pack n'a pas de pattes : c'est un ovale laineux, pas un oubli
- collisions sur les moutons : ils se dÃ©placent, la grille de colliders est
  statique
