/**
 * The shared HTTP client for adventure tooling (seed + import/export CLIs): target gating,
 * register-or-login bearer token, JSON round-trips with machine-code failures. Node only.
 *
 * Auth is the Alepha idiom (`scripts/loadtest.mjs`, `packages/server/test-api/auth.test.ts`):
 * login first via `POST /_auth/token?provider=credentials`, and only on failure fall back to the
 * two-phase registration (`POST /api/users/register` mints an intent, `POST
 * /api/users/register/complete` creates the account) before logging in again. The legacy
 * `/api/register` + `/api/session` cookie flow is gone with the legacy stack.
 */

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
/**
 * Every host that is production, not just the canonical one.
 *
 * `lc.alepha.dev` is the public name and `lindocara.bay.alepha.dev` is the same
 * Bay app under its composed name — both reach the same database, so both need
 * the same `--allow-production` gate. `lindocara.alepha.dev` is the retired
 * Cloudflare Worker, kept protected while its data remains reachable.
 */
export const PRODUCTION_HOSTS = new Set([
  "lc.alepha.dev",
  "lindocara.bay.alepha.dev",
  "lindocara.alepha.dev",
]);
/** The app's dedicated dev port — pinned in `apps/main/vite.config.ts`, never Vite's shared 5173. */
export const DEFAULT_LOCAL_TARGET = "http://localhost:5273";

export interface ApiConfig {
  target: URL;
  username: string;
  password: string;
}

export function argumentsOf(argv: string[]): Map<string, string> {
  const args = new Map<string, string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) continue;
    const eq = raw.indexOf("=");
    if (eq === -1) args.set(raw.slice(2), "true");
    else args.set(raw.slice(2, eq), raw.slice(eq + 1));
  }
  return args;
}

/** Gate remote/production targets behind explicit flags; production also demands a real password. */
export function resolveTarget(args: Map<string, string>): URL {
  const target = new URL(args.get("target") ?? DEFAULT_LOCAL_TARGET);
  if (!LOCAL_HOSTS.has(target.hostname) && args.get("allow-remote") !== "true") {
    throw new Error("remote targets require --allow-remote=true");
  }
  if (PRODUCTION_HOSTS.has(target.hostname) && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  return target;
}

/**
 * The single credential path for every seeding CLI: the username may come from a flag, the password
 * may only come from `SEED_PASSWORD`, and against production it MUST.
 *
 * `defaultPassword` is the dev fallback for the local account this particular script owns — a
 * different tool seeds under a different name and that account already exists with its own
 * passphrase (`seed-proving-adventure.ts`'s `proving-pilot`), so the fallback is per-caller while
 * the rule is not. It is deliberately NOT reachable from a flag or from the environment: it applies
 * only where no `SEED_PASSWORD` is set, which the production branch below makes impossible.
 */
export function resolveCredentials(
  args: Map<string, string>,
  target: URL,
  defaultUsername: string,
  defaultPassword = "Brumeval-Local-2026",
): { username: string; password: string } {
  const username = args.get("username") ?? defaultUsername;
  const password = process.env.SEED_PASSWORD ?? defaultPassword;
  if (PRODUCTION_HOSTS.has(target.hostname) && !process.env.SEED_PASSWORD) {
    throw new Error("production access requires SEED_PASSWORD");
  }
  return { username, password };
}

export interface ApiResult {
  response: Response;
  body: unknown;
}

export class ApiClient {
  #token: string | null = null;
  readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  async request(path: string, init: RequestInit = {}): Promise<ApiResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.#token) headers.Authorization = `Bearer ${this.#token}`;
    const response = await fetch(new URL(path, this.config.target), { ...init, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    return { response, body };
  }

  failure(operation: string, result: ApiResult): Error {
    const record = result.body as Record<string, unknown> | null;
    const code = typeof record?.error === "string" ? `: ${record.error}` : "";
    return new Error(`${operation} failed (${result.response.status}${code})`);
  }

  /** Login first (accounts survive across runs); only register when login fails. */
  async ensureSession(): Promise<void> {
    const credentials = JSON.stringify({
      username: this.config.username,
      password: this.config.password,
    });
    let auth = await this.request("/_auth/token?provider=credentials", {
      method: "POST",
      body: credentials,
    });
    if (!auth.response.ok) {
      const intent = await this.request("/api/users/register", {
        method: "POST",
        body: credentials,
      });
      if (!intent.response.ok) throw this.failure("registration", intent);
      const intentId = (intent.body as { intentId?: string } | null)?.intentId;
      if (typeof intentId !== "string") throw new Error("registration intent has no intentId");
      const completed = await this.request("/api/users/register/complete", {
        method: "POST",
        body: JSON.stringify({ intentId }),
      });
      if (!completed.response.ok) throw this.failure("registration completion", completed);
      auth = await this.request("/_auth/token?provider=credentials", {
        method: "POST",
        body: credentials,
      });
    }
    const token = (auth.body as { access_token?: string } | null)?.access_token;
    if (!auth.response.ok || typeof token !== "string") throw this.failure("authentication", auth);
    this.#token = token;
    console.log(`session ok (${this.config.username} @ ${this.config.target.origin})`);
  }

  /**
   * `scope` picks WHICH listing is searched, and it matters as soon as a caller intends to WRITE
   * what it finds: `"all"` is the collaborative listing (every account's adventures, what the
   * import/export tooling wants), `"mine"` is the owner-scoped editor listing. A tool that reuses a
   * found adventure and then writes through an owner-fenced route — `seed-proving-adventure.ts` and
   * `PUT /api/maps/:id/heightfield` — must ask for `"mine"`, or a title collision with another
   * account hands it a map it will be refused on.
   */
  async findAdventureByTitle(title: string, scope: "all" | "mine" = "all"): Promise<string | null> {
    const path = scope === "mine" ? "/api/adventures" : "/api/adventures?scope=all";
    const result = await this.request(path, { method: "GET" });
    if (!result.response.ok || !Array.isArray(result.body)) {
      throw this.failure("adventure list", result);
    }
    const found = (result.body as { id: string; title: string }[]).find(
      (entry) => entry.title === title,
    );
    return found?.id ?? null;
  }
}
