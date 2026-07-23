/**
 * Seeds the Brumeval intro adventure (3 maps, NPCs, monsters, 6 chained quests, boss, victory)
 * through the same /api/* surface the editor uses. Idempotent: re-running updates in place;
 * `--reset` deletes the adventure first.
 *
 * Run with: npm run seed:brumeval -- --target=http://localhost:5178
 * Prod:     SEED_PASSWORD=… npm run seed:brumeval -- --target=https://lindocara.alepha.dev \
 *             --allow-remote --allow-production
 *
 * Design: docs/superpowers/specs/2026-07-24-brumeval-adventure-design.md
 * Plan:   docs/superpowers/plans/2026-07-24-brumeval-adventure.md
 */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const PRODUCTION_HOST = "lindocara.alepha.dev";
const ADVENTURE_TITLE = "Brumeval";
const AUTHOR_USERNAME = "brumevalauthor";

interface Config {
  target: URL;
  reset: boolean;
  dryRun: boolean;
  password: string;
}

function argumentsOf(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args.set(raw.slice(2), "true");
    else args.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  return args;
}

function configuration(argv: string[]): Config {
  const args = argumentsOf(argv);
  const target = new URL(args.get("target") ?? "http://localhost:5178");
  if (!LOCAL_HOSTS.has(target.hostname) && args.get("allow-remote") !== "true") {
    throw new Error("remote targets require --allow-remote=true");
  }
  if (target.hostname === PRODUCTION_HOST && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  const password = process.env.SEED_PASSWORD ?? "Brumeval-Local-2026";
  if (target.hostname === PRODUCTION_HOST && !process.env.SEED_PASSWORD) {
    throw new Error("production seeding requires SEED_PASSWORD");
  }
  return {
    target,
    reset: args.get("reset") === "true",
    dryRun: args.get("dry-run") === "true",
    password,
  };
}

interface ApiResult {
  response: Response;
  body: unknown;
}

let sessionCookieValue: string | null = null;

async function api(config: Config, path: string, init: RequestInit = {}): Promise<ApiResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (sessionCookieValue) headers.Cookie = sessionCookieValue;
  const response = await fetch(new URL(path, config.target), { ...init, headers });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

function failure(operation: string, result: ApiResult): Error {
  const record = result.body as Record<string, unknown> | null;
  const code = typeof record?.error === "string" ? `: ${record.error}` : "";
  return new Error(`${operation} failed (${result.response.status}${code})`);
}

async function ensureSession(config: Config): Promise<void> {
  const credentials = JSON.stringify({ username: AUTHOR_USERNAME, password: config.password });
  let auth = await api(config, "/api/register", { method: "POST", body: credentials });
  if (auth.response.status === 409) {
    auth = await api(config, "/api/session", { method: "POST", body: credentials });
  }
  if (!auth.response.ok) throw failure("authentication", auth);
  const cookie = auth.response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
  if (!cookie) throw new Error("authentication response omitted the session cookie");
  sessionCookieValue = cookie;
  console.log(`session ok (${AUTHOR_USERNAME} @ ${config.target.origin})`);
}

interface AdventureSummary {
  id: string;
  title: string;
}

async function findAdventureByTitle(config: Config, title: string): Promise<string | null> {
  const result = await api(config, "/api/adventures", { method: "GET" });
  if (!result.response.ok || !Array.isArray(result.body)) throw failure("adventure list", result);
  const found = (result.body as AdventureSummary[]).find((entry) => entry.title === title);
  return found?.id ?? null;
}

async function main(): Promise<void> {
  const config = configuration(process.argv.slice(2));
  if (config.dryRun) {
    console.log("dry run: nothing to build yet (map builders land in the next task)");
    return;
  }
  await ensureSession(config);
  const existing = await findAdventureByTitle(config, ADVENTURE_TITLE);
  if (existing && config.reset) {
    const del = await api(config, `/api/adventures/${existing}`, { method: "DELETE" });
    if (!del.response.ok) throw failure("adventure delete", del);
    console.log(`deleted existing adventure ${existing}`);
  } else if (existing) {
    console.log(`adventure already present: ${existing}`);
  } else {
    console.log("no Brumeval adventure yet");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
