/**
 * The boot smoke: proves the built artifact actually RUNS.
 *
 * `alepha build` proves the app COMPILES, which is a strictly weaker claim than "this deploys".
 * A whole class of breakage is invisible to a compiler and shows up only when the container is
 * assembled and booted for real — a `$action` name colliding with an alepha builtin, a service
 * missing from `LindocaraApi.services`, an entity whose migration was never generated, a `ready()`
 * hook that throws. Every one of those ships a green CI and a dead process. This is the cheapest
 * check that can tell them apart, so it runs at the end of `yarn verify`, after the build whose
 * output it consumes.
 *
 * It is NOT a browser end-to-end test: nothing here logs in, creates a party or renders a hero.
 * It boots the production artifact the way Bay boots it and asserts the four things that must be
 * true one second later — migrations applied, the API answers, the SPA shell is served, an
 * unadmitted WebSocket is refused — then proves the process also stops on SIGTERM, because a
 * container that will not shut down is its own outage.
 *
 * Run standalone with `yarn smoke` (build first), or let `yarn verify` sequence it.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import WebSocket from "ws";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The app directory, not `dist/`, is the working directory on purpose: alepha's
 * `DatabaseProvider.getMigrationsFolder()` returns the RELATIVE `migrations/<driver>`, so the
 * process only finds its migrations when it runs from the directory that holds them. Booting from
 * inside `dist/` instead logs "Migration SKIPPED - no migrations found" and then dies on the first
 * query against a table that was never created — which is what this smoke would report as a
 * failure, correctly but for the wrong reason.
 */
const appDir = path.join(root, "apps/main");
const entry = path.join(appDir, "dist/index.js");

const BOOT_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 15_000;
const WEBSOCKET_TIMEOUT_MS = 10_000;

function fail(message: string, log?: string): never {
  console.error(`\nsmoke: ${message}`);
  if (log) {
    console.error("\n--- server output (tail) ---");
    console.error(log.split("\n").slice(-40).join("\n"));
  }
  process.exit(1);
}

