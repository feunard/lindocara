# Slice 3 — One Asset Pack, No Strangers

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move every monster onto the Tiny Swords Enemy Pack — animated, from one artist — and delete the five foreign asset packs, so the game is drawn entirely by one hand.

**Architecture:** Today's monsters are five static PNGs from three unrelated vendor packs (`skeleton`, `orc`, `fantasy-trolls`) sitting next to Tiny Swords terrain, buildings, units and UI. The Enemy Pack is native Tiny Swords — same artist, same 64px world — and ships ~18 animated enemies. The species list is *redefined* to what the art actually has, the renderer animates monsters the way it already animates players, and the strangers are deleted.

**Tech Stack:** TypeScript, PixiJS, Vitest inside workerd.

**Spec:** `docs/superpowers/specs/2026-07-13-tiny-swords-world-reset-design.md` (Slice 3)

## Two things the spec got wrong, which this plan corrects

**1. No character wipe is needed.** The spec calls for wiping production character rows, reasoning that persisted quest progress would reference a species that no longer exists. It does not: `character.quest_chapter` stores a *chapter* (`bone_choir`), never a species, and monsters are pure runtime state. Positions self-heal through `clampRestoredPosition`, which is why the live characters survived Slices 1 and 2 untouched. **Do not wipe anything.** A destructive, irreversible operation that buys nothing is not a simplification.

**2. Art is keyed by species, not kind — and that is already true today.** `MONSTER_STATS` is keyed by `MonsterKind` (5 kinds), but `VENDOR_MONSTER_ART` is keyed by `MonsterSpecies` (9 species). Keep that split. Several species legitimately share a sheet — `goblin_scout` and `goblin_raider` already share `goblin.png` today.

## The redefinition

Five kinds (stat tiers) survive with their numbers unchanged; only their names move onto the art. Nine species survive so every spawn, name and piece of flavour text keeps a home.

| Kind (stats unchanged) | Was | Species | Enemy Pack sheet |
| --- | --- | --- | --- |
| `goblin` (48hp) | `goblin` | `spear_goblin`, `torch_goblin` | Spear Goblin, Torch Goblin |
| `gnoll` (72hp) | `orc` | `gnoll_marauder` | Gnoll |
| `skull` (78hp) | `skeleton` | `skull_guard`, `skull_crusader`, `skull_warden` | Skull (all three) |
| `minotaur` (110hp) | `ogre` | `minotaur_brute` | Minotaur |
| `troll` (145hp) | `troll` | `mire_troll`, `gate_troll` | Troll (both) |

The three `skull_*` species sharing one sheet costs nothing: they already share a stat block (all `kind: skeleton`, 78hp), so they were always the same monster wearing three names.

**`bone_choir` survives** — it counts `monster.kind === "skull"` instead of `"skeleton"`. `src/server/world.ts`'s `#creditSkeletonQuest` is the only place that reads it.

## Global Constraints

- **Nothing persisted references a monster.** Do not write a D1 migration. Do not wipe characters. If you think you need to, you have misunderstood something — stop and say so.
- **`MONSTER_STATS` numbers do not change.** 48/72/78/110/145 hp and their damage/speed/xp stay exactly as they are. This slice changes *art and names*, not balance.
- **The server decides outcomes.** Monster state is server-authoritative; the client only draws it.
- **`src/shared/` is platform-free** — compiled by BOTH `tsconfig.client.json` and `tsconfig.worker.json`. No DOM, no Workers API, no Node API.
- **`src/client/game/` must not import React.**
- **Every player-facing string lives in `src/shared/i18n/` in BOTH `en.ts` and `fr.ts`.** `fr.ts` is typed `Record<MessageKey, string>`, so a missing French key is a typecheck failure. Renaming a species means renaming its `monster.*` key in both.
- Biome's `noNonNullAssertion` is ON. No `!` assertions.
- Movement, collision and the tilemap must NOT change. Nothing may quantise a position.
- `npm run check` must be green before every commit. **Never run two `npm run check` invocations at once** — the World Durable Object is a process-wide singleton and concurrent runs make `test/mission-2a.test.ts` time out spuriously.

