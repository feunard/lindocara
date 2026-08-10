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

## Sea guardian shark (2026-08-10)

The character reference in `studio/pixel-art/refs/sea-guardian.png` was created with Codex's
built-in image generator (`imagegen`). Prompt:

> Use case: stylized-concept. Asset type: game character reference for a Tiny Swords-inspired
> HD-2D cooperative RPG sprite pipeline. Primary request: a single massive supernatural guardian
> shark, the immortal guardian of the sea, designed to patrol around islands and instantly swallow
> swimmers. Scene/backdrop: perfectly flat solid dark navy #10182e background, no water, no floor,
> no shadow, no scenery. Subject: one shark only, full body visible in side three-quarter view
> facing right, powerful compact silhouette, dark blue-gray back, pale underside, tall scarred
> dorsal fin, broad jaws, a few old pale scars, subtly luminous cyan eyes, menacing but readable at
> small pixel-art scale. Style/medium: clean stylized game concept art with chunky proportions and
> simplified large color shapes suitable for later downsampling into Tiny Swords-like pixel art.
> Composition/framing: centered, generous padding on every side, body nearly horizontal, fins
> clearly separated, tail fully visible. Lighting/mood: restrained cool rim light, ominous, high
> silhouette readability. Constraints: no text, no watermark, no other creatures, no blood, no
> gore, no detached parts, no ocean background, no bubbles, no cast shadow; keep anatomy consistent
> and animation-friendly. Avoid: photorealism, cartoon smile, humanoid limbs, weapons, armor,
> excessive tiny detail.

The project-local FLUX.2-klein + Tiny Swords LoRA sprite lane then used that reference for two
four-frame strips, both seed **84**, generated at 1024x256:

> a clean horizontal animation strip of exactly four equal square frames showing the same shark
> swimming rapidly to the right, full body side view in every frame, exaggerated tail sweep phases
> left-center-right-center, fins and body clearly changing pose, each frame isolated with generous
> empty background, no panel borders, no labels, no extra creatures

> a clean horizontal animation strip of exactly four equal square frames showing the same shark
> lunging to swallow a swimmer to the right, full body side view in every frame, exaggerated attack
> phases: jaws closed charging, jaws opening wide, maximum enormous open bite, jaws snapping shut,
> powerful tail thrust and arched body, each frame isolated with generous empty background, no
> victim visible, no blood, no gore, no panel borders, no labels, no extra creatures

`scripts/animation-sheet.py` applies the existing sprite pipeline independently to each source
cell: background removal, enclosed-pocket clearing, crop, downsample, hard alpha, 24-colour
quantisation and the project outline. Each normalized 256x256 cell is assembled into the final
transparent sheets:

- `packages/client/public/assets/lindocara/hd2d/sea-guardian-swim.png`
- `packages/client/public/assets/lindocara/hd2d/sea-guardian-attack.png`

The directional references in `studio/pixel-art/refs/sea-guardian-up.png` and
`studio/pixel-art/refs/sea-guardian-down.png` were created with Codex's built-in image generator
(`imagegen`) from the original character reference and side-swim sheet. Prompts:

> Use case: stylized-concept. Asset type: directional game-character reference for an HD-2D RPG
> sprite pipeline. Preserve exactly the same scarred supernatural sea-guardian shark from the
> supplied concept and swim references: dark blue-gray back, pale underside, tall scarred dorsal
> fin, broad jaws, old pale scars and one luminous cyan eye. Show one complete shark directly from
> above, swimming vertically toward the top of the image, nose at the top and tail at the bottom.
> Center the full body with generous padding on a perfectly flat dark navy background. Keep a
> powerful, compact, animation-friendly silhouette and simplified large colour shapes. No text,
> watermark, water, foam, bubbles, scenery, shadow, border, extra creature, blood or gore.

> Use case: stylized-concept. Asset type: directional game-character reference for an HD-2D RPG
> sprite pipeline. Preserve exactly the same scarred supernatural sea-guardian shark from the
> supplied concept and swim references: dark blue-gray back, pale underside, tall scarred dorsal
> fin, broad jaws, old pale scars and one luminous cyan eye. Show one complete shark directly from
> above, swimming vertically toward the bottom of the image, nose at the bottom and tail at the top.
> Center the full body with generous padding on a perfectly flat dark navy background. Keep a
> powerful, compact, animation-friendly silhouette and simplified large colour shapes. No text,
> watermark, water, foam, bubbles, scenery, shadow, border, extra creature, blood or gore.

The project-local FLUX.2-klein + Tiny Swords LoRA sprite lane then generated a three-pose vertical
swim strip at 1024x256 with seed **93** from the upward reference:

> one horizontal strip of exactly four equal square animation frames, the same shark in every
> frame, swimming straight toward the top of the image as seen directly from above, tail sweeping
> strongly left, centered, strongly right, centered, with a visibly curved body and distinct motion
> in every frame; full body visible and centered inside each frame; perfectly flat dark navy
> background; no water, no foam, no bubbles, no shadows, no text, no border, no frame separators

The model produced three coherent source poses. `scripts/animation-sheet.py` normalizes them with
the same sprite pipeline, assembles the `0,1,2,1` cadence, and rotates the strip 180 degrees for the
opposite direction. The final transparent 4x256x256 sheets are:

- `packages/client/public/assets/lindocara/hd2d/sea-guardian-swim-up.png`
- `packages/client/public/assets/lindocara/hd2d/sea-guardian-swim-down.png`

The project-local MOSS sound-effect lane generated the two mono 48 kHz PCM WAV files:

- `sea-guardian-near.wav`, seed **91**, 10 s: "continuous ominous underwater pressure from a
  massive shark circling nearby, deep submerged body rumbles, slow heavy water displacement,
  distant fin cutting through water, steady tension with no sudden climax"
- `sea-guardian-devour.wav`, seed **92**, 3 s: "a massive shark surges from underwater and snaps
  enormous jaws shut around a body, violent heavy water splash, deep wet bite impact, one short
  brutal engulfing event, no scream"

Those ship from `packages/client/public/assets/lindocara/audio/sfx/`. The committed runner
compatibility changes keep the documented Windows/NVIDIA lanes usable with current Diffusers,
PyTorch and torchaudio rather than changing either generated artifact after inference.
