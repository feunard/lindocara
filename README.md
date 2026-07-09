# lindocara

A white world. Log in, and you control a black square. Everyone else sees it move.

A deliberately small multiplayer skeleton on Cloudflare Workers, built to grow into a real
online game: server-authoritative movement, a Durable Object as the world, and a shared
simulation both sides can run.

**Live:** [lindocara.alepha.dev](https://lindocara.alepha.dev)

## Stack

TypeScript · Vite · PixiJS · Cloudflare Workers + Durable Objects · Biome · Vitest

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

The client sends **intent** — "I'm holding right" — and never a position. The Durable Object
runs a 20 Hz loop, advances every player through a shared `step()` function, and broadcasts a
snapshot of the world. The client renders ~100 ms in the past and interpolates between the
two snapshots bracketing that moment, so 20 updates per second look like smooth motion.

Cheating by editing your own coordinates is not possible, because you never send coordinates.

The movement rules live in `src/shared/simulation.ts` as a pure function. Right now only the
server calls it. When client-side prediction arrives, the client will call the very same
function — which is the whole reason it lives there.

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
