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

## glider.png

Seed **42**, four variants; the keeper is variant 1 — the only one that was both
asymmetric and free of a basket. Prompt:

> T1NYSW0RDS. a small paraglider with a curved off-white sailcloth canopy edged
> with a blue trim band, four taut rope risers hanging straight down to a short
> carved wooden handle bar, no basket, no gondola, nobody holding it, empty
> glider seen from the side and slightly from above, tilted nose-down. video
> game sprite on a dark navy background

`no basket, no gondola` earns its place in the prompt: without it the model
draws a wicker basket every time, and a basket makes the thing a balloon the
hero rides in rather than a canopy any character can hang from.

Post-processing (`scripts/sprite.py`, with the new `poches` pass): reduced to
**190 px** tall, i.e. **180x192** — a 2.3 world-unit canopy at the hero's
density (192 px for `HERO.size` 2.6, about 74 px per unit). Unlike the other
sprites here it is taller than wide (aspect 0.938): the risers, not the canopy,
own most of its height.

Three orientation constraints, dictated by the engine rather than by taste. The
sprite is ASYMMETRIC — the hero has no directional art, only `setFlip`, so a
symmetric canopy would make the mirror invisible; it is seen FROM ABOVE — the
camera dives at 38° and the canopy hangs over the head; and it stays readable as
a silhouette once downscaled.

**Why `sprite.py` grew a `poches` pass for this one.** The risers converge on the
grip, so the sky between the outermost two is walled in by canopy above and rope
on both sides, and `detourer`'s edge propagation cannot reach it — the first
attempt shipped a navy blob under the wing. `vider_poches` runs a second,
tighter colour test AFTER `detourer` (20, against `detourer`'s 42): since
`detourer` has already cleared everything reachable from the border, any pixel
still opaque at that point is provably enclosed by the subject, and clearing it
is safe as long as this pass stays tighter than `detourer`'s. Measured here, the
background stays under 20 and the subject's own outline starts at 30, with
nothing in between. It is opt-in, because the sprites above were produced
without it and their source illustrations are not in the repo.

The `glider-open.wav` sound (`sfx` lane, 2.16 s, peaks at −5.5 dBFS) lives in
`assets/sounds/` with the other takes that did not come from the pack;
`sync-assets.sh` encodes it to Opus mono. **Not yet judged by ear** — that pass
is still owed.
