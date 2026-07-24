/**
 * The shared HTTP client for adventure tooling (seed + import/export CLIs): target gating,
 * register-or-login session cookie, JSON round-trips with machine-code failures. Node only.
 */

export const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
export const PRODUCTION_HOST = "lindocara.alepha.dev";
export const DEFAULT_LOCAL_TARGET = "http://localhost:5178";

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
  if (target.hostname === PRODUCTION_HOST && args.get("allow-production") !== "true") {
    throw new Error("the production host requires --allow-production=true");
  }
  return target;
}

export function resolveCredentials(
  args: Map<string, string>,
  target: URL,
  defaultUsername: string,
): { username: string; password: string } {
  const username = args.get("username") ?? defaultUsername;
  const password = process.env.SEED_PASSWORD ?? "Brumeval-Local-2026";
  if (target.hostname === PRODUCTION_HOST && !process.env.SEED_PASSWORD) {
    throw new Error("production access requires SEED_PASSWORD");
  }
  return { username, password };
}

export interface ApiResult {
  response: Response;
  body: unknown;
}

export class ApiClient {
  #cookie: string | null = null;
  readonly config: ApiConfig;

  constructor(config: ApiConfig) {
    this.config = config;
  }

  async request(path: string, init: RequestInit = {}): Promise<ApiResult> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.#cookie) headers.Cookie = this.#cookie;
    const response = await fetch(new URL(path, this.config.target), { ...init, headers });
    const body = response.status === 204 ? null : await response.json().catch(() => null);
    return { response, body };
  }

  failure(operation: string, result: ApiResult): Error {
    const record = result.body as Record<string, unknown> | null;
    const code = typeof record?.error === "string" ? `: ${record.error}` : "";
    return new Error(`${operation} failed (${result.response.status}${code})`);
  }

  /** Register, falling back to login on 409 — the loadtest pattern. */
  async ensureSession(): Promise<void> {
    const credentials = JSON.stringify({
      username: this.config.username,
      password: this.config.password,
    });
    let auth = await this.request("/api/register", { method: "POST", body: credentials });
    if (auth.response.status === 409) {
      auth = await this.request("/api/session", { method: "POST", body: credentials });
    }
    if (!auth.response.ok) throw this.failure("authentication", auth);
    const cookie = auth.response.headers.get("set-cookie")?.split(";", 1)[0] ?? null;
    if (!cookie) throw new Error("authentication response omitted the session cookie");
    this.#cookie = cookie;
    console.log(`session ok (${this.config.username} @ ${this.config.target.origin})`);
  }

  async findAdventureByTitle(title: string): Promise<string | null> {
    const result = await this.request("/api/adventures", { method: "GET" });
    if (!result.response.ok || !Array.isArray(result.body)) {
      throw this.failure("adventure list", result);
    }
    const found = (result.body as { id: string; title: string }[]).find(
      (entry) => entry.title === title,
    );
    return found?.id ?? null;
  }
}
