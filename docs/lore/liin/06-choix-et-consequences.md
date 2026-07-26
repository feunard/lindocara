# Choix, état et conséquences

L’état est celui de la partie, donc partagé par un à quatre héros. Un événement en cours est
verrouillé par son identifiant : un seul choix de groupe peut muter une décision politique.

## Variables de campagne

| Id | Nom de registre | Sens et usages |
| --- | --- | --- |
| `0001` | Mémoire | preuves conservées, victimes nommées, souvenirs rendus |
| `0002` | Ordre | continuité des services, discipline et centralisation |
| `0003` | Liberté | autonomie locale, refus des injonctions et publication |
| `0004` | Concorde | accords entre factions qui reconnaissent leurs fautes |
| `0005` | Influence de Varos | marchés acceptés et dépendance à ses solutions |
| `0006` | Confiance de Lyra | préparation des civils, honnêteté et décisions partagées |
| `0007` | Forces alliées | groupes capables de tenir un front final |
| `0008` | Stabilité de la Source | canaux réparés, dettes refermées, solutions techniques |
| `0009` | Preuves réunies | documents indépendants réunis |
| `0010` | Civils sauvés | secours concrets plutôt que victoires abstraites |
| `0011` | Fragments Liin | témoignages capables de porter le nouveau Pacte |
| `0012` | Séquence des racines | progression récupérable de l’énigme du Pacte |
| `0013` | Séquence des archives | progression récupérable des trois époques |
| `0014` | Fragments d’Eryndor | mémoires confrontées dans la Crypte |
| `0015` | Ancres des galeries | mécanismes reroutés sous la bataille |
| `0016` | Dettes consenties | prix explicitement accepté plutôt que déplacé |
| `0017` | Pression de l’Éclipse | conséquences des ruptures et usages dangereux |
| `0018` | Fronts tenus | objectifs militaires secondaires accomplis |
| `0019` | Soins préservés | infrastructures de soin et jardins maintenus |
| `0020` | Dettes assumées | communautés ayant accepté de répondre publiquement |

Les scores sont positifs et cumulatifs. Il n’existe pas de jauge morale unique. L’ordre et la
liberté peuvent tous deux être élevés ; la fin réformée et le Pacte restauré n’utilisent pas les
mêmes combinaisons.

## Switches structurants

| Plage | Décisions |
| --- | --- |
| `0001`–`0003` | prologue achevé, réaction de la Source, enquête d’Aubeval |
| `0004`–`0005` | preuve publiée ou confiée sous contrôle |
| `0006`–`0009` | Varkesh mort, capturé, allié temporaire, preuves obtenues |
| `0010`–`0011` | faubourg secouru, relais des Bois sécurisé |
| `0012`–`0017` | clan soutenu et sort de Morvane |
| `0018`–`0026` | route du Marais, sort des mémoires, de Nhalgor et de Talen |
| `0027`–`0035` | route et contrôle de la Citadelle, position de Serah, conscrits |
| `0036`–`0040` | accord avec Varos et sort de la mémoire d’Eryndor |
| `0041`–`0050` | guerre, fronts, survivants, galeries, Varos |
| `0051`–`0057` | six fins et campagne terminée |
| `0058`–`0061` | relais rapides régionaux |
| `0062`–`0068` | conséquences des quêtes secondaires régionales |
| `0069`–`0079` | route finale et résolution des énigmes |

Les noms et numéros complets vivent dans `scripts/liin-adventure/campaign.ts`, source utilisée par
le générateur et les tests. La documentation ne doit pas inventer de switch absent de ce registre.

## Décisions principales

### Varkesh

- **L’affronter pour l’exécuter** : pose d’abord une intention, augmente Ordre et Influence de
  Varos, puis le programme de défaite établit sa mort et conserve ses preuves.
- **Le vaincre et le capturer** : augmente Concorde et Ordre ; le même affrontement se termine par
  sa reddition et ouvre un procès au lieu d’une exécution.
- **Négocier une trêve limitée** : évite le combat, apporte les renforts d’Aubeval et augmente
  Liberté, Concorde, Influence de Varos et Forces alliées. Ses crimes restent dans le dossier.

Le dialogue ultérieur de Serah dépend de ces trois issues. Sa ligne de justice ou de vengeance
reste ensuite un choix séparé : capturer son père ne décide pas automatiquement à sa place.

### Publication des preuves