/** Ask the OS for a port nobody is on, then hand it back. */
async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", reject);
    probe.listen(0, () => {
      const address = probe.address();
      if (address === null || typeof address === "string") {
        probe.close();
        reject(new Error("could not resolve a free port"));
        return;
      }
      const { port } = address;
      probe.close(() => resolve(port));
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  if (!existsSync(entry)) {
    fail(`no build at ${path.relative(root, entry)} — run 'yarn build' first`);
  }

  const port = await freePort();
  const dataDir = await mkdtemp(path.join(tmpdir(), "lindocara-smoke-"));
  const databasePath = path.join(dataDir, "smoke.db");
  const databaseUrl = `file:${databasePath}`;

  /**
   * `NODE_ENV=production` is what makes this a smoke of the DEPLOYED shape rather than of dev:
   * alepha only reads `migrations/` in production (dev push-syncs the schema from the entities
   * instead, which would hide exactly the drift this is here to catch), and only in production
   * does `SecretProvider` throw on a defaulted `APP_SECRET`. The secret is minted per run and
   * dies with the process — it signs nothing that outlives the temp database beside it.
   */
  const child = spawn(process.execPath, [path.relative(appDir, entry)], {
    cwd: appDir,
    env: {
      ...process.env,
      NODE_ENV: "production",
      SERVER_PORT: String(port),
      APP_SECRET: randomUUID(),
      DATABASE_URL: databaseUrl,
      // Never let a developer's `.env` DATABASE_SYNC turn the migration proof into a push-sync.
      DATABASE_SYNC: "false",
      LOG_LEVEL: "info",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let log = "";
  let exited: { code: number | null; signal: NodeJS.Signals | null } | null = null;
  child.stdout.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.stderr.on("data", (chunk: Buffer) => {
    log += chunk.toString();
  });
  child.on("exit", (code, signal) => {
    exited = { code, signal };
  });

  const cleanup = async () => {
    if (exited === null) child.kill("SIGKILL");
    await rm(dataDir, { recursive: true, force: true });
  };
  const die = async (message: string): Promise<never> => {
    await cleanup();
    fail(message, log);
  };

  /**
   * `localhost`, never `127.0.0.1`. Alepha's Node server binds the hostname it is given, and on a
   * dual-stack machine that resolves to `::1` ONLY — a probe hardcoded to the IPv4 loopback gets
   * ECONNREFUSED against a server that is up and healthy, which reads as "the app is dead".
   */
  const origin = `http://localhost:${port}`;

  // 1. It boots at all, and the API answers.
  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  let healthy = false;
  while (Date.now() < deadline && exited === null) {
    try {
      const response = await fetch(`${origin}/api/health`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { ok?: boolean };
        if (body.ok === true) {
          healthy = true;
          break;
        }
        await die(`/api/health answered ${response.status} with ${JSON.stringify(body)}`);
      }
    } catch {
      // Not listening yet — that is the normal state for the first second or two.
    }
    await sleep(250);
  }

  if (exited !== null) {
    await die(`the server exited during boot (${JSON.stringify(exited)})`);
  }
  if (!healthy) {
    await die(`/api/health never answered within ${BOOT_TIMEOUT_MS}ms`);
  }

  // 2. Migrations ran against the empty database, rather than being skipped.
  if (log.includes("Migration SKIPPED")) {
    await die("migrations were skipped — the process cannot see apps/main/migrations/");
  }

  // A green boot is not enough to prove that every statement inside a migration ran. Drizzle's
  // node:sqlite runner can journal a migration after executing only the first statement when a
  // hand-written file contains several statements without breakpoints. That shipped once: the
  // server stayed healthy, while every complete map read failed because `show_marker` was absent.
  // Inspect the production-shaped database itself so CI catches that half-migrated state.
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const missingColumns: string[] = [];
  try {
    const requireColumns = (table: string, expected: readonly string[]): void => {
      const columns = new Set(
        database
          .prepare(`PRAGMA table_info("${table}")`)
          .all()
          .flatMap((row) => {
            const name = (row as { name?: unknown }).name;
            return typeof name === "string" ? [name] : [];
          }),
      );
      const missing = expected.filter((column) => !columns.has(column));
      missingColumns.push(...missing.map((column) => `${table}.${column}`));
    };
    requireColumns("adventures", ["camera_mode"]);
    requireColumns("mapEvents", [
      "linked_event_id",
      "show_marker",
      "monster_pursuit_mode",
      "monster_acceleration",
      "monster_max_speed",
      "monster_one_hit_kill",
    ]);
  } finally {
    database.close();
  }
  if (missingColumns.length > 0) {
    await die(`migration schema is missing ${missingColumns.join(", ")}`);
  }

  // 3. The SPA shell is served. `GET /` is answered by the client's `$page` tree registered in
  //    `apps/main/src/main.ts`; with nothing composing it, this route 404s while every `/api/*`
  //    route above still answers, so health alone would not notice.
  const shell = await fetch(origin, { signal: AbortSignal.timeout(15_000) });
  if (!shell.ok) {
    await die(`GET / answered ${shell.status}, expected the SPA shell`);
  }
  const html = await shell.text();
  if (!html.includes("<title>Lindocara</title>")) {
    await die("GET / did not return the Lindocara shell");
  }
  if (!/<script[^>]+type="module"/.test(html)) {
    await die("the shell carries no module entry script — the browser build did not ship");
  }

  // 4. The realtime surface is mounted AND fenced. The assertion is deliberately three-way,
  //    because "the socket did not stay open" alone cannot tell a working fence from a room that
  //    stopped being served at all — both leave you without a session. An unadmitted dial to a
  //    MOUNTED `/ws/world` completes the upgrade and is then closed BY THE ROOM with an
  //    application code from `engine/close-codes.ts` (4004 SESSION_EXPIRED today); a path nothing
  //    serves fails the upgrade instead and surfaces as a transport error, no code at all. So:
  //    an app-range close is the pass, a transport error means the room vanished, and an open
  //    socket means a client reached the world without ever passing `GET /api/join` — the
  //    admission fence the entire party isolation model rests on.
  const dial = await new Promise<{ outcome: "closed" | "errored" | "open"; code?: number }>(
    (resolve) => {
      const socket = new WebSocket(`ws://localhost:${port}/ws/world`);
      const timer = setTimeout(() => {
        socket.terminate();
        resolve({ outcome: "open" });
      }, WEBSOCKET_TIMEOUT_MS);
      const settle = (result: { outcome: "closed" | "errored" | "open"; code?: number }) => {
        clearTimeout(timer);
        socket.removeAllListeners();
        socket.terminate();
        resolve(result);
      };
      socket.on("close", (code: number) => settle({ outcome: "closed", code }));
      socket.on("error", () => settle({ outcome: "errored" }));
    },
  );
  if (dial.outcome === "open") {
    await die("an unadmitted /ws/world dial stayed open — the admission fence is not holding");
  }
  if (dial.outcome === "errored") {
    await die("/ws/world refused the upgrade itself — the world room is not mounted");
  }
  if (dial.code === undefined || dial.code < 4000 || dial.code > 4999) {
    await die(
      `an unadmitted /ws/world dial closed with ${dial.code}, not an application close code — ` +
        "the room did not decide this refusal",
    );
  }

  // 5. Nothing errored on the way up. This is the assertion that catches a half-broken boot: a
  //    failed `ready()` hook, an unprovisioned framework table, a provider that logs and limps on.
  const errors = log
    .split("\n")
    .filter((line) => line.includes('"level":"ERROR"') || line.includes('"level":"FATAL"'));
  if (errors.length > 0) {
    await die(`the server logged ${errors.length} error(s) during boot`);
  }

  // 6. It stops when asked. A container that ignores SIGTERM is killed by the orchestrator
  //    mid-write, so this is part of "it deploys", not a nicety.
  child.kill("SIGTERM");
  const stopBy = Date.now() + SHUTDOWN_TIMEOUT_MS;
  while (Date.now() < stopBy && exited === null) {
    await sleep(100);
  }
  if (exited === null) {
    await die(`the server ignored SIGTERM for ${SHUTDOWN_TIMEOUT_MS}ms`);
  }

  await rm(dataDir, { recursive: true, force: true });
  console.log(
    `Boot smoke OK — migrations applied and schema verified, /api/health, SPA shell, /ws/world fenced, clean SIGTERM (port ${port}).`,
  );
}

await main();
