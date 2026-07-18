# Combat coopératif

Le Durable Object de la room reste l'unique autorité. Les tables de menace, les contributions,
les groupes et les invitations sont en mémoire dans cette room ; aucun état mutable n'est partagé
entre deux instances.

Le joueur ne choisit jamais une cible de combat. Une attaque ou une compétence utilise la dernière
orientation non nulle validée par le serveur, puis suit une chronologie anticipation, impact unique
et récupération. Les arcs, capsules, zones et projectiles balayés déterminent les entités réellement
touchées à la frame active. La « cible » mentionnée ci-dessous désigne uniquement le choix interne de
l'IA de menace ou le bénéficiaire effectif d'un soin déjà résolu, jamais un identifiant fourni par
le client. Le contrat complet est décrit dans
[`directional-action-combat.md`](./directional-action-combat.md).

## Menace

Chaque monstre conserve au plus 16 entrées. La menace initiale vaut
`5 + (portéeAggro - distance) / portéeAggro`, ce qui conserve la préférence pour le joueur le plus
proche. Les dégâts effectifs génèrent un point de menace par point de dégâts. Un soin génère
`soin effectif × 0,5` uniquement sur les monstres déjà engagés avec la cible soignée.
`shield_bash` provoque : la menace du guerrier devient au minimum la menace maximale courante +
25. `iron_guard` conserve sa réduction de dégâts ; garde et provocation permettent donc au
guerrier de détourner les attaques de ses alliés.

Une entrée disparaît si le joueur meurt, se déconnecte, entre en zone sûre, change de room, se
trouve à plus de 1 100 px ou n'a pas rafraîchi sa menace depuis 15 secondes. À égalité,
l'identifiant de personnage départage les cibles afin que la règle soit déterministe.

## Contribution et expérience

Un combat suit les dégâts effectifs, les soins effectifs fournis à un participant et la menace
utile. Un soin excédentaire vaut zéro. À la mort, un contributeur direct doit encore être vivant,
autorisé, dans la room et à moins de 900 px. La simple proximité initiale ne suffit pas.

Les membres vivants du groupe d'un contributeur direct sont également éligibles s'ils sont dans
ce rayon au moment de la mort. Le pool d'XP est partagé également ; le reste entier est attribué
dans l'ordre stable des identifiants. `rewardsGranted` est posé avant toute attribution et n'est
réarmé qu'au respawn. Menace et contributions sont ensuite vidées.

## Butin personnel

Chaque joueur éligible reçoit une entrée distincte avec `ownerId`. Le filtre d'intérêt la retire
des baselines, resynchronisations et deltas des autres joueurs. La collecte vérifie encore le
propriétaire côté serveur : l'invisibilité client n'est pas une règle de sécurité. Le butin expire
après 30 secondes, comme auparavant.

## Groupes

Un groupe temporaire contient au plus cinq personnages et un chef. Le cycle est : création,
invitation identifiée aléatoirement par le serveur et valable 30 secondes, acceptation ou refus,
départ/exclusion, puis dissolution. Un personnage n'appartient qu'à un groupe. Seul le chef
invite, exclut et dissout. Une invitation ne peut viser qu'un personnage de la même room.

Au départ du chef, le membre au premier identifiant dans l'ordre stable devient chef. Un changement
de zone ou une déconnexion retire immédiatement le personnage, ses invitations et sa menace. Les
groupes ne traversent donc pas encore les zones et ne survivent pas à une déconnexion.
`party.state` fournit les HP des membres de la room. Le canal `party` est envoyé uniquement aux
sockets indexées par le groupe.

Messages client : `party.create`, `party.invite`, `party.accept`, `party.refuse`, `party.leave`,
`party.kick`, `party.dissolve`, et `chat` avec `channel: "party"`. Messages serveur :
`party.invite`, `party.state`, les événements `party.*`, et `chat` avec le canal `party`.

Le client expose aussi `/party`, `/invite <characterId>`, `/p <message>`, `/kick <characterId>`,
`/leave` et `/disband` dans le chat.

## Ressources de classe

Les règles vivent dans `src/shared/resources.ts`, mais le serveur valide et débite chaque coût.
Les valeurs courantes sont : endurance guerrier (100, +10/s), énergie rôdeur (100, +14/s), mana
prêtre (100, +9/s).

| Classe | Coûts des emplacements 1 à 5 |
| --- | --- |
| Guerrier | 0, 30, 25, 35, 45 |
| Rôdeur | 0, 20, 30, 25, 40 |
| Prêtre | 0, 18, 25, 32, 45 |

Le guerrier récupère aussi 12 % des dégâts infligés et 20 % des dégâts reçus ; le prêtre récupère
12 % des soins utiles. La valeur courante est placée dans l'attachement WebSocket pour survivre à
une éviction du Durable Object, mais n'est pas encore persistée dans D1.

Les projectiles et dégâts de zone appellent les mêmes chemins de menace et de contribution que les
anciens impacts directs. Une flèche perforante enregistre séparément les dégâts réellement appliqués
à chaque monstre. Mend, Prayer et Divine Nova ne génèrent ressource, menace de soin et contribution
que sur les PV réellement restaurés ; le sursoin reste nul.
