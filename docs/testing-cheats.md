# Commandes de test en jeu

Ces commandes sont saisies dans le chat, exécutées uniquement par le serveur et ne sont jamais
diffusées aux autres joueurs. Elles sont disponibles seulement avec `CHEATS_ENABLED="true"` dans
`.dev.vars` (local) ou dans les bindings du banc de test. Ne configurez pas cette variable en
production.

| Commande | Effet |
| --- | --- |
| `/help` ou `/cheats` | Affiche la liste des commandes dans le journal du jeu. |
| `/up1` à `/up10` | Fixe exactement le niveau du héros, remet son XP à zéro et restaure ses PV. |
| `/nodead` | Active ou désactive l’invulnérabilité pour la session en cours. |
| `/heal` | Restaure tous les PV. |
| `/hurt` | Place le héros à 1 PV sans le tuer. |
| `/resource` | Remplit la ressource de classe quand la classe en possède une. |
| `/resetcd` | Annule l’action et la garde, puis remet tous les temps de recharge à zéro. |
| `/loot` | Ajoute 10 potions, 1 000 pièces d’or et 100 cristaux. |
| `/die` | Force l’état cadavre, même si `/nodead` est actif. |
| `/ghost` | Force la mort si nécessaire, puis libère le fantôme. |
| `/revive` | Ressuscite sur place avec tous les PV. |
| `/reset` | Ressuscite si nécessaire, restaure PV/ressource/cooldowns et coupe `/nodead`. |
| `/where` | Affiche l’identifiant de carte et les coordonnées serveur. |

Les changements de niveau, de PV, de vie et d’inventaire suivent la sauvegarde normale du héros.
L’état `/nodead` est volontairement limité à la connexion courante et disparaît à la reconnexion.
