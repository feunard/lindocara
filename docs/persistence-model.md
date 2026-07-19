# Persistance des objets, équipements, compétences et quêtes

## Source de vérité

La ligne `character` reste la source des attributs du personnage, de sa localisation, de son
epoch de session, de son apparence et des monnaies (`gold`, `crystals`). Les possessions et la
progression extensible utilisent désormais cinq tables :

| Table | Responsabilité |
| --- | --- |
| `item_definition` | Catalogue minimal des objets persistables et règles d'équipement. |
| `character_item` | Possessions et quantités d'un personnage. |
| `character_equipment` | Un objet possédé équipé dans un emplacement typé. |
| `character_skill` | Compétences débloquées et disposition équipée. |
| `character_quest` | Plusieurs quêtes, leur statut, progression, dates et données spécifiques. |

Les anciennes colonnes `potions`, `main_hand`, `off_hand`, `quest_*` et
`ward_run_expires_at` restent physiquement présentes pour permettre un rollback de Worker, mais
le nouveau code ne les lit ni ne les écrit dans le fonctionnement normal. L'adaptateur version
`0` les lit une seule fois pour effectuer son backfill. Elles ne sont donc pas une deuxième source
active.

`character.persistence_version` vaut `1` après le backfill. Une ligne version `0`, par exemple
créée par un ancien Worker pendant un rollback, est normalisée une seule fois au prochain
chargement puis marquée version `1` dans le même batch D1.

## Migrations

- `0008_warm_kate_bishop.sql` crée les cinq tables, leurs contraintes et index, installe le petit
  catalogue actuel, puis copie potions, arme principale, bouclier, quête et compétences de chaque
  personnage existant.
- `0009_quiet_gertrude_yorkes.sql` ajoute le marqueur `persistence_version` et marque les lignes
  backfillées.

La migration ne modifie ni zone, instance, position, niveau, XP, HP, or, cristaux, vie ou epoch.
Les sauvegardes multi-table sont envoyées par `D1Database.batch()`. Chaque mutation issue d'un
World contient aussi une condition sur `character.session_epoch`, y compris les sous-écritures
d'inventaire, d'équipement, de quête et de compétences.

## Règles de propriété et de concurrence

- `character_item.quantity >= 0`; une consommation utilise un `UPDATE ... WHERE quantity > 0
  RETURNING`, donc deux consommations concurrentes ne peuvent pas réussir sur la dernière unité.
- Une définition ne peut exister qu'une fois par personnage. Les objets non empilables ont une
  quantité applicative de `1`.
- La clé étrangère composée de `character_equipment(character_id, character_item_id)` vers
  `character_item(character_id, id)` interdit d'équiper l'objet d'un autre personnage.
- `character_equipment.character_item_id` est unique : une possession ne peut pas être équipée
  deux fois. Le service vérifie également l'emplacement déclaré, la classe, et une quantité
  strictement positive.
- Une récompense de quête réserve atomiquement un `reward_claim_id` unique avant d'écrire les
  récompenses. Les écritures suivantes du même batch ne s'appliquent que pour ce claim.

## Ajouter un objet

1. Ajouter sa définition à `ITEM_DEFINITIONS` dans `src/server/items.ts` avec un identifiant stable,
   son type, `stackable`, `maxStack`, l'emplacement éventuel et la classe éventuelle.
2. Ajouter la même ligne par migration SQL dans `item_definition`. Les définitions existantes ne
   doivent pas être renommées après attribution.
3. Si l'objet est visible dans le protocole ou l'UI, ajouter les types, assets et traductions
   correspondants. Une possession reste toujours créée côté serveur.
4. Tester quantité, attribution, consommation ou équipement selon son usage.

## Ajouter un emplacement

Ajouter la valeur à `EQUIPMENT_SLOTS` dans `db/schema.ts`, générer une migration, puis mettre à jour
la validation/UI. Un emplacement peut rester vide. Seuls `main_hand` et `off_hand` sont alimentés
aujourd'hui ; les autres emplacements préparent l'évolution du modèle sans créer de gameplay.

## Ajouter une quête

1. Donner à la quête un `quest_id` stable et conserver ses règles pures dans le catalogue partagé
   de zone lorsque la quête est liée au monde.
2. Créer ou attribuer la ligne `character_quest` côté serveur. `data` ne contient que les données
   spécifiques non indexées ; les statuts et la progression restent dans leurs colonnes.
3. Utiliser le claim atomique pour toute récompense non idempotente.
4. Ajouter les deux traductions et couvrir acceptation, progression, reconnexion et récompense.

Les niveaux restent la règle de déblocage des compétences. Dans le flux principal, `hero.talents`
persiste un tableau JSON d'identifiants validés par le serveur : un niveau donne un point, les
racines gratuites sont toujours dérivées du niveau et ne sont jamais stockées. Les personnages de
rollback conservent leurs talents en mémoire de session ; `character_skill` reste leur modèle
normalisé et ne doit pas être repointé silencieusement vers les héros.
