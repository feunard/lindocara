# Accounts, characters, and FR/EN i18n — design

2026-07-10. Approved approach: username/password accounts with login/register tabs, up to 3
characters per account (name + appearance chosen at creation), character select screen, and
full French/English localization of every player-facing label. i18n is client-side over
message codes; the chosen character travels as a connection parameter; passwords are hashed
with PBKDF2-SHA256 via WebCrypto.

## Goals

- Replace the anonymous nickname login with real accounts: username + password, explicit
  Login and Create-account tabs.
- Accounts own up to 3 characters. Creation picks a name and one of the four existing
  appearances. Characters can be deleted (with confirmation). A character select screen sits
  between login and the world.
- Every player-facing string exists in English and French. First visit auto-detects from
  `navigator.language`; a FR/EN toggle (login screen and in-game) persists to
  `localStorage`. No reload needed to switch.

## Non-goals

- Rate limiting, password reset, email, account deletion. Nothing in the slice has a place
  for them yet.
- Preserving existing anonymous `player` rows. The migration drops and recreates (test data).
- Translating player chat. Player speech is never translated.
- Guest mode. Accounts are the only way in.

## Data model

Migration: drop `player`, create `account` and `character`.

```
account
  id                  text PK (UUID)
  username            text NOT NULL, UNIQUE COLLATE NOCASE
  passwordHash        text NOT NULL   -- base64(PBKDF2-SHA256(password, salt, iterations))
  passwordSalt        text NOT NULL   -- base64, 16 random bytes per account
  passwordIterations  integer NOT NULL -- stored per-row so it can be raised later
  createdAt, lastSeenAt  timestamp_ms as today

character
  id          text PK (UUID)
  accountId   text NOT NULL references account.id, indexed
  name        text NOT NULL          -- NOT unique: accounts claim usernames, characters don't
  x, y, level, xp, hp, appearance, potions, gold, crystals, weapon,
  questStatus, questProgress, createdAt, lastSeenAt   -- unchanged from player
```

- Username: current pattern `^[A-Za-z0-9_-]{2,16}$`, unique case-insensitively.
- Password: 8–128 chars, no complexity rules.
- Character name: same 2–16 pattern, deliberately not unique.
- Appearance: player-chosen from `azure | ember | moss | violet`. `appearanceForId()` is
  deleted.
- Character deletion is a hard SQL DELETE.

## Auth

`session.ts` keeps its HMAC shape, TTL, and cookie attributes. Payload becomes
`{ id: accountId, username, iat }`.

PBKDF2-SHA256 via WebCrypto (native in workerd, zero deps): per-account random 16-byte salt,
iteration count stored next to the hash, constant-time comparison
(`crypto.subtle.timingSafeEqual` or double-HMAC compare). Iterations start at 100_000.

## API (Worker-side, shared D1 binding)

| Endpoint | Behavior |
| --- | --- |
| `POST /api/register` | `{username, password}` → 400 invalid, 409 username taken → create account, set session cookie |
| `POST /api/session` | `{username, password}` → verify hash → cookie. Identical 401 body for unknown user and wrong password |
| `DELETE /api/session` | logout, unchanged |
| `GET /api/me` | `{id, username}` or 401 |
| `GET /api/characters` | this account's characters: `{id, name, appearance, level}[]` |
| `POST /api/characters` | `{name, appearance}` → 400 invalid, 409 if already 3 → created character |
| `DELETE /api/characters/:id` | 404 unless owned by the session's account |
| `GET /api/ws?character=<id>` | verify ownership in D1, forward to the DO with `x-character-id` + `x-character-name` |

`profile.ts`: `loadOrCreateProfile(db, id, nick)` becomes `loadProfile(db, characterId)` —
creation happens only through `POST /api/characters`. If the row is missing at join time the
socket is refused. `world.ts` keys players by character id (the header the Worker injects).

## Client screens & flow

Three overlays in `index.html`, same vanilla-DOM pattern as today's `#login` (which is
removed and replaced by `#auth`):

- `#auth` — Login / Create-account tabs. Login: username, password. Register: username,
  password, confirm. Inline error line per form.
- A FR/EN toggle lives as a single persistent corner control, visible on every screen —
  `#auth`, `#characters`, and in-game — always the same element.
- `#characters` — up to 3 cards (name, appearance swatch, level) plus a "New character" card
  when a slot is free. Each card: Play, Delete (inline confirm). Creation panel: name input,
  4 appearance swatches, Create. Log out link.
- `#hud` and the rest unchanged structurally; all labels translated.

Flow in `main.ts`: boot → `GET /api/me` → 401 → `#auth`; session → `GET /api/characters` →
`#characters`; pick → `/api/ws?character=<id>` → world. Identity panel gains "switch
character" (close socket, back to `#characters`) and "log out".

## i18n

`src/client/i18n/`: `t(key, params?)` with a typed key union derived from the `en`
dictionary, so `fr` must cover exactly the same keys at compile time. Locale resolution:
`localStorage.lindocara_locale`, else `navigator.language` starts with `fr` → French, else
English. The toggle writes localStorage, sets `<html lang>`, and re-applies static labels
live.

Static labels: text nodes in `index.html` carry `data-i18n="key"`; placeholders and
aria-labels use `data-i18n-attr`. An `applyStaticText()` pass runs at boot and on toggle.

### Protocol change

Server events stop carrying English prose. In `protocol.ts`:

- `{ t: "event", text: string }` → `{ t: "event", code: EventCode, params?: Record<string,
  string | number> }`, with `EventCode` a closed union (~15 codes: `wake`, `combat.hit`,
  `combat.too_far`, `level_up`, `monster.defeated`, `quest.accepted`, `quest.ready`,
  `quest.fulfilled`, `potion.used`, `potion.none`, `player.down`, `respawn`, `loot.picked`,
  …the exact set is fixed while porting `world.ts`).
- Monster snapshots carry a stable `kind` (e.g. `"gloamcap"`) instead of an English `name`.
  NPC name/role render from dictionary keys client-side.
- Chat messages stay raw text.

`main.ts` sound/log triggers switch from regex-on-English to exact matches on `event.code`,
removing the existing fragility.

Dictionaries `en.ts` and `fr.ts` cover ~120 keys: UI chrome (index.html labels), item names,
zone and POI names (`world-layout.ts`), monster and NPC names, quest status text, interaction
prompts, connection/status lines, and event templates with `{param}` interpolation, e.g.
`"combat.hit": "You hit {name} for {damage}."` / `"Vous frappez {name} : {damage} dégâts."`.

## Testing

- **Auth unit:** PBKDF2 round-trip verifies; wrong password rejects; hash format encodes
  iterations.
- **API against real workerd:** register → 200 + cookie; duplicate username → 409;
  login unknown-user and wrong-password return byte-identical 401s; character create
  validates name/appearance; 4th character → 409; deleting another account's character →
  404; `/api/ws` with an unowned character id refused.
- **Protocol:** `parseClientMessage` still rejects garbage; event codes are a closed union.
- **i18n:** key parity between `en` and `fr` is enforced by the type system; a test asserts
  every `EventCode` has a template in both dictionaries.
- **World:** existing tests updated to join via `x-character-id` with rows created through
  the API path.

## Risks / notes

- `evictDurableObject()` gotcha and the singleton-DO-per-test-file rule still apply; new
  world tests follow the existing patterns.
- The dev-stacked-Workers gotcha will make manual verification of auth flows confusing after
  hot reloads: restart the dev server before judging a bug real.
- CLAUDE.md and README must be updated: the "no user table, no password" and "nick is not
  unique because sessions are anonymous" notes become wrong the moment this lands.
