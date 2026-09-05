# Painted Priest sources — 2026-09-05

These are static construction drawings, not generated animation frames. They were made with the
built-in `image_gen` tool, using the shipped Assassin, Runic Guardian and Ranger idle sprites as
style references. No local FLUX run, seed control, temporal conditioning or pose-control parameter
is claimed for these images. The existing discarded Priest prototype was not an input.

`canonical.png` locks the illustrated identity. The five `*-source.png` plates contain isolated
head, garment, arm, thigh, boot and staff drawings. Their physical scale and joint registration are
authored in `build.mjs` and `priest-painted.ts`; AI image bounds never decide a runtime pivot.
The constructor produces two arms and two legs, while the staff stays on its actual hand node.

The first exploded kit had a black presentation background despite the chroma-key instruction.
A targeted background edit corrected it; that intermediate is not an input to the build. The
rear boot also needed a targeted correction because its first rear view still showed the toe.
The accepted plates below, not another nondeterministic model call, are the reproducible inputs.

## Canonical prompt

Use case: stylized-concept. Asset: canonical character art for the existing Lindocara RPG.
Image 1 is the ACTUAL GAME STYLE reference, three different existing characters. Match their
finely shaded illustrated pixel-sprite treatment, dark thin outlines, small sharp highlights,
layered cloth folds, appealing compact proportions. Image 2 is ONLY priest identity and costume
reference, NOT rendering style: its crude flat shapes and very huge head must be replaced with
the more refined proportions and shading of Image 1. Create one full body priest standing neutral,
front-facing (symmetrical shoulders, both feet on same baseline), slight RPG camera elevation as
Image 1, arms loosely separated from torso, hands empty; do NOT draw a staff or book overlapping
the body. Warm brown skin, young adult male, chestnut swept hair and ivory forehead band with amber
stone, teal short shoulder mantle with gold edge, ivory tunic split into two short panels ending
above knees so legs visible, amber stole, brown waist belt, fitted dark trousers, brown cuffed
boots. Sacred support caster, warm and resolute face, good-looking eyes drawn like the ranger
(small at game size). Refined illustrated sprite with volume conveyed by painted shadow shapes
and folds, not spheres or 3D toy rendering. Body about 3.4 head-heights, legs substantial and
animatable; head no more than 30 percent total stature. One isolated figure only, no text, no
panels. Perfectly flat solid #ff00ff magenta chroma key background with NO texture, gradient,
ground, cast shadow or reflection. Do not use magenta on the character. Generous blank padding.
This art will be articulated as painted 2D cutout pieces, so shoulders, elbows, hands, knees and
boots must read clearly.

## Construction plate prompt

Use case: identity-preserve. Production 2D skeletal-animation cutout kit for exactly the priest
in the reference image. Preserve all character identity, illustrated pixel shading, colors and
details. Create a strict 3-column by 2-row grid of SIX separated body pieces, all FRONT VIEW with
a slight elevated RPG viewpoint, on flat solid #ff00ff background. NO TEXT, no grid lines, no
assembled characters, no shadows. Each piece centered in its own cell, generous empty space
between cells. TOP LEFT: complete detached head including hair, ears, face, forehead band and
short neck; same frontal facial expression. TOP MIDDLE: torso ONLY, complete teal gold-edged
shoulder mantle, ivory tunic, belt and amber sun stole, including tunic's split tails, no head,
no arms, no legs. At neck show the opening, at sleeves leave clean gaps. TOP RIGHT: one complete
detached straight relaxed arm from rounded shoulder to closed empty fist, with skin upper arm,
ivory small sleeve at shoulder, brown gold-edged forearm bracer, and hand, fully extended straight
down. BOTTOM LEFT: one detached upper leg, from rounded hip joint to below the knee, dark charcoal
trouser with cloth folds, NO boot. BOTTOM MIDDLE: one complete detached lower leg with brown boot,
from rounded knee joint to sole, tall cuffed boot with gold trim, facing straight front.
BOTTOM RIGHT: one entire wooden priest staff, straight slim wooden shaft and ornate open gold
sun-arch at top, amber gem held inside arch. Keep staff straight vertical, no hand. Each part
must be large enough to preserve detailed painted shadows and thin dark outlines, not an icon
or a 3D render. Pieces are to be assembled with invisible overlapping joints. Six parts ONLY,
even spacing, no duplicates.

The accepted construction plate has an open sun ring. That accepted shape is used consistently
in all views; the originally requested suspended gem was not retained as an intermittent detail.

## Directional edits

Each directional edit used the accepted front plate as the edit reference and `canonical.png`
as the identity reference. Instructions preserved the six-cell arrangement, scale, piece heights,
color, illustrated shading and flat magenta background, with these explicit view constraints:

- `front-right-source.png`: 45-degree front three-quarter facing screen right; both eyes with
  far eye narrower; turn neckline, mantle, belt, stole, arm, thigh, boot and staff together.
- `right-source.png`: true 90-degree right profile; one eye; nose right; amber stole on the right
  edge of the torso; boot toe right and heel left; sun ring narrow in profile.
- `back-right-source.png`: 135-degree rear three-quarter, facing away/right; mostly hair and
  right ear, no eyes or front jewel; rear teal cape with small gold sun, rear belt and split
  ivory tunic, no front amber stole; heel lower-left and toe upper-right.
- `back-source.png`: straight 180-degree back, no face or forehead jewel; ivory band across
  nape; back of cape/belt/tunic, heel facing the viewer. The corrective edit changed only the
  boot: narrow flat heel, vertical rear seam, no toe cap or front diagonal gold strap, retaining
  the cuff, knee and size.

To re-author these source drawings, use the same references and prompts, then inspect and register
the outputs before accepting them. An AI retry is not byte-reproducible. To regenerate every
delivered animation byte-for-byte from accepted art and motion, run `yarn priest:build`.
