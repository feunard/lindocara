# Sprites générés

Produits avec le LoRA « Tiny Swords » de `../../pixel-art-model` (FLUX.2-klein-4B,
checkpoint `models/v2/0004000_adapter.safetensors`), puis retravaillés pour tenir
à la densité de pixels du jeu.

## chest-closed.png / chest-open.png

Graine **43** pour les deux — c'est ce qui garantit que le coffre ouvert est bien
le même objet que le fermé.

Invites :

> T1NYSW0RDS. a wooden treasure chest with iron bands and a round golden lock,
> lid closed, standing on the ground, three-quarter view. video game sprite on a
> dark navy background

> T1NYSW0RDS. a wooden treasure chest with iron bands and a round golden lock,
> lid wide open tilted back, gold coins piled inside, three-quarter view. video
> game sprite on a dark navy background

Post-traitement (`scripts/sprite.py`) : détourage du fond, recadrage, réduction
en moyenne à 62 px de haut pour le coffre fermé — **la même échelle est imposée
au coffre ouvert**, sinon son corps rétrécirait en s'ouvrant —, alpha binaire,
palette réduite à 24 couleurs, puis liseré de contour rgb(22,28,46), la couleur
relevée sur la souche, le caillou et l'arbre du pack d'origine. Les deux sont
posés sur un canevas commun de 80x80, calés en bas et centrés.

Le modèle rend une illustration lissée à 768², pas du pixel art : c'est la
réduction en moyenne qui fabrique les pixels. Sans elle, le coffre serait dix
fois plus détaillé que les arbres qui l'entourent.

## campfire-base.png

Graine **43**. Invite :

> T1NYSW0RDS. an unlit campfire: four charred wooden logs stacked in a cone,
> surrounded by a ring of grey stones on bare earth, no flames, three-quarter
> view from above. video game sprite on a dark navy background

Même post-traitement, réduit à 64 px de large (une case du jeu). Il remplace la
souche qui servait de socle au feu.

Contrairement aux autres sprites, il est posé **à plat** et non debout : un
foyer est un élément de sol, et le modèle l'a dessiné vu de dessus. Sur un plan
vertical, son cercle de pierres se serait dressé comme un disque. La flamme,
elle, reste un sprite debout planté en son centre.
