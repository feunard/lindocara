# Quêtes principales

## Contrat d’exécution

Les sept quêtes principales sont des quêtes de groupe, non répétables, acceptées et terminées
automatiquement. Elles n’emploient donc ni donneur ni cible de retour technique : les personnages
mettent les enjeux en scène, tandis que le serveur crédite des faits structurés (`reach` et
`completeActivity`). Cela évite qu’un dialogue de quête prioritaire empêche le programme narratif
du même événement de s’exécuter.

Toutes utilisent des étapes séquentielles. `previousQuestId` impose la chaîne `0001` → `0007` et
`nextQuestId` ouvre la suivante à la complétion. Les portes de maps restent, elles, conditionnées
par les switches posés au moment des décisions : compléter le journal ne permet jamais de contourner
un passage narratif.

## `0001` — Les noms absents

1. Recueillir le témoignage d’Iven (`disparus_signales`) et examiner le registre fendu
   (`registre_brise`), dans l’ordre choisi.
2. Faire face à l’Éclat d’Aube (`source_reconnait`).

La quête établit deux faits indépendants avant d’activer le troisième : un disparu concret et une
falsification comptable rendent ensuite la réaction de la Source interprétable.

## `0002` — La porte des traîtres

1. Entrer dans Aubeval (`reach`).
2. Vérifier les registres des convois (`preuve_convois`).
3. Obtenir le dossier des crimes de Varkesh (`preuve_varkesh`).
4. Décider de son sort (`sort_varkesh`).

La publication de la copie vérifiée est décidée à Aubeval. Dans le faubourg, le groupe choisit une
trêve ou un affrontement ; le programme de défaite distingue ensuite capture et exécution.

## `0003` — Le Pacte mutilé

1. Gagner Clairécorce (`reach`).
2. Prendre parti entre Sève et Écorce (`choix_clan`).
3. Reconstituer le rite des racines (`rite_racines`).
4. Décider du sort de Morvane (`sort_morvane`).

Toutes les résolutions — libération, apaisement, transfert à un clan ou combat — émettent la même
activité finale. Aucune voie principale n’exige donc la mort de Morvane.

## `0004` — Les morts qui se souviennent

1. Atteindre les Saules (`reach`).
2. Comprendre ce que Nhalgor protège (`intentions_nhalgor`).
3. Rétablir la chronologie des Archives (`ordre_archives`).
4. Décider du sort de Nhalgor (`sort_nhalgor`).
5. Obtenir l’aveu complet de Talen (`verite_talen`).

La confession n’est accessible qu’après le choix sur les Archives. Elle ne peut donc pas servir
d’exposition anticipée ni disparaître avec une branche de combat.

## `0005` — La guerre des serments

1. Entrer dans les Trois Cours (`reach`).
2. Fixer la ligne de Serah (`position_serah`).
3. Choisir le contrôle de la Citadelle (`controle_citadelle`).

Le sort antérieur de Varkesh change le préambule de Serah, mais justice ou vengeance reste une
décision propre. Lyra, Serah, Maëlys ou le Conseil technique fournissent ensuite un garde de
commandement distinct dans la bataille.

## `0006` — Le prix de l’Aube

1. Atteindre le Sanctuaire (`reach`).
2. Lire le registre des prélèvements (`verite_couronne`).
3. Répondre à l’offre de Varos (`offre_varos`).
4. Réunir les trois fragments d’Eryndor (`memoire_eryndor`).
5. Localiser le mécanisme originel (`preparer_guerre`).

Le dernier objectif est émis par la mémoire réunie d’Eryndor. Il ouvre le conseil de guerre sans
prononcer le choix final.

## `0007` — La guerre de l’Aube

1. Entrer dans la bataille (`reach`).
2. Engager les réserves sur au moins un secteur (`tenir_front`).
3. Ouvrir le passage des serviteurs (`passage_serviteurs`).
4. Activer les trois ancres (`ouvrir_mecanisme`).
5. Prononcer le choix de l’Aube (`choisir_aube`).

Le groupe peut secourir deux fronts, mais un seul suffit pour atteindre le conduit. Vaincre l’avatar
de Varos est facultatif et appartient à la quête secondaire `0026`. La quête principale se termine
uniquement lorsque le mécanisme reçoit l’une des six décisions et téléporte le groupe vers
l’épilogue.