- **Publication au marché** : Liberté, Mémoire et Preuves réunies ; Neria avertit que le Conseil
  peut perdre aussi le contrôle des vannes.
- **Copie confiée à Lyra** : Ordre, Concorde, Confiance de Lyra et Preuves réunies ; Lyra prépare
  les arrestations et reconnaît le risque d’un coup de force.

### Bois et Morvane

- **Sève** protège les arbres nourriciers ; **Écorce** maintient les routes et le partage des réserves.
- **Libérer Morvane et partager sa charge** apporte Concorde, Stabilité, dette assumée et renforts
  des Bois.
- **L’apaiser sans rompre tous les liens** privilégie Ordre et Stabilité.
- **Le tuer** impose un affrontement optionnel, augmente Liberté et la pression de l’Éclipse, et
  prive la bataille des renforts forestiers.
- **Confier sa puissance au clan choisi** apporte Ordre et Influence de Varos : le crime ancien
  change de dépositaire sans disparaître.

### Marais

- **Préserver les mémoires avec Nhalgor** favorise Mémoire et Concorde et fournit les renforts du
  Marais.
- **Le vaincre pour reprendre les preuves** impose le combat ; sa défaite conserve une partie des
  souvenirs et fournit malgré tout des Veilleurs.
- **Brûler ce que Varos pourrait saisir** augmente Liberté, Influence de Varos et pression de
  l’Éclipse, sans renfort du Marais.
- Talen est ensuite accusé publiquement ou chargé de réparer les registres sous contrôle.

### Citadelle

Le contrôle revient à Lyra, Serah, Maëlys et les communes, ou au Conseil technique. Chacun ajoute
un garde de commandement distinct sur la map de guerre et modifie la possibilité d’une Couronne
réformée. Le sort de Varkesh change l’argument auquel Serah doit répondre, jamais la réponse imposée :
elle peut choisir justice ou vengeance après sa mort, sa capture ou la trêve.

### Trêve de Varos

Accepter trois jours sous contrôle préserve soins et stabilité et ajoute un renfort du Sanctuaire,
mais augmente fortement son influence. Refuser renforce Liberté, Concorde et Confiance de Lyra sans
garantir les services que Varos proposait de maintenir.

### Bataille

Le groupe peut engager les réserves sur deux objectifs parmi trois : la porte occidentale et sa
route d’évacuation, la levée orientale qui protège les jardins, ou l’infirmerie centrale. Le premier
front tenu suffit à ouvrir le conduit ; le troisième choix est explicitement refusé une fois les
deux réserves mobiles engagées.

## Conditions des fins

### Pacte restauré (`0051`)

Choix final correspondant, avec au moins 6 en Mémoire, 6 en Concorde, 5 Forces alliées, 4 Stabilité,
4 Fragments Liin et 2 Dettes consenties. Les trois ancres sont déjà obligatoires pour atteindre le
Cœur. Le groupe accepte un prélèvement public limité. La fin reste fragile et dépend d’assemblées
régionales.

### Couronne détruite (`0052`)

La destruction produit cette fin si Stabilité atteint 3 et si au moins 3 Forces alliées peuvent
maintenir les services. En dessous, le même geste déclenche la Nouvelle Éclipse.

### Source scellée (`0053`)

Exige 4 en Mémoire, 4 en Stabilité et les trois ancrages des galeries. Les protections déclinent,
mais le cycle est ralenti.

### Couronne réformée (`0054`)

Exige 6 en Ordre, 4 en Concorde, 5 en Stabilité et un contrôle non inquisitorial de la Citadelle.
Un conseil surveille la Source ; le risque de recentralisation demeure.

### Victoire de Varos (`0055`)

Le groupe accepte son offre, ou tente une réforme sans Ordre, Concorde, Stabilité ou contrôle
légitime suffisants. Une Influence de Varos d’au moins 5 modifie le témoignage de Serah : il utilise
alors les accords antérieurs du groupe comme précédents pour ses quotas.

### Nouvelle Éclipse (`0056`)

Résulte d’une destruction sans préparation ou d’un essai de restauration sans assez de témoins.
La Couronne tombe militairement, mais les souvenirs sans lien envahissent les régions.

## Principe de coût

Une option « compatissante » sans digues, témoins ou alliance peut tuer davantage de monde. Une
option d’ordre peut sauver les soins tout en maintenant une structure dangereuse. Les seuils sont
annoncés par des dialogues et des conséquences intermédiaires ; ils ne sont pas affichés comme un
score moral.
