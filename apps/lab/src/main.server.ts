/**
 * The workspace the CLI boots — not a server this site runs behind.
 *
 * The lab is a static site: `vite build` writes `dist-client/`, `alepha build
 * --target=static` adopts it (`static.source` in `alepha.config.ts`), and what
 * ships is files. Bay hosts it with no process at all — no port, no `.env`, no
 * health probe.
 *
 * This file exists because the build still resolves an app entry and loads it
 * to analyze the container, which is how it learns the workspace declares no
 * database, no bucket and no queue. Nothing of it reaches the artifact: the
 * static target's `cleanDist` keeps only the client directory and the manifest.
 *
 * It must NOT be named `main.ts`. That name matches both the server and the
 * browser entry conventions, so the CLI picked up the lab's Three.js entry as
 * the server and died evaluating `document` under Node — which is why the
 * browser half is `src/boot.ts`.
 */
import { Alepha, run } from "alepha";

run(Alepha.create());