---

### Task 1: Redefine the species

Server-side only. The client will not compile until Task 3, which is expected and fine — but the *server* tests must pass, so run them.

**Files:**
- Modify: `src/shared/game.ts` (`MonsterKind`, `MonsterSpecies`, `MONSTER_STATS`, `MONSTER_SPAWNS`)
- Modify: `src/server/world.ts` (`#creditSkeletonQuest`'s kind check)
- Modify: `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts` (the nine `monster.*` keys)
- Test: `test/game.test.ts`

**Interfaces:**
- Produces, for Tasks 2–3: `MonsterKind = "goblin" | "gnoll" | "skull" | "minotaur" | "troll"`; `MonsterSpecies = "spear_goblin" | "torch_goblin" | "gnoll_marauder" | "skull_guard" | "skull_crusader" | "skull_warden" | "minotaur_brute" | "mire_troll" | "gate_troll"`.

- [ ] **Step 1: Write the failing test**

Add to `test/game.test.ts`:

```ts
// This slice moves the monsters onto the one art pack the rest of the game already uses. The stat
// tiers are unchanged — only their names move onto the art.
describe("the Tiny Swords bestiary", () => {
  it("keeps the five stat tiers exactly as they were", () => {
    expect(MONSTER_STATS.goblin).toEqual({ maxHp: 48, damage: 7, speed: 105, xp: 28 });
    expect(MONSTER_STATS.gnoll).toEqual({ maxHp: 72, damage: 10, speed: 88, xp: 42 });
    expect(MONSTER_STATS.skull).toEqual({ maxHp: 78, damage: 11, speed: 82, xp: 48 });
    expect(MONSTER_STATS.minotaur).toEqual({ maxHp: 110, damage: 14, speed: 65, xp: 62 });
    expect(MONSTER_STATS.troll).toEqual({ maxHp: 145, damage: 16, speed: 60, xp: 78 });
  });

  it("gives every spawned species a stat tier that exists", () => {
    for (const spawn of MONSTER_SPAWNS) {
      expect(MONSTER_STATS[spawn.kind], `${spawn.id} has kind ${spawn.kind}`).toBeDefined();
    }
  });

  // bone_choir asks you to put the choir back to rest. It counts undead, and the undead are now
  // Skulls. If this breaks, a live character mid-quest can never finish it.
  it("keeps a bone_choir quest completable — the undead still exist and still spawn", () => {
    const undead = MONSTER_SPAWNS.filter((spawn) => spawn.kind === "skull");
    const target = QUEST_DEFINITIONS.find((quest) => quest.chapter === "bone_choir")?.target ?? 0;
    expect(target).toBeGreaterThan(0);
    expect(undead.length).toBeGreaterThanOrEqual(target);
  });
});
```

Import `MONSTER_STATS`, `MONSTER_SPAWNS` and `QUEST_DEFINITIONS` from `../src/shared/game.js` if they are not already imported in that file.

- [ ] **Step 2: Run it and watch it fail**

```bash
npx vitest run test/game.test.ts
```

Expected: FAIL — `MONSTER_STATS.gnoll` is undefined (the kind is still called `orc`).

- [ ] **Step 3: Rename the kinds and species**

In `src/shared/game.ts`:

```ts
/** The stat tiers. Renamed onto the Tiny Swords Enemy Pack; the numbers below are unchanged. */
export type MonsterKind = "goblin" | "gnoll" | "skull" | "minotaur" | "troll";

export type MonsterSpecies =
  | "spear_goblin"
  | "torch_goblin"
  | "gnoll_marauder"
  | "skull_guard"
  | "skull_crusader"
  | "skull_warden"
  | "minotaur_brute"
  | "mire_troll"
  | "gate_troll";
```

and rename the three keys in `MONSTER_STATS` (`orc` → `gnoll`, `ogre` → `minotaur`, `skeleton` → `skull`) **without touching a single number**.

Then rename the `species` and `kind` fields of every entry in `MONSTER_SPAWNS`, one-for-one:

| old species | new species | old kind | new kind |
| --- | --- | --- | --- |
| `goblin_scout` | `spear_goblin` | `goblin` | `goblin` |
| `goblin_raider` | `torch_goblin` | `goblin` | `goblin` |
| `orc_marauder` | `gnoll_marauder` | `orc` | `gnoll` |
| `ogre_brute` | `minotaur_brute` | `ogre` | `minotaur` |
| `bone_guard` | `skull_guard` | `skeleton` | `skull` |
| `bone_crusader` | `skull_crusader` | `skeleton` | `skull` |
| `bone_warden` | `skull_warden` | `skeleton` | `skull` |
| `mire_troll` | `mire_troll` | `troll` | `troll` |
| `gate_troll` | `gate_troll` | `troll` | `troll` |

Do NOT change any spawn's coordinates, patrol radius or zone. Their positions were validated against the tilemap in a previous slice, and moving one could put a monster in a wall.

- [ ] **Step 4: Fix the quest's kind check**

In `src/server/world.ts`, `#creditSkeletonQuest` reads `monster.kind !== "skeleton"`. Change it to `"skull"`. Rename the method to `#creditUndeadQuest` while you are there — it never counted skeletons *the type*, it counted the undead, and the name should say what it means now.

- [ ] **Step 5: Rename the strings, in both languages**

In `src/shared/i18n/en.ts`, the nine `monster.*` keys are renamed. Keep the *flavour* — these are the world's names for these creatures, not translations of the species id:

```ts
  "monster.spear_goblin": "Road Goblin",
  "monster.torch_goblin": "Briar Goblin",
  "monster.gnoll_marauder": "Sunwake Marauder",
  "monster.minotaur_brute": "Rootland Brute",
  "monster.skull_guard": "Elderfall Guard",
  "monster.skull_crusader": "Bone Crusader",
  "monster.skull_warden": "Choir Warden",
  "monster.mire_troll": "Mire Troll",
  "monster.gate_troll": "Gate Troll",
```

Rename the same nine keys in `src/shared/i18n/fr.ts`, keeping their existing French prose. `fr.ts` is typed `Record<MessageKey, string>` — a key you rename in one file and not the other is a typecheck failure, not a runtime surprise.

- [ ] **Step 6: Keep the client compiling — rename the keys, not the art**

`src/client/game/vendor-art.ts`'s `VENDOR_MONSTER_ART` is a `Record<MonsterSpecies, string>`, so renaming the species breaks its exhaustiveness and the tree stops compiling.

**This task keeps the old PNGs and just renames the keys.** Task 2 swaps the art; Task 3 animates it. That way every task commits a green tree, which is the whole point of slicing them:

```ts
export const VENDOR_MONSTER_ART: Record<MonsterSpecies, string> = {
  spear_goblin: `${ROOT}/monsters/goblin.png`,
  torch_goblin: `${ROOT}/monsters/goblin.png`,
  gnoll_marauder: `${ROOT}/monsters/orc.png`,
  minotaur_brute: `${ROOT}/monsters/ogre.png`,
  skull_guard: `${ROOT}/monsters/skeleton-1.png`,
  skull_crusader: `${ROOT}/monsters/skeleton-2.png`,
  skull_warden: `${ROOT}/monsters/skeleton-3.png`,
  mire_troll: `${ROOT}/monsters/troll-1.png`,
  gate_troll: `${ROOT}/monsters/troll-2.png`,
};
```

Yes, a species called `minotaur_brute` briefly points at `ogre.png`. That is fine for exactly one commit, and it is much better than a task that cannot be reviewed because it does not build.

- [ ] **Step 7: Full check, then commit**

```bash
npm run check
git add src/shared/game.ts src/server/world.ts src/shared/i18n/ src/client/game/vendor-art.ts test/game.test.ts
git commit -m "Rename the bestiary onto the Tiny Swords Enemy Pack's creatures"
```

---

### Task 2: Vendor the Enemy Pack art

**Files:**
- Create: `assets/vendor/tiny-swords/Enemies/**` and `public/assets/lindocara/tiny-swords/enemies/**` (the five sheets, three animations each)
- Create: `src/client/game/enemy-art.ts`
- Delete: `src/client/game/vendor-art.ts`

**Interfaces:**
- Produces, for Task 3:
  ```ts
  export interface EnemySheet { readonly source: string; readonly frame: number; readonly frames: number }
  export interface EnemyArt { readonly idle: EnemySheet; readonly run: EnemySheet; readonly attack: EnemySheet }
  export const TINY_SWORDS_ENEMIES: Record<MonsterSpecies, EnemyArt>
  ```

- [ ] **Step 1: The art, already measured**

The pack is at `assets/Tiny Swords (Enemy Pack)/Enemy Pack/Enemies/`. It is **untracked** — `git status` will show it.

You need five enemies, three animations each. The sheets are single-row horizontal strips, so the frame size is the sheet's **height** and the frame count is `width / height`. **Each enemy has a different frame size.** These are measured, not guessed — every sheet divides cleanly:

| source file | frame | frames |
| --- | --- | --- |
| `Goblin Raiders/Spear Goblin/Spear Goblin_Idle.png` | 256 | 8 |
| `Goblin Raiders/Spear Goblin/Spear Goblin_Run.png` | 256 | 6 |
| `Goblin Raiders/Spear Goblin/Spear Goblin_Attack Fast.png` | 256 | 7 |
| `Goblin Raiders/Torch Goblin/Torch Goblin_Idle.png` | 192 | 8 |
| `Goblin Raiders/Torch Goblin/Torch Goblin_Run.png` | 192 | 6 |
| `Goblin Raiders/Torch Goblin/Torch Goblin_Attack.png` | 192 | 8 |
| `Gnoll/Gnoll_Idle.png` | 192 | 6 |
| `Gnoll/Gnoll_Walk.png` | 192 | 8 |
| `Gnoll/Gnoll_Throw.png` | 192 | 8 |
| `Skull/Skull_Idle.png` | 192 | 8 |
| `Skull/Skull_Run.png` | 192 | 6 |
| `Skull/Skull_Attack.png` | 192 | 7 |
| `Minotaur/Minotaur_Idle.png` | 320 | 16 |
| `Minotaur/Minotaur_Walk.png` | 320 | 8 |
| `Minotaur/Minotaur_Attack.png` | 320 | 12 |
| `Troll/Troll_Idle.png` | 384 | 12 |
| `Troll/Troll_Walk.png` | 384 | 10 |
| `Troll/Troll_Attack.png` | 384 | 6 |

**Verify these yourself before using them** (`PIL` is available: `Image.open(path).size`). If a sheet's width is not an exact multiple of its height, stop and report — it is not a clean strip and slicing it will produce a sliding smear of half-frames.

The Troll's attack is also split across `Troll_Windup` and `Troll_Recovery`. **Use `Troll_Attack` alone.** The wind-up/recovery telegraph is what the *next* project (real directional hitbox combat) is for; wiring a telegraph into a combat model that auto-aims at the nearest thing in a 360° circle would be worse than having none.

- [ ] **Step 2: Vendor and serve the files**

Copy the sheets into `assets/vendor/tiny-swords/Enemies/<Enemy>/` and into `public/assets/lindocara/tiny-swords/enemies/<enemy>/`. Follow exactly how the terrain and building textures already do it — see `TINY_SWORDS_ROOT = "/assets/lindocara/tiny-swords"` in `src/client/game/tiny-swords-art.ts` and what is already under `public/assets/lindocara/tiny-swords/`.

Normalise the paths: the source directory has spaces and parentheses, and the destination must not.

- [ ] **Step 3: Write the art table**

Create `src/client/game/enemy-art.ts`, replacing `vendor-art.ts`. Fill in the **real measured numbers** from Step 1 — the ones below are placeholders for the shape, not the values:

```ts
/**
 * The Tiny Swords Enemy Pack — the same artist, the same 64px world, and the same pack that already
 * draws the terrain, the buildings, the player classes and the UI. It replaces three unrelated vendor
 * packs whose only thing in common was that none of them matched anything else.
 *
 * Every enemy has its own frame size. They are single-row horizontal strips, so `frame` is the
 * sheet's height and `frames` is its width divided by that. Measure; do not guess.
 */
import type { MonsterSpecies } from "../../shared/game.js";
import { TINY_SWORDS_ROOT } from "./tiny-swords-art.js";

const ROOT = `${TINY_SWORDS_ROOT}/enemies`;

export interface EnemySheet {
  readonly source: string;
  /** Width and height of one frame, in pixels. Differs per enemy. */
  readonly frame: number;
  readonly frames: number;
}

export interface EnemyArt {
  readonly idle: EnemySheet;
  readonly run: EnemySheet;
  readonly attack: EnemySheet;
}

/** Several species share a sheet, exactly as `goblin_scout` and `goblin_raider` shared one before:
 *  the three `skull_*` species already share a stat block, so they were always one monster in three
 *  coats. */
const GOBLIN = {
  idle: { source: `${ROOT}/spear-goblin/idle.png`, frame: 256, frames: 8 },
  run: { source: `${ROOT}/spear-goblin/run.png`, frame: 256, frames: 6 },
  attack: { source: `${ROOT}/spear-goblin/attack.png`, frame: 256, frames: 7 },
} as const satisfies EnemyArt;

const TORCH = {
  idle: { source: `${ROOT}/torch-goblin/idle.png`, frame: 192, frames: 8 },
  run: { source: `${ROOT}/torch-goblin/run.png`, frame: 192, frames: 6 },
  attack: { source: `${ROOT}/torch-goblin/attack.png`, frame: 192, frames: 8 },
} as const satisfies EnemyArt;

const GNOLL = {
  idle: { source: `${ROOT}/gnoll/idle.png`, frame: 192, frames: 6 },
  run: { source: `${ROOT}/gnoll/run.png`, frame: 192, frames: 8 },
  attack: { source: `${ROOT}/gnoll/attack.png`, frame: 192, frames: 8 },
} as const satisfies EnemyArt;

const SKULL = {
  idle: { source: `${ROOT}/skull/idle.png`, frame: 192, frames: 8 },
  run: { source: `${ROOT}/skull/run.png`, frame: 192, frames: 6 },
  attack: { source: `${ROOT}/skull/attack.png`, frame: 192, frames: 7 },
} as const satisfies EnemyArt;

const MINOTAUR = {
  idle: { source: `${ROOT}/minotaur/idle.png`, frame: 320, frames: 16 },
  run: { source: `${ROOT}/minotaur/run.png`, frame: 320, frames: 8 },
  attack: { source: `${ROOT}/minotaur/attack.png`, frame: 320, frames: 12 },
} as const satisfies EnemyArt;

const TROLL = {
  idle: { source: `${ROOT}/troll/idle.png`, frame: 384, frames: 12 },
  run: { source: `${ROOT}/troll/run.png`, frame: 384, frames: 10 },
  attack: { source: `${ROOT}/troll/attack.png`, frame: 384, frames: 6 },
} as const satisfies EnemyArt;

export const TINY_SWORDS_ENEMIES: Record<MonsterSpecies, EnemyArt> = {
  spear_goblin: GOBLIN,
  torch_goblin: TORCH,
  gnoll_marauder: GNOLL,
  skull_guard: SKULL,
  skull_crusader: SKULL,
  skull_warden: SKULL,
  minotaur_brute: MINOTAUR,
  mire_troll: TROLL,
  gate_troll: TROLL,
};
```

`vendor-art.ts` also exports `VENDOR_QUEST_ART` (`wood` / `gold` / `meat`), used by the quest sites. Those three are **not** monster art and must survive — move them into `tiny-swords-art.ts` (or leave `vendor-art.ts` holding only them) rather than deleting them by accident. Task 4 deletes the packs; do not delete a texture something still draws.

- [ ] **Step 4: Prove the art is served**

```bash
npm run dev
curl -sI http://localhost:5173/assets/lindocara/tiny-swords/enemies/troll/idle.png
```

Check **every** sheet you added. A 404 here becomes an invisible monster in Task 3 and will waste an hour. Report the real status codes and content lengths.

- [ ] **Step 5: Check and commit**

Nothing imports `TINY_SWORDS_ENEMIES` yet — Task 3 does — so the tree still compiles and the suite still passes. That is deliberate: this task ships the art and its table, and can be reviewed on its own.

```bash
npm run check
git add assets/ public/ src/client/game/
git commit -m "Vendor the Tiny Swords Enemy Pack and its animation table"
```

---

### Task 3: Animate the monsters

**Files:**
- Modify: `src/client/game/renderer.ts` (monster texture loading and drawing)

**Interfaces:**
- Consumes: `TINY_SWORDS_ENEMIES`, `EnemyArt`, `EnemySheet` (Task 2); `MonsterSpecies` (Task 1).

- [ ] **Step 1: Read how players are already animated**

`src/client/game/renderer.ts` around line 318 slices the player unit sheets into frame arrays:

```ts
units[definition.source] = Array.from({ length: definition.frames }, (_, frame) =>
  new Texture({
    source: sheet.source,
    frame: new Rectangle(frame * TINY_SWORDS_UNIT_FRAME, 0, TINY_SWORDS_UNIT_FRAME, TINY_SWORDS_UNIT_FRAME),
    label: `${definition.source}:${frame}`,
  }),
);
```

**That is the pattern.** The only difference for enemies is that `TINY_SWORDS_UNIT_FRAME` is a constant (192) while each enemy carries its own `frame` size. Read how the player's frame is *advanced* each tick and which animation is chosen (idle vs run vs attack) — do the same for monsters rather than inventing a second animation system.

Today monsters are drawn from `VENDOR_MONSTER_ART` as a **single static `Texture` per species** (renderer.ts around line 369). That is what you are replacing.

- [ ] **Step 2: Slice the enemy sheets**

Load and slice all three animations for every species, once, at art-load time. Set `scaleMode = "nearest"` on each source — the existing monster loader sets `"linear"`, which blurs pixel art; the Tiny Swords sheets are pixel art and every other Tiny Swords texture in this file already uses `"nearest"`. Say in your report that you changed it and why.

- [ ] **Step 3: Drive the animation from the monster's state**

A monster snapshot (`MonsterSnapshot` in `src/shared/protocol.ts`) carries `x`, `y`, `hp`, `dead` and `species`. Choose the animation from what the client can already see:

- moving (its interpolated position changed since the last frame) → `run`
- otherwise → `idle`
- `attack` when the server tells you it attacked. Check what already exists: the renderer plays effects on `combat.hit` / `combat.hurt` events, and `playAttack` already exists for players. Follow that; do not add anything to the wire.

**Do not add a field to the protocol.** The server decides outcomes; the client draws them. If you find yourself wanting to send an animation name over the socket, stop — the information is already there.

- [ ] **Step 4: Check the sprite size on screen**

The frames are 192–384px but the monsters are 32px entities in a 64px-tile world. The existing code already scales the static monster textures to a sensible on-screen size — find that and keep it, per-species if the frame sizes demand it. A Troll drawn at its native 384px would be six tiles tall.

- [ ] **Step 5: Look at it**

```bash
npm run dev
```

Every one of the five sheets must be seen. Find a goblin, a gnoll, a skull, a minotaur and a troll — or spawn near them — and confirm:
- They animate (idle sways; running legs move) and are not a static frame or a sliding smear of half-frames (that means a wrong frame size).
- They are the right size on screen — not a giant, not an ant.
- They are crisp, not blurred (`nearest`, not `linear`).
- The attack animation fires when they hit you.

Screenshot to `docs/screenshots/tiny-swords-enemies.png`.

- [ ] **Step 6: Full check, then commit**

```bash
npm run check
```

This is the first point at which the whole tree compiles again. Commit Tasks 1–3 together if they were held.

```bash
git add -A
git commit -m "Move the bestiary onto the Tiny Swords Enemy Pack, animated"
```

---

### Task 4: Delete the strangers

**Files:**
- Delete: `assets/vendor/skeleton/`, `assets/vendor/orc/`, `assets/vendor/fantasy-trolls/`, `assets/ForgottenMemories/`, `assets/Resurrected RPG 1.1/`, `assets/Icons32x32/`
- Delete: the corresponding files under `public/assets/lindocara/vendor/`
- Delete: `assets/vendor/tiny-swords/Terrain/Tileset/` (the OLD 576x384 terrain sheet — superseded and dangerous)
- Modify: whatever still references them

- [ ] **Step 1: Find every reference before deleting anything**

```bash
grep -rln "vendor/skeleton\|vendor/orc\|fantasy-trolls\|ForgottenMemories\|Resurrected\|Icons32x32\|VENDOR_MONSTER_ART\|Tilemap_color" src/ public/ scripts/ test/
```

Anything that still points at a pack you are about to delete is a 404 waiting to happen. Resolve every hit before you `rm` anything.

**The old terrain sheet is a trap worth naming.** `assets/vendor/tiny-swords/Terrain/Tileset/Tilemap_color1.png` (576×384) is a *different layout* from the `Tilemap_Flat.png` (640×256) the autotiler was built against. It is superseded, and leaving it around means someone eventually loads it and renders the entire world with its shorelines inside out. Delete it.

- [ ] **Step 2: Delete, and check what shrank**

```bash
du -sh assets/ public/assets/
git rm -r --cached <the packs>   # if tracked
rm -rf <the packs>
du -sh assets/ public/assets/
```

Report the real before/after sizes. Do not invent them.

- [ ] **Step 3: Check the licence question is closed**

There is no licence file anywhere in `assets/`. Now that exactly one pack remains, add one: record what Tiny Swords is, where it came from, and under what terms it is used. A deployed game with unattributed art is a real risk, and it is a two-minute fix while there is one pack to describe.

- [ ] **Step 4: Full check, then commit**

```bash
npm run check
npm run build
```

`npm run build` matters here: a deleted asset that something still imports fails at *bundle* time, not test time.

```bash
git add -A
git commit -m "Delete the five foreign asset packs; Tiny Swords is the only artist now"
```

---

### Task 5: Verify in the running game, then deploy

- [ ] **Step 1: Drive it**

```bash
npm run dev
```

**The trap from CLAUDE.md:** `vite dev` stacks Worker versions and a stale Durable Object keeps broadcasting. If your square teleports between fixed positions, restart the dev server.

Confirm, with coordinates:
- All five enemy types animate correctly, at a sensible size, crisp.
- Combat still works: you can hit them, they hit you, they die, they drop loot, they respawn.
- **A `bone_choir` quest can still be completed** — accept it, kill three Skulls, and turn it in. This is the one thing a species rename could plausibly have broken, and a live character may be mid-quest right now.
- Guards still kill monsters that wander into the safe zone, and still grant no XP or loot for it.
- Nothing else regressed: movement, the tiled world, the minimap, the corpse run.

- [ ] **Step 2: Deploy**

```bash
npm run check
git push
```

CI deploys on push to `main`. Confirm:

```bash
gh run list --branch main --limit 1
curl -s -o /dev/null -w "%{http_code}\n" https://lindocara.alepha.dev/
```

- [ ] **Step 3: Verify on live**

Drive the deployed site. Confirm the enemies animate and a `bone_choir` quest completes. Report what you saw.
