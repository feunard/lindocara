# lindocara — design

**Date:** 2026-07-09
**Status:** implemented

## Goal

A small, correct foundation for an online browser game on Cloudflare. Today it is a white
world in which each logged-in player controls a black square. It must be the kind of skeleton
a real game can grow on, rather than a demo that has to be thrown away.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Auth | Anonymous nickname, HMAC-signed cookie | No user table, no password. Swapping in OAuth changes only how a session is minted. |
| Rendering | PixiJS | A renderer, not an engine. It owns no game loop, so it never fights server-authoritative netcode. |
| Authority | Server-authoritative, fixed 20 Hz tick | Clients send intent, never position. Cheating requires breaking the server. |
| World | One Durable Object | Single-threaded and strongly consistent: the natural shape of a game room. |
| Transport | WebSocket, Hibernation API | An empty world costs nothing. |

## Architecture

```
browser ──POST /api/session──▶ Worker ──signs cookie──▶ browser
browser ──GET /api/ws────────▶ Worker ──verifies──────▶ Durable Object "world"
                                                        │ 20 Hz loop
                                                        ▼
                                              snapshot broadcast to all
```

Three layers, with one deliberate seam:

- `src/shared/` — platform-free. `step(position, input, dt)` is pure and is the **only**
  definition of how anything moves. `protocol.ts` defines the wire format and parses inbound
  messages defensively.
- `src/server/` — the Worker (routing, sessions) and the Durable Object (the world).
- `src/client/` — socket and interpolation, PixiJS rendering, keyboard-to-intent.

### Netcode

Considered three models:

- **Relay** (client sends its own position) — ~40 lines, and every client is trusted.
  Rejected: the wrong foundation.
- **Server-authoritative, fixed tick** — chosen. One round-trip of input latency, correct by
  construction.
- **Server-authoritative + client prediction and reconciliation** — the eventual endgame.
  Rejected *for now*: rollback and reconciliation are the most bug-prone code in netcode, and
  premature here.

The upgrade from the second to the third is additive, not a rewrite, precisely because
`step()` is pure and shared. The client will one day call the identical function to predict
its own square and reconcile against snapshots.

Clients render `INTERPOLATION_DELAY_MS` (100 ms) in the past and interpolate between the two
snapshots bracketing that instant, so a 20 Hz stream renders as continuous motion and a
single late packet is invisible. When the stream stalls, the client freezes on the last known
truth rather than extrapolating a guess.

### Durable Object lifecycle

The tick loop runs only while at least one player is connected; the last player to leave
clears it and the world may hibernate. This matters for cost — an active object is billed for
its duration — and it is why the loop must never be unconditional.

Player identity, and position, ride on the socket via `serializeAttachment`. Positions are
written at most once per second, and only for players who actually moved. If the object is
ever rebuilt while its hibernatable sockets survive, players resume where they were rather
than teleporting to a fresh spawn.

### Routing

`assets.not_found_handling: "single-page-application"` serves `index.html` for unmatched
paths. `assets.run_worker_first: ["/api/*"]` is therefore mandatory: without it the SPA
fallback would answer API calls with HTML and the Worker would never run.

## Testing

Tests run inside workerd via `@cloudflare/vitest-pool-workers`, against the real Durable
Object over real WebSockets — bindings and migrations come from `wrangler.jsonc`, so the test
environment cannot drift from production.

- `simulation.test.ts` — purity, diagonal normalisation, clamping, dt scaling.
- `session.test.ts` — sign/verify round-trip, forged payloads, expiry, cookie parsing.
- `worker.test.ts` — the HTTP surface, including that `/api/*` never returns the SPA shell.
- `world.test.ts` — join, tick, movement, walls, two players, malformed frames, persistence.

Two things could not be tested the obvious way, and the workarounds are deliberate:

- `evictDurableObject()` waits for in-flight work to drain, and a `setInterval` never drains.
  So the rebuild path is tested as two halves: the write (position lands on the socket) and
  the read (`positionFromAttachment`).
- The world object is a singleton across a test file, so assertions are about *which* player
  ids are present, never how many.

## Known non-issues

`vite dev` can leave a previous Worker running after a hot reload, its Durable Object still
ticking and broadcasting to the same client socket. The symptom is a square that appears to
teleport between a few fixed positions. This is a dev-server artifact — production runs
exactly one object per id — and it is documented in AGENTS.md so the next person does not
spend an hour debugging a bug that does not exist.

## Amendment, same day: client-side prediction

Movement felt laggy. Measured against production before changing anything:

| | |
| --- | --- |
| network RTT to the edge | ~11 ms |
| input → server-confirmed movement | median 24 ms |
| snapshot arrival gaps | p50 50.0 ms, p95 55.1 ms, max 61.3 ms, **0/201 over 80 ms** |

So the network was blameless. The delay was `INTERPOLATION_DELAY_MS`, correctly applied to
remote players and *wrongly applied to the local one*: ~124 ms of deliberate lag on your own
square, wandering up to ~175 ms with tick quantisation. That wander is what "sometimes laggy"
was.

Approach C from the original design is now implemented, exactly as the seam anticipated:

- Inputs are numbered. The client sends one command per tick and keeps them until the server
  acknowledges them (`ack` on each `PlayerSnapshot`).
- The server queues commands and applies **exactly one per tick**. This is what stops a client
  from moving faster by sending faster. Replayed sequences are dropped; after five starved
  ticks the server stops a silent client's square rather than coasting forever.
- The client predicts locally with the shared `step()`, and on each snapshot replays its
  unacknowledged commands over the server's position. Corrections smaller than 96 px are smeared
  over 100 ms; larger ones snap.
- Remote players are unchanged — still interpolated 100 ms in the past.

Measured after: input latency is **1 frame (~7 ms)**, every run. A square travels 390 px in
1.5 s, i.e. exactly `PLAYER_SPEED`, so prediction does not double-step. Remote players sampled
over 217 frames showed 217 distinct positions and no jump over 10 px — still smoothly
interpolated.

Two traps found while verifying, both recorded in AGENTS.md: a remote square resting against a
wall is indistinguishable from a broken interpolator (the test now oscillates), and a nested
`requestAnimationFrame` polling harness provokes a WebGL warning storm under headless
SwiftShader that the app itself never produces.

## Future

Sharding one world into many rooms, which Durable Objects make almost free. If the game ever
needs sub-50 ms competitive latency or UDP, the platform-free `shared/` layer means a Bun/Node
port touches only `world.ts` and `index.ts`.
