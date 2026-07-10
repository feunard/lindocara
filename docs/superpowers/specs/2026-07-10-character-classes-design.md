# Character classes — design

2026-07-10. Sub-project B of the next cycle; builds AFTER the React UI rebuild
(`2026-07-10-react-ui-rebuild-design.md`) so the class picker is built once, in React.
Approved shape: three classes — warrior (strong hit, short range), ranger (weak hit, long
range), priest (weak hit, medium range, heals allies). Class and appearance are independent;
class is chosen at creation and permanent. Priest healing is an explicit keypress targeting
the most-injured player in range, self included.

## Goals

- Class chosen at character creation (3×4 combos with the existing appearances), shown on
  the character card and the in-game identity panel; a small class glyph on nameplates.
- Per-class combat: attack damage and range come from the class. Priest gains a heal action
  on a new key (F), server-validated end to end.
- Full FR/EN coverage for class names, descriptions, and new events.

## Non-goals

- No class change/respec, no class-specific weapons/items/skill trees, no monster AI changes
  (aggro ignores healing), no PvP.
- No rebalancing of monsters or XP; only player-side stats change.

## Shared rules (`src/shared/game.ts`)

```
export type PlayerClass = "warrior" | "ranger" | "priest";

CLASS_STATS: Record<PlayerClass, {
  attackBase: number; attackPerLevel: number; attackRange: number;
  heal?: { base: number; perLevel: number; range: number; cooldownMs: number };
}>

warrior: attack 30 + 4/level, range 60
ranger:  attack 16 + 2/level, range 170
priest:  attack 14 + 2/level, range 100
         heal 35 + 3/level, range 130, cooldown 1500ms
```

`attackDamageForLevel(level)` becomes `attackDamageFor(playerClass, level)`;
the global `ATTACK_RANGE` constant is replaced by `CLASS_STATS[klass].attackRange` at every
consumer (server attack validation, client attack-range ring in the renderer). Starting
balance is a spec proposal — tune freely later; the numbers live in one table.

`ATTACK_COOLDOWN_MS` stays global and class-independent. Heal amount:
`healAmountFor(level)` for priest. All pure functions, tested in `test/game.test.ts`.

## Data model

Additive migration 0003: `character.class` text enum `("warrior","ranger","priest")`
NOT NULL DEFAULT `"warrior"` — existing characters become warriors. `profile.ts` maps it
into `PlayerProfile.class`; `characters.ts` `createCharacter(db, accountId, name,
appearance, playerClass)` validates against the closed set (`isValidClass`).

## API

`POST /api/characters` body gains required `class`; invalid → 400 `{error:"invalid_class"}`.
`GET /api/characters` summaries include `class`. Ownership/cap/delete unchanged.

## Protocol

- `PlayerSnapshot` gains `class: PlayerClass` (rendering + range ring need it).
- New client intent: `{ t: "heal" }` — parsed defensively like `attack`/`interact`; dropped
  for non-priests server-side (never trusted).
- New event codes (closed union grows to 18): `heal.cast` `{name, amount}` (to the caster),
  `heal.received` `{name, amount}` (to the target when target ≠ caster), `heal.nobody`
  (caster; no valid target in range). FR/EN templates required by the parity test.

## Server (`world.ts`)

`#heal(ws, player)`:
1. Reject unless `player.class === "priest"`, alive, and `now - lastHealAt >= cooldownMs`.
2. Target = the living connected player within `heal.range` (self included) with the lowest
   `hp / maxHp` ratio strictly below 1. None → `heal.nobody` event, cooldown NOT consumed.
3. Apply `min(maxHp, hp + healAmountFor(level))` to the target, mark both dirty, stamp
   `lastHealAt`, emit `heal.cast` / `heal.received`, send state updates.

`#attack` swaps `ATTACK_RANGE`/`attackDamageForLevel` for the class-aware forms. Snapshots
carry `class`.

## Client

- Input: `F` → heal intent (same edge-triggered pattern as attack/interact in `input.ts`).
  Sent for any class; the server ignores non-priests — but the UI only shows a heal
  cooldown/hint for priests.
- Creation form (React): class picker — three cards with name, one-line description, and the
  stat contrast (damage/range/heal); appearance swatches unchanged beside it.
- Character card + identity panel show the localized class name; nameplates in the renderer
  append a class glyph (`⚔` warrior, `➶` ranger, `✚` priest — final glyphs at implementation,
  from the atlas if suitable sprites exist).
- Renderer attack-range ring radius uses the local player's class range.
- Sounds: `heal.cast`/`heal.received` reuse the loot/level chime family; exact mapping at
  implementation.

## i18n additions (both languages, parity-tested)

`class.warrior|ranger|priest` names; `class.*.blurb` one-liners for the picker;
`event.heal.cast` ("You mend {name} for {amount}." / "Vous soignez {name} : +{amount} PV."),
`event.heal.received` ("{name} mends you for {amount}." / "{name} vous soigne : +{amount}
PV."), `event.heal.nobody` ("No one nearby needs mending." / "Personne à soigner aux
alentours."); `chars.create.class` label; `hud.heal` cooldown label.

## Testing

- `test/game.test.ts`: CLASS_STATS shape, `attackDamageFor`/`healAmountFor` math.
- `test/world.test.ts` (real DO): priest heals the most-injured player in range (two
  clients, one damaged); non-priest heal intent is ignored; heal respects range and
  cooldown; `heal.nobody` when alone at full HP; dead priests cannot heal.
- `test/characters.test.ts`: create with class round-trips; `invalid_class` → 400; summaries
  include class.
- `test/protocol.test.ts`: the heal intent parses and garbage variants are rejected; the
  three new event codes are members of the closed union. (Snapshots keep today's
  shallow-validation pattern — the server is the only emitter.) `test/i18n.test.ts` parity
  covers the new event codes automatically; extend its manual key list with `class.*`.
- Migration: db test asserts the `class` column exists with default warrior.

## Risks / notes

- The heal target choice (lowest hp ratio, self included) is deliberately simple; revisit
  only with real play feedback.
- `PlayerSnapshot` grows by one small field — snapshot size impact negligible.
- CLAUDE.md: add class rules to the architecture notes when this lands (the "server decides
  outcomes" list gains "heals").
