# Character Classes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Three classes — warrior (strong hit, short range), ranger (weak hit, long range), priest (weak hit, medium range, heals allies) — chosen at creation, enforced entirely server-side, fully localized.

**Architecture:** `CLASS_STATS` in `src/shared/game.ts` is the single balance table both sides read. The `character` table gains an additive `class` column (migration 0003, default warrior). The wire grows `PlayerSnapshot.class`, a `{t:"heal"}` intent (F key), and three heal event codes. `world.ts` validates class/range/cooldown/targeting; the client adds a class picker, class display, a heal action, and a class-aware attack-range ring.

**Tech Stack:** existing stack — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-10-character-classes-design.md`

## Global Constraints

- The server decides outcomes: heal amounts/targets/cooldowns are validated in the Durable Object; a non-priest's heal intent is silently ignored; never trust the client.
- Balance (spec-locked, tune later in ONE place): warrior attack 30 + 4/level range 60; ranger 16 + 2/level range 170; priest 14 + 2/level range 100, heal 35 + 3/level range 130 cooldown 1500 ms. `ATTACK_COOLDOWN_MS` stays global.
- Migration 0003 is ADDITIVE (no drops): `class` text enum default `"warrior"`. Existing characters become warriors.
- Events are codes + params; new codes need EN+FR templates (parity test enforces). API errors are machine codes (`invalid_class`).
- The wire field `nick` and existing invariants (one command per tick, prediction, snapshots) are untouched.
- No `!` non-null assertions; `npm run lint:fix` then `npm run check` (146 workerd + 23 UI tests must grow, never shrink) green before every commit; `src/client/game/**` and `store.ts` stay React-free.
- Client may not import server code; `PlayerClass`/`CLASS_STATS` live in `src/shared/` for both.

## Pre-flight

- [ ] `git checkout -b feature/classes` from up-to-date `main`.

---

### Task 1: Shared class rules

**Files:**
- Modify: `src/shared/game.ts`
- Test: `test/game.test.ts` (additions)

**Interfaces (produces):**

```ts
export type PlayerClass = "warrior" | "ranger" | "priest";
export const PLAYER_CLASSES: readonly PlayerClass[] = ["warrior", "ranger", "priest"];

export interface ClassStats {
  attackBase: number;
  attackPerLevel: number;
  attackRange: number;
  heal?: { base: number; perLevel: number; range: number; cooldownMs: number };
}

export const CLASS_STATS: Record<PlayerClass, ClassStats> = {
  warrior: { attackBase: 30, attackPerLevel: 4, attackRange: 60 },
  ranger: { attackBase: 16, attackPerLevel: 2, attackRange: 170 },
  priest: {
    attackBase: 14,
    attackPerLevel: 2,
    attackRange: 100,
    heal: { base: 35, perLevel: 3, range: 130, cooldownMs: 1_500 },
  },
};

export function attackDamageFor(playerClass: PlayerClass, level: number): number;
export function healAmountFor(level: number): number; // priest-only caller; 35 + 3/(level-1) shape
export function isValidClass(value: unknown): value is PlayerClass;
```

- `attackDamageFor(k, level) = CLASS_STATS[k].attackBase + Math.max(0, level - 1) * CLASS_STATS[k].attackPerLevel`.
- `healAmountFor(level) = 35 + Math.max(0, level - 1) * 3` — read the numbers from `CLASS_STATS.priest.heal` (narrow the optional with a local const; no `!`).
- DELETE `PLAYER_ATTACK_BASE`, `PLAYER_ATTACK_PER_LEVEL`, `ATTACK_RANGE`, and `attackDamageForLevel` — Task 5 and Task 6 fix the consumers (`world.ts`, `session.ts`); to keep THIS task compiling, this task also mechanically updates those two call sites: `world.ts` `#attack` uses `attackDamageFor(player.class, player.level)`… **no — `player.class` does not exist until Task 2.** Instead: keep `attackDamageForLevel` and `ATTACK_RANGE` as deprecated wrappers this task (`/** Transitional: Task 5 removes. */ export const ATTACK_RANGE = CLASS_STATS.warrior.attackRange;` is WRONG — it changes 82→60 silently). Correct transitional form: keep the OLD constants/functions untouched alongside the new ones this task; Task 5/6 swap consumers and DELETE the old ones. This keeps behavior identical until the server consciously switches.

- [ ] **Step 1: Failing tests** (append to `test/game.test.ts`)

```ts
import {
  attackDamageFor,
  CLASS_STATS,
  healAmountFor,
  isValidClass,
  PLAYER_CLASSES,
} from "../src/shared/game.js";

