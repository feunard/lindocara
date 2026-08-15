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

## Icônes de consommables (2026-08-14)

Générées localement en un lot reproductible par `python studio/studio.py sprite --manifest
studio/pixel-art/consumable-icons.json` avec `black-forest-labs/FLUX.2-klein-4B`, le LoRA Tiny
Swords `studio/models/tinyswords-v2-4000.safetensors` à l'échelle 1,4, quatre étapes et le thème
`T1NYSW0RDS`. Les sources 768×768 sont conservées dans `consumables/*-raw.png`.

| Sortie | Graine | Invite spécifique |
| --- | ---: | --- |
| `health-potion-raw.png` | 3101 | one squat heartroot health tonic bottle, red healing liquid, heart-shaped root wrapped around the cork, readable fantasy inventory icon, centered isolated object, no text, no frame |
| `mana-potion-raw.png` | 3102 | one slender lumen mana phial, bright blue magical liquid and a small crescent crystal stopper, readable fantasy inventory icon, centered isolated object, no text, no frame |
| `damage-elixir-raw.png` | 3103 | one sturdy giantblood damage elixir flask, thick crimson liquid, broad shoulders and a tiny giant fang tied to the neck, readable fantasy inventory icon, centered isolated object, no text, no frame |
| `oblivion-draught-raw.png` | 3104 | one dark oblivion draught bottle, smoky violet liquid spiralling inward beneath a black wax stopper, readable fantasy inventory icon, centered isolated object, no text, no frame |
| `invisibility-potion-raw.png` | 3105 | one delicate veil invisibility tincture bottle, pale turquoise liquid fading to transparent with a wispy cloth ribbon, readable fantasy inventory icon, centered isolated object, no text, no frame |
| `resurrection-potion-raw.png` | 3106 | one phoenix resurrection cordial bottle, glowing orange-gold liquid, flame-shaped stopper and two tiny wing ornaments, readable fantasy inventory icon, centered isolated object, no text, no frame |

Les icônes jouables sous `packages/renderer/src/assets/consumables/` passent ensuite par
`python apps/lab/scripts/sprite.py INPUT OUTPUT 64 16` : détourage du fond, recadrage, réduction
BOX à 64 px de haut, alpha binaire, palette de 16 couleurs et contour Tiny Swords.

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

The vertical swim was regenerated with Codex's built-in image generator (`imagegen`) after the first
version failed to preserve the production sprite's identity. The old upward sheet was the edit
target; the shipped side-swim and attack sheets were authoritative identity/style references.
Prompt:

> Use case: precise-object-edit. Asset type: production 4-frame HD-2D game sprite sheet. Image 1 is
> the edit target and defines the exact four-frame horizontal layout and upward-swimming
> orientation. Images 2 and 3 are the authoritative production character identity, pixel-art
> rendering, palette, proportions, scars, outline, and animation style. Replace only the mismatched
> shark rendering in all four cells of Image 1 with exactly the same sea-guardian shark seen in
> Images 2 and 3, now swimming vertically toward the top of the sheet. This is the same character
> from a rotated movement direction, not a redesign. Preserve the long angular shark snout, compact
> muscular body, dark desaturated teal-blue back, irregular cream underside, navy pixel outline,
> small hostile eye, exact pale scar shapes, dorsal fin shape, paired pectoral fins, forked tail,
> chunky hand-painted pixel clusters, limited palette, hard stepped edges, and the same apparent
> sprite scale. Four distinct but subtle poses: tail left, centre, right, centre. One complete shark
> per equal square frame, nose toward the top. Perfectly flat uniform solid #ff00ff chroma-key
> background. No front-facing grin, oversized mouth, broad flat head, manta-ray silhouette, bubbles,
> water, shadows, gradients, background texture, text, border, watermark or extra objects.

The built-in result was keyed to alpha with the installed imagegen `remove_chroma_key.py` helper.
`scripts/animation-sheet.py` then applied the project sprite normalization at 210 px content height,
24 colours and four 256x256 cells. A 180-degree nearest-neighbour rotation produced the matching
downward sheet. The transparent source/reference and opposite-direction reference are stored under
`studio/pixel-art/refs/sea-guardian-{up,down}.png`; the final sheets are:

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

## Bâtiments HD-2D natifs (2026-08-15)

Les quatre façades ont été générées localement avec `python studio/studio.py sprite`, donc avec le
profil FLUX.2-klein et le LoRA Tiny Swords du projet. Les sources 512×512 ont ensuite été détourées
et normalisées avec `apps/lab/scripts/sprite.py`; seules les sorties transparentes utilisées par le
jeu sont conservées sous `packages/client/public/assets/lindocara/hd2d/buildings/`.

| Sortie | Graine | Invite spécifique |
| --- | ---: | --- |
| `house-front.png` | 73101 | Orthographic straight-on front elevation of a compact medieval timber cottage, blue shingle roof, cream plaster, heavy oak beams, centered complete facade, one arched door, no perspective, no ground, clean square silhouette |
| `tower-front.png` | 73102 | Orthographic straight-on front elevation of a tall medieval stone watch tower, blue conical shingle roof, cream stone blocks, narrow windows, centered complete facade, no perspective, no ground, clean square silhouette |
| `archery-front.png` | 73103 | Orthographic straight-on front elevation of a medieval archery guild building, timber and cream stone, blue shingle roof, crossed bow sign, open practice awning, centered complete facade, no perspective, no ground |
| `barracks-front.png` | 73104 | Orthographic straight-on front elevation of a sturdy medieval barracks, cream stone base, heavy timber upper floor, blue shingle roof, shield crest and broad double door, centered complete facade, no perspective, no ground |

La maison, la tour de pierre, la guilde d'archers et la caserne sont les quatre silhouettes de base.
Le moulin réemploie la tour et ajoute un rotor animé en géométrie Three.js. Les monastères et
châteaux réemploient respectivement les volumes de la guilde et de la caserne, ce qui remplace
toutes les anciennes variantes Tiny Swords sans dupliquer des dizaines de façades quasi identiques.

`wall-timber.png` et `roof-shingles.png` proviennent des générations déjà validées du Lab
(`house-side.png` et `house-roof.png`). Le pont 3D utilise de même `interior-floor.png` comme bois de
platelage. Les accessoires d'intérieur (`hearth`, `bed`, `table`, `cupboard`, `rug`, sol et mur)
proviennent du même lot Lab documenté plus haut et sont copiés sous
`packages/client/public/assets/lindocara/hd2d/interiors/` pour être servis par l'application.
