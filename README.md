# lindocara

A white world. Log in, and you control a black square. Everyone else sees it move.

A deliberately small multiplayer skeleton on Cloudflare Workers, built to grow into a real
online game: server-authoritative movement, a Durable Object as the world, and a shared
simulation both sides can run.

**Live:** [lindocara.alepha.dev](https://lindocara.alepha.dev)

## Stack

TypeScript · Vite · PixiJS · Cloudflare Workers + Durable Objects · D1 + Drizzle ORM · Biome ·
Vitest

## Quick start

```bash
npm install
cp .dev.vars.example .dev.vars   # then put a real secret in it
npm run dev
```

`npm run dev` runs the client, the Worker, and the Durable Object together in workerd — the
same runtime that serves production.

```bash
npm run check    # lint + typecheck + test
npm run deploy   # build, then ship
```

## How it works

The client sends **intent** — "I'm holding right" — and never a position. Cheating by editing
your own coordinates is impossible, because you never send coordinates.

Each input is stamped with a sequence number, one per simulation tick. The Durable Object runs
a 20 Hz loop, applies **exactly one command per player per tick**, and broadcasts a snapshot
along with the highest sequence number it has applied. Applying one per tick is what makes the
tick rate — rather than how fast you can send packets — the speed limit.

Your own square does not wait for any of that. The client applies your input locally the frame
you press a key, then reconciles: when a snapshot arrives it takes the server's position and
replays whatever commands the server hasn't acknowledged yet. Agreement means nothing visibly
happens; disagreement is smeared over ~100 ms rather than snapping. Measured input latency is
**one frame** (~7 ms), down from ~124 ms before prediction.

Everyone *else* is drawn ~100 ms in the past, interpolated between the two snapshots bracketing
that instant — you can't know where a remote player is right now, and guessing looks worse than
being slightly late.

All of this hangs on `step(position, input, dt)` in `src/shared/simulation.ts` being a pure
function that the server and the client both call. Reconciliation is only correct because the
two are literally the same code.

## Database

A D1 database (`lindocara`) with a single `player` table, defined in
`src/server/db/schema.ts` and accessed through Drizzle. It is **empty and unused** — the game
keeps all state in the Durable Object. It exists so persistence has somewhere to land.

```bash
npm run db:generate   # schema change -> migrations/NNNN_name.sql
npm run db:migrate    # apply to local D1
```

Production migrations run automatically on deploy, before the new code goes live.

## Deployment

Pushing to `main` runs the full check suite and then deploys, via GitHub Actions.

Required repository secrets:

| Secret | Where to get it |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare dashboard → My Profile → API Tokens (*Edit Cloudflare Workers*) |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare dashboard → Workers & Pages → Account ID |

One-time, before the first deploy:

```bash
npx wrangler secret put SESSION_SECRET     # openssl rand -base64 32
```

The custom domain `lindocara.alepha.dev` is claimed in `wrangler.jsonc`; its zone must live
on the same Cloudflare account as the Worker.

## Sessions

There are no passwords and no user table. You pick a nickname, the Worker signs
`{ id, nick, iat }` with an HMAC and hands it back as an `HttpOnly` cookie. The Durable
Object trusts the identity only because the Worker verified that signature first.

Swapping in real OAuth means changing how a session is minted. The cookie, the Worker, and
the Durable Object all keep working.

## More

See [AGENTS.md](./AGENTS.md) for architecture notes, conventions, and the gotchas — including
why `vite dev` can appear to teleport your square, and why there are three tsconfigs.