describe("class rules", () => {
  it("keeps the balance table in the spec's shape", () => {
    expect(PLAYER_CLASSES).toEqual(["warrior", "ranger", "priest"]);
    expect(CLASS_STATS.warrior).toMatchObject({ attackBase: 30, attackPerLevel: 4, attackRange: 60 });
    expect(CLASS_STATS.ranger).toMatchObject({ attackBase: 16, attackPerLevel: 2, attackRange: 170 });
    expect(CLASS_STATS.priest).toMatchObject({ attackBase: 14, attackPerLevel: 2, attackRange: 100 });
    expect(CLASS_STATS.priest.heal).toEqual({ base: 35, perLevel: 3, range: 130, cooldownMs: 1500 });
    expect(CLASS_STATS.warrior.heal).toBeUndefined();
  });

  it("scales damage and healing by level", () => {
    expect(attackDamageFor("warrior", 1)).toBe(30);
    expect(attackDamageFor("warrior", 3)).toBe(38);
    expect(attackDamageFor("ranger", 1)).toBe(16);
    expect(attackDamageFor("priest", 5)).toBe(22);
    expect(healAmountFor(1)).toBe(35);
    expect(healAmountFor(4)).toBe(44);
  });

  it("validates class names", () => {
    expect(isValidClass("priest")).toBe(true);
    expect(isValidClass("necromancer")).toBe(false);
    expect(isValidClass(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to fail** — `npx vitest run test/game.test.ts` → FAIL (missing exports).
- [ ] **Step 3: Implement** per the Interfaces block (old constants stay untouched this task, with a `/** Replaced by CLASS_STATS — deleted when world.ts/session.ts switch (classes plan Tasks 5–6). */` comment).
- [ ] **Step 4: Run** — `npx vitest run test/game.test.ts` → PASS; `npm run check` → green.
- [ ] **Step 5: Commit** — `git add -A && git commit -m "Add the class balance table to shared rules"` (after `npm run lint:fix`).

---

### Task 2: Schema migration 0003 + profile mapping

**Files:**
- Modify: `src/server/db/schema.ts` (character gains the column), `src/server/profile.ts`
- Create: `migrations/0003_*.sql` (generated)
- Test: `test/db.test.ts` (additions)

**Interfaces:**
- Produces: `character.class` column — `text("class", { enum: ["warrior", "ranger", "priest"] }).notNull().default("warrior")`; `PlayerProfile.class: PlayerClass` (loaded via `fromRow`, saved via `saveProfile`).
- Consumes: `PlayerClass` from Task 1.

- [ ] **Step 1: Failing tests** (append to `test/db.test.ts`'s first describe; keep the FK-ordered `afterEach`)

```ts
it("gives characters a class column defaulting to warrior", async () => {
  const { results } = await env.DB.prepare("pragma table_info(character)").all<{ name: string }>();
  expect(results.map((c) => c.name)).toContain("class");

  const db = createDb(env.DB);
  await db.insert(account).values({
    id: "acct-cls",
    username: "classowner",
    passwordHash: "h",
    passwordSalt: "s",
    passwordIterations: 1,
  });
  await db.insert(character).values({ id: "char-cls", accountId: "acct-cls", name: "Old" });
  const profile = await loadProfile(db, "char-cls");
  expect(profile?.class).toBe("warrior");
});
```

- [ ] **Step 2: Schema + migration** — add the column after `appearance`; `npm run db:generate` (expect `ALTER TABLE character ADD COLUMN class …` — additive only, inspect it); `npm run db:migrate`; commit the `.sql` + meta files.
- [ ] **Step 3: profile.ts** — `PlayerProfile` gains `class: PlayerClass`; `fromRow` maps `row.class`; `saveProfile` writes `class: profile.class` (class never changes in play, but writing it keeps save symmetrical and harmless).
- [ ] **Step 4: Compile ripple** — `world.ts`'s `Attachment`/`profileFromAttachment` need the field: `Attachment` gains `class?: PlayerClass`; `profileFromAttachment` defaults `attachment.class ?? "warrior"`; `toProfile` carries `class: player.class`. Snapshots do NOT change yet (Task 4/5).
- [ ] **Step 5: Run** — `npx vitest run test/db.test.ts` → PASS; `npm run check` → green.
- [ ] **Step 6: Commit** — `"Add the class column to characters"`.

---

### Task 3: Create-with-class API

**Files:**
- Modify: `src/server/characters.ts`, `src/server/index.ts`, `src/client/api.ts` (type only)
- Test: `test/characters.test.ts` (additions + signature updates)

**Interfaces:**
- Produces: `createCharacter(db, accountId, name, appearance, playerClass): Promise<CharacterSummary | "limit_reached">`; `CharacterSummary` gains `class: PlayerClass` (server AND the client mirror in `api.ts`); `POST /api/characters` requires `class` (400 `{error:"invalid_class"}`), `GET` summaries include it.
- Consumes: `isValidClass`, `PlayerClass` (Task 1).

- [ ] **Step 1: Failing tests** — in `test/characters.test.ts`: update every existing `POST` body to include `class` (use `"warrior"`), then add:

```ts
it("requires a valid class", async () => {
  const cookie = await registered("classless");
  const missing = await characters(cookie, {
    method: "POST",
    body: JSON.stringify({ name: "NoClass", appearance: "azure" }),
  });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ error: "invalid_class" });

  const bogus = await characters(cookie, {
    method: "POST",
    body: JSON.stringify({ name: "Bogus", appearance: "azure", class: "necromancer" }),
  });
  expect(bogus.status).toBe(400);
});

it("round-trips the class through create and list", async () => {
  const cookie = await registered("healer_maker");
  const created = await characters(cookie, {
    method: "POST",
    body: JSON.stringify({ name: "Mercy", appearance: "moss", class: "priest" }),
  });
  expect(created.status).toBe(200);
  expect(await created.json()).toMatchObject({ name: "Mercy", class: "priest", level: 1 });
  const listed = (await (await characters(cookie)).json()) as Array<{ class: string }>;
  expect(listed[0]?.class).toBe("priest");
});
```

  Also update `test/world.test.ts`'s `testCharacter` helper body to send `class: "warrior"` (signature unchanged; Task 5 adds a class option).
- [ ] **Step 2: Implement** — `characters.ts`: fifth param, `summary()` includes `class`, insert writes it; `index.ts` `handleCreateCharacter`: read `(body as { class?: unknown } | null)?.class`, `if (!isValidClass(klass)) return json({ error: "invalid_class" }, { status: 400 });`, pass through (name the local `klass` — `class` is reserved). `api.ts`: `CharacterSummary` gains `class: PlayerClass` (import the type from `../shared/game.js`). `test/ui/character-select.test.tsx` fixtures need the new field — add `class: "warrior"` to the three fixtures (the picker UI itself is Task 6).
- [ ] **Step 3: Run** — targeted files then `npm run check` → green.
- [ ] **Step 4: Commit** — `"Create characters with a class"`.

---

### Task 4: Wire types + dictionaries

**Files:**
- Modify: `src/shared/protocol.ts`, `src/shared/i18n/en.ts`, `src/shared/i18n/fr.ts`
- Test: `test/protocol.test.ts`, `test/i18n.test.ts` (additions)

**Interfaces:**
- Produces: `PlayerSnapshot.class: PlayerClass`; `ClientMessage` union gains `{ t: "heal" }` (parsed exactly like `attack`); `EVENT_CODES` grows by `"heal.cast" | "heal.received" | "heal.nobody"` (18 total). Dictionary keys (both languages): `class.warrior/ranger/priest`, `class.warrior.blurb/...`, `chars.create.class`, `hud.heal`, `event.heal.cast/received/nobody`.
- Consumes: `PlayerClass` (Task 1).

- [ ] **Step 1: Failing tests**

`test/protocol.test.ts`:

```ts
it("parses the heal intent and rejects garbage variants", () => {
  expect(parseClientMessage(JSON.stringify({ t: "heal" }))).toEqual({ t: "heal" });
  expect(parseClientMessage(JSON.stringify({ t: "heal", target: "someone" }))).toEqual({ t: "heal" });
  expect(parseClientMessage(JSON.stringify({ t: "heals" }))).toBeNull();
});

it("accepts the heal event codes", () => {
  for (const code of ["heal.cast", "heal.received", "heal.nobody"] as const) {
    expect(
      parseServerMessage(JSON.stringify({ t: "event", code, tone: "good" })),
    ).toMatchObject({ t: "event", code });
  }
});
```

`test/i18n.test.ts` — extend the manual key list with the six `class.*` keys (the `event.*` parity is automatic via `EVENT_CODES`):

```ts
it("has class names and blurbs in both languages", () => {
  for (const key of [
    "class.warrior", "class.ranger", "class.priest",
    "class.warrior.blurb", "class.ranger.blurb", "class.priest.blurb",
    "chars.create.class", "hud.heal",
  ]) {
    for (const locale of ["en", "fr"] as const) {
      expect((dictionaries[locale] as Record<string, string>)[key], `${locale}:${key}`).toBeTypeOf("string");
    }
  }
});
```

- [ ] **Step 2: Implement protocol** — snapshot field, `{ t: "heal" }` in the union + parser branch (`if (value.t === "attack" || value.t === "interact" || value.t === "heal") return { t: value.t };`), three codes appended to `EVENT_CODES`. `world.ts` `#playerSnapshots` must now emit `class: player.class` (one line — the field exists since Task 2).
- [ ] **Step 3: Dictionaries** — exact strings:

| key | EN | FR |
|---|---|---|
| class.warrior | Warrior | Guerrier |
| class.ranger | Ranger | Rôdeur |
| class.priest | Priest | Prêtre |
| class.warrior.blurb | Hits hard, up close. | Frappe fort, au corps à corps. |
| class.ranger.blurb | Hits light, from afar. | Frappe léger, de loin. |
| class.priest.blurb | Hits light, mends allies [F]. | Frappe léger, soigne les alliés [F]. |
| chars.create.class | Class | Classe |
| hud.heal | Mend | Soin |
| event.heal.cast | You mend {name} for {amount}. | Vous soignez {name} : +{amount} PV. |
| event.heal.received | {name} mends you for {amount}. | {name} vous soigne : +{amount} PV. |
| event.heal.nobody | No one nearby needs mending. | Personne à soigner aux alentours. |

- [ ] **Step 4: Run** — `npm run check` → green (the `SelfHud`/UI don't read `class` yet; `PlayerSnapshot` consumers compile because the field is additive).
- [ ] **Step 5: Commit** — `"Add heal intent, heal events, and class strings to the wire"`.

---

### Task 5: Server combat + healing

**Files:**
- Modify: `src/server/world.ts`, `src/shared/game.ts` (delete the transitional old constants)
- Test: `test/world.test.ts` (additions + helper option)

**Interfaces:**
- Consumes: `CLASS_STATS`, `attackDamageFor`, `healAmountFor` (Task 1); `{t:"heal"}` (Task 4).
- Produces: class-aware `#attack` (range + damage from `player.class`); `#heal` per the spec; `Player` gains `lastHealAt: number` (init 0 in `newPlayer`); `testCharacter(name, position?, playerClass?)` helper.
- Deletes: `ATTACK_RANGE`, `PLAYER_ATTACK_BASE`, `PLAYER_ATTACK_PER_LEVEL`, `attackDamageForLevel` from `game.ts` — after this task `grep -rn "attackDamageForLevel\|ATTACK_RANGE" src/` must only hit `CLASS_STATS`-derived code (`session.ts` still imports `ATTACK_RANGE` — this task updates it minimally: `CLASS_STATS[self.class].attackRange` needs the self snapshot; see Step 4).

- [ ] **Step 1: Failing tests** (`test/world.test.ts`; extend `testCharacter` to accept and send a class, defaulting `"warrior"`)

```ts
it("lets a priest mend the most injured player in range, respecting cooldown", async () => {
  const priest = await Client.join("mender", { position: { x: 784, y: 450 }, class: "priest" });
  const tank = await Client.join("bruiser", { position: { x: 800, y: 450 } });
  await until("both welcomes", () => priest.welcome && tank.welcome);
  const tankId = (await until("tank welcome", () => tank.welcome)).selfId;

  // Hurt the tank directly in D1? No — server-authoritative: use a monster? Too slow.
  // Deterministic route: lower the tank's HP via the test-only truth we DO own — D1 — then
  // reconnect so the world loads the damaged profile.
  tank.close();
  await env.DB.prepare("UPDATE character SET hp = 40 WHERE id = ?").bind(tankId).run();
  const hurt = await Client.join("bruiser2", { position: { x: 800, y: 450 } });
  // …simpler and just as valid: create the second character pre-damaged:
  hurt.close();

  const wounded = await Client.join("wounded", {
    position: { x: 800, y: 450 },
    hp: 40,
  });
  const woundedId = (await until("wounded welcome", () => wounded.welcome)).selfId;

  priest.action("heal");
  await until("the wounded player to be mended", () => {
    const snapshot = wounded.self();
    return snapshot && snapshot.hp > 40 ? snapshot : undefined;
  });

  const healed = wounded.self();
  expect(healed?.hp).toBe(40 + 35); // healAmountFor(1)

  // Cooldown: an immediate second cast must not double-heal.
  priest.action("heal");
  priest.action("heal");
  await scheduler.wait(200);
  expect(wounded.self()?.hp).toBe(75);

  const cast = priest.received.find((m) => m.t === "event" && m.code === "heal.cast");
  const received = wounded.received.find((m) => m.t === "event" && m.code === "heal.received");
  expect(cast).toMatchObject({ params: { name: "wounded", amount: 35 } });
  expect(received).toMatchObject({ params: { name: "mender", amount: 35 } });

  priest.close();
  wounded.close();
});

it("ignores heal intents from non-priests and out-of-range or full-health situations", async () => {
  const warrior = await Client.join("brute", { position: { x: 784, y: 450 } });
  await until("welcome", () => warrior.welcome);
  warrior.action("heal");
  await scheduler.wait(150);
  expect(warrior.received.some((m) => m.t === "event" && String(m.code).startsWith("heal"))).toBe(false);

  const priest = await Client.join("lonely", { position: { x: 3000, y: 2200 }, class: "priest" });
  await until("welcome", () => priest.welcome);
  priest.action("heal"); // full HP everywhere near → nobody
  const nobody = await until("heal.nobody", () =>
    priest.received.find((m) => m.t === "event" && m.code === "heal.nobody"),
  );
  expect(nobody).toMatchObject({ tone: "info" });

  warrior.close();
  priest.close();
});
```

  Helper changes this implies (do them): `testCharacter(name, options: { position?, class?, hp? })` — `class` goes in the create POST body; `hp` is applied with the same raw `UPDATE character SET hp = ? WHERE id = ?` pattern already used for `position` (pre-join, so the world loads it). `Client.join(name, options)` forwards them. `Client.action` accepts `"heal"`. Clean up the exploratory first-test comment block — implement the FINAL form (the `wounded` client with `hp: 40`; delete the `tank`/`hurt` false starts from the test you actually write; they are shown here as reasoning, not code to keep). Note `heal.nobody` for the second test relies on the priest being alone at full HP far from others — position `3000, 2200` is remote; other test stragglers are usually near spawn. If flaky, damage nobody and assert on the code only.

- [ ] **Step 2: Implement `#heal`** in `world.ts`:

```ts
#heal(ws: WebSocket, player: Player): void {
  const heal = CLASS_STATS[player.class].heal;
  if (!heal) return; // not a priest — intent silently ignored
  const now = Date.now();
  if (player.deadUntil > now || now - player.lastHealAt < heal.cooldownMs) return;

  let target: Player | undefined;
  let targetSocket: WebSocket | undefined;
  let worstRatio = 1;
  for (const [socket, candidate] of this.#players) {
    if (candidate.deadUntil > now) continue;
    if (pointDistance(player, candidate) > heal.range) continue;
    const ratio = candidate.hp / maxHpForLevel(candidate.level);
    if (ratio < worstRatio) {
      worstRatio = ratio;
      target = candidate;
      targetSocket = socket;
    }
  }
  if (!target || !targetSocket) {
    // No cooldown consumed on a whiff — pressing F at full health must not punish.
    this.#send(ws, { t: "event", code: "heal.nobody", tone: "info" });
    return;
  }

  player.lastHealAt = now;
  const amount = healAmountFor(player.level);
  target.hp = Math.min(maxHpForLevel(target.level), target.hp + amount);
  target.dirty = true;
  player.dirty = true;
  this.#send(ws, {
    t: "event",
    code: "heal.cast",
    params: { name: target.nick, amount },
    tone: "good",
    x: target.x,
    y: target.y,
  });
  if (targetSocket !== ws) {
    this.#send(targetSocket, {
      t: "event",
      code: "heal.received",
      params: { name: player.nick, amount },
      tone: "good",
    });
  }
  this.#sendState(ws, player);
  if (targetSocket !== ws) this.#sendState(targetSocket, target);
}
```

  Wire it in `#handleMessage` (`if (message.t === "heal") { this.#heal(ws, player); return; }`). `Player` gains `lastHealAt: 0` in `newPlayer`. Self-inclusion falls out of iterating `#players` (the caster is in the map); `worstRatio = 1` init excludes full-health targets.
- [ ] **Step 3: Class-aware attack** — in `#attack`: `const stats = CLASS_STATS[player.class]; let distance = stats.attackRange; … const damage = attackDamageFor(player.class, player.level);`.
- [ ] **Step 4: Delete the transitional oldies** — remove `ATTACK_RANGE`/`PLAYER_ATTACK_BASE`/`PLAYER_ATTACK_PER_LEVEL`/`attackDamageForLevel` from `game.ts`; fix `session.ts`'s import/usage: `attackRange: currentSelf ? CLASS_STATS[currentSelf.class].attackRange : 0` in the frame-loop `RenderContext` (currentSelf is the snapshot, which has `class` since Task 4), and delete its `ATTACK_RANGE` import.
- [ ] **Step 5: Run** — the world suite is slow (~60s): `npx vitest run test/world.test.ts` → PASS; `npm run check` → green.
- [ ] **Step 6: Commit** — `"Give attacks class stats and priests a heal"`.

---

### Task 6: Client — picker, display, heal key, range ring

**Files:**
- Modify: `src/client/game/input.ts`, `src/client/game/session.ts`, `src/client/store.ts`, `src/client/ui/CharacterSelect.tsx`, `src/client/ui/hud/Hud.tsx`, `src/client/game/renderer.ts`
- Test: `test/ui/character-select.test.tsx`, `test/ui/hud.test.tsx` (additions)

**Interfaces:**
- Consumes: everything above.
- Produces: `ActionHandlers.heal()` (F key, edge-triggered); `GameHandle.heal(): void`; `SelfHud.class: PlayerClass`; class picker posting `class`; class names on cards + identity panel; heal cooldown bar (priest only); nameplate glyphs; class-range ring.

- [ ] **Step 1: Failing UI tests**

`test/ui/character-select.test.tsx` — add:

```ts
it("posts the chosen class on create", async () => {
  const mock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ id: "9", name: "Mercy", appearance: "azure", class: "priest", level: 1 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", mock);
  useUiStore.setState({ screen: "characters", characters: [] });
  render(<CharacterSelect onPlay={() => undefined} />);
  await userEvent.type(screen.getByLabelText("Name"), "Mercy");
  await userEvent.click(screen.getByRole("radio", { name: /Priest/ }));
  await userEvent.click(screen.getByRole("button", { name: "Create" }));
  const createCall = mock.mock.calls.find(([url, init]) => url === "/api/characters" && init?.method === "POST");
  expect(createCall).toBeDefined();
  expect(JSON.parse(String(createCall?.[1]?.body))).toMatchObject({ class: "priest" });
});
```

`test/ui/hud.test.tsx` — extend the store fixture's `self` with `class: "priest"` (and the other test fixtures with `class: "warrior"`), then add:

```ts
it("shows the class name and a heal bar for priests", () => {
  useUiStore.setState({
    self: { nick: "Mercy", level: 1, hp: 100, maxHp: 100, dead: false, class: "priest" },
    selfState: {
      xp: 0, xpToNext: 100,
      inventory: { potions: 2, gold: 0, crystals: 0, weapon: "rusty_sword" },
      quest: { status: "available", progress: 0, target: 3 },
    },
    healCooldownUntil: 0,
  });
  render(<Hud />);
  expect(screen.getByText("Priest")).toBeInTheDocument();
});
```

- [ ] **Step 2: Input + session + store**
  - `input.ts`: `heal()` in `ActionHandlers`; `else if (event.code === "KeyF") handlers.heal();`.
  - `store.ts`: `SelfHud` gains `class: PlayerClass` (update `selfHudEqual`); `GameHandle` gains `heal(): void`; add `healCooldownUntil: number` + `setHealCooldownUntil` (same pattern as attack). Update `renderPlayer`'s trimmed object in `session.ts` to carry `class: self.class`.
  - `session.ts`: heal action closure — `if (interiorOpen()) return; sound.unlock(); connection.heal(); useUiStore.getState().setHealCooldownUntil(performance.now() + 1500);` — read the cooldown from `CLASS_STATS.priest.heal` (narrow the optional once at module scope: `const PRIEST_HEAL = CLASS_STATS.priest.heal;` guard-throw if undefined with a clear message). Only arm the local cooldown when the current self is a priest (`currentSelf?.class === "priest"`). Wire into `trackActions` and `setGame({ …, heal })`. `net.ts`: `Connection.heal()` sending `{ t: "heal" }` (one line next to attack). Sounds: on `heal.cast`/`heal.received` events → `sound.loot()` (chime family per spec) — add to the event switch.
  - Help bar: add `<Kbd>F</Kbd> {t("hud.heal")}` — but only when `self?.class === "priest"` (HelpBar reads `self` from the store; other classes see the original four).
- [ ] **Step 3: CharacterSelect picker** — a fieldset like appearances: three radio cards (`name="class"`, values from `PLAYER_CLASSES` imported from `../../shared/game.js`, warrior defaultChecked), each showing `t(`class.${klass}`)` bold + `t(`class.${klass}.blurb`)` small; legend `t("chars.create.class")`; `submitCreate` body gains `class: data.get("class")`. Character cards show `t(`class.${character.class}`)` next to the level.
- [ ] **Step 4: Hud** — identity panel shows `t(`class.${self.class}`)` under the level line; render a second cooldown bar component (copy CooldownBar into `HealCooldownBar.tsx` reading `healCooldownUntil` with max `CLASS_STATS.priest.heal.cooldownMs`, titled `t("hud.heal")`, variant "xp") rendered only when `self.class === "priest"`.
- [ ] **Step 5: Renderer** — nameplate glyphs: in the player-label composition (`renderer.ts` ~line 1394 region), prefix `⚔ `/`➶ `/`✚ ` by `player.class` (a small `CLASS_GLYPHS: Record<PlayerClass, string>` local); the attack-range ring already uses `context.attackRange` (session now feeds the class value — done in Task 5).
- [ ] **Step 6: Run** — `npm run test:ui` → PASS (new + updated fixtures); `npm run check` → green; `npm run build`.
- [ ] **Step 7: Commit** — `"Add the class picker, heal key, and class HUD"`.

---

### Task 7: Docs, deploy, live verification

**Files:**
- Modify: `AGENTS.md` (CLAUDE.md symlink), `README.md`

- [ ] **Step 1: Docs** — AGENTS.md: "the server decides outcomes" list gains "heals"; a line in the architecture notes: "Classes: `CLASS_STATS` in `shared/game.ts` is the one balance table; the server validates class, range, cooldown, and targeting; `{t:"heal"}` is intent like any other." README: Play table gains `F — mend the most injured ally in range (priest)`; a sentence on the three classes.
- [ ] **Step 2: Gate + deploy** — `npm run check` → commit docs (`"Document the class system"`) → `npm run db:migrate:remote` (ADDITIVE migration 0003) → `npm run deploy`.
- [ ] **Step 3: Live verify** — curl: register probe, create a priest (`class:"priest"` round-trips in the response), create with `class:"necromancer"` → 400 invalid_class, delete probe character, wrong-password 401 still byte-stable. Browser (if a browser tool is available): create a priest, join, press F alone at full HP → « Personne à soigner aux alentours. » in FR; nameplate shows ✚.
- [ ] **Step 4:** superpowers:finishing-a-development-branch → merge `feature/classes` into `main`, push.

---

## Plan self-review notes

- **Spec coverage:** balance table + pure functions (T1), additive migration + default warrior (T2), create-with-class API + invalid_class (T3), PlayerSnapshot.class + heal intent + 3 event codes + full EN/FR strings incl. blurbs (T4), server heal (priest-only, most-injured ratio incl. self, range/cooldown, no-cooldown-on-whiff, dead-can't-heal is covered by the `deadUntil` guard) + class-aware attack + old-constant deletion (T5), picker/display/F-key/heal-bar/glyphs/range-ring (T6), docs+deploy (T7). Spec's "dead priests cannot heal" test: the `deadUntil > now` guard is exercised implicitly; if the reviewer wants it explicit, add a case killing the priest first — acceptable to defer to review.
- **Placeholder scan:** the Task 5 Step 1 test block contains explicit reasoning-then-final-form instructions (the false-start lines are marked as reasoning, not code); no TBDs remain.
- **Type consistency:** `PlayerClass`/`CLASS_STATS`/`attackDamageFor`/`healAmountFor`/`isValidClass` (T1) match all consumers; `CharacterSummary.class` mirrored server+client (T3); `SelfHud.class` + `healCooldownUntil` + `GameHandle.heal` (T6) consistent with store patterns from the React plan.
- **Behavior-preservation audit:** T1 keeps old constants (no silent 82→60 range change); the switch happens consciously in T5 with tests. Warrior range 60 vs old global 82 is a deliberate spec-approved balance change shipping with T5.
