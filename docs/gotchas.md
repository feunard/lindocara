# Gotchas worth knowing

Things that were each found the hard way, and that no compiler or test will tell you. Skim this
list when something behaves oddly for no visible reason.

## Gotchas worth knowing

**Alepha atoms are not for the 60Hz path.** Every write to a `$atom` validates its zod schema and
fires an unfiltered global event â€” fine for state a screen transition writes once, disqualifying
for anything written 20-60x/s. The game bridge stays zustand (`store.ts`); atoms
(`state/atoms.ts`) hold only screen-transition state.

**`$action` names must not collide with alepha builtins.** Duplicate action names fail the
framework's configure hook at boot â€” and a collision can surface only in the full production
provider graph, so a narrow dev path can look green while the deployed service is dead.
`HealthController.apiHealth` is named that, not `health`, because
alepha's own `ServerHealthProvider` registers `health`.

**A green `alepha build` is not a working deploy.** `platform up` is the pipeline â€” build
`--target bare`, pack the service, assets and migrations, upload through bay-admin and push the
allowlisted `$env` secrets. The Bay process applies migrations at boot; a build alone proves only
compilation. Relatedly, any `alepha db` command boots the
real server entry (`apps/main/src/main.ts`) and needs a resolvable `DATABASE_URL` (the dev SQLite
default suffices locally).

**`yarn smoke` is what closes that gap** (`scripts/smoke-boot.ts`, last step of `yarn verify`
and of CI). It boots the built artifact the way Bay boots it and asserts five things a compiler
cannot see: migrations applied against an empty database, `/api/health` answers, `GET /` serves the
Lindocara shell with a module entry script, an unadmitted `/ws/world` dial is refused BY THE ROOM,
nothing logged an `ERROR` on the way up, and SIGTERM stops the process. Three details in it are
load-bearing and were each found the hard way:

- **The process runs with `apps/main` as its working directory, not `dist/`.** Alepha's
  `DatabaseProvider.getMigrationsFolder()` returns the RELATIVE `migrations/<driver>`, so booting
  from inside `dist/` logs "Migration SKIPPED - no migrations found" and then dies on the first
  query against a table nothing created.
- **Probe `localhost`, never `127.0.0.1`.** The Node server binds the hostname it is given and on a
  dual-stack machine that is `::1` ONLY — an IPv4-hardcoded probe gets ECONNREFUSED from a server
  that is up and healthy.
- **The WebSocket assertion is three-way on purpose.** A mounted-but-fenced `/ws/world` completes
  the upgrade and is then closed by the room with an `engine/close-codes.ts` code (4004 today); a
  path nothing serves fails the upgrade and surfaces as a transport error; an open socket means a
  client reached the world without passing `GET /api/join`. Collapsing that to "the socket did not
  stay open" would pass just as happily when the room stopped being served at all.

It is a boot smoke, NOT a browser end-to-end test: nothing logs in, creates a party or renders a
hero. A Playwright suite over the real screens is still an open gap.

**IDE tsserver misprojects the vendored-source programs.** alepha's `package.json` points `types`
at raw framework source, so an open file can be assigned the wrong tsconfig program and show false
diagnostics that no CI check reproduces. `yarn typecheck` is the truth, not the editor
squiggles.

**Empty rooms reset.** Room state is memory-only: the tick stops when a room empties and Node
sweeps idle rooms after 5 minutes â€” temporary
monsters/loot reset and state is recreated on the next join. Durable truth (hero saves, adventure
state) is written through to the database, epoch-fenced; never park durable truth in room memory.
Don't make the tick unconditional either: empty rooms should consume neither simulation work nor
memory indefinitely.

**A running party is isolated by `partyId`.** `PartyRoom` owns party-wide coordination while each
active `partyId:mapId` `WorldRoom` owns room-local simulation; production runs exactly one room
per id. Do not route authored maps by `mapId` alone or bypass the coordinator for party-wide
chat/victory.

**`onTick` is synchronous.** An async tick slower than its 50 ms period silently skips beats.

**A square that sits still may be clamped, not broken.** Heroes enter at their persisted position
or the map's authored spawn, so a test â€” or a manual check â€” that pushes one fixed direction may
simply be pressing into a wall or a collider.

**`import.meta.env.DEV` exposes `window.__lindocara`** (`self()`, `all()`) for measuring input
latency and interpolation from outside the app. It is stripped from production builds.

**Server events are codes, not sentences.** `{ t: "event", code, params }` â€” the client owns
all wording via `src/shared/i18n/`. Never add an English string to a server send; add
an `EventCode` and two dictionary entries instead (the i18n test enforces parity).

**The canvas is not React's.** `#stage` is a sibling of `#root`, created by the client bootstrap
(`bootClient()` in `main.tsx`), not by the served HTML; nothing in `ui/` may touch it.

**Movement audio is recorded, not synthesised.** `client/game/sound.ts` plays the shared bank
([`@lindocara/audio`](../packages/audio/AGENTS.md)) — the very takes the lab was tuned against, with
per-shot pitch/level jitter. It replaced a bandpass-noise synthesiser whose only variety was a
rotating ±8%. `movement-sounds.ts` still owns the ROUTING, as an exhaustive switch over `HeroEvent`,
so the compiler catches the day the rule grows an event; the package owns only what both consumers
agree on. A key named there that the package does not define is silent with nothing failing —
`movement-sounds.test.ts` is the guard.

**A looping strip's cadence is per MOTION, not one shared number.** `ACTOR_FRAME_MS`
(`renderer/actor-motion.ts`) holds the lab's `HERO.anims` fps inverted — idle 7, run 12 — and every
`ActorView` carries the one for the motion it is drawing (`frameDurationMs`). Before that, every
looping strip in the game shared a hardcoded 145 ms: right for idle by coincidence, and 6.9 fps for
a run that should be 12, so a hero's body moved at full speed while its legs cycled at 57%. That is
what reads as skating, and no typecheck or snapshot test can be wrong about a cadence — only an eye.

**Ripples, breath and footprints come from `@lindocara/hd2d`'s primitives, not from rebuilt
geometry.** `makeRipple()` is a textured plane with `fog: false`; a `RingGeometry` annulus with the
identical timing curve moves correctly and reads as a wireframe hoop. The swim ripple was exactly
that until it was fixed. Its cadence is the 550 ms timer in `syncLocalHero` ALONE — a `brasse` event
is a sound, and emitting a ripple there too puts two overlapping series on the water.

**A landing shakes the camera, off the same number that makes it loud.** The rule's `reception`
force (0.35..1.4, `hero-step.ts`) drives the sample's gain AND `heroLandingImpulse`
(`renderer/camera-shake.ts`). They must keep agreeing: a landing that is loud but still, or that
shakes without a thud, reads as a bug in the physics rather than in the presentation.

**`@lindocara/hd2d` has no module-level mutable state.** Camera yaw, the billboard registry, the
cloud-shadow uniforms all live on `Hd2dContext` (`createHd2dContext()`), never a module variable.
The PoC used module state because it only ever opened one scene; the game and a future editor
preview will each open their own `hd2d` context, and a module singleton would mean rotating one
scene's camera also rotates the other's sprites. See `packages/hd2d/AGENTS.md`.
