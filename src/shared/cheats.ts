/**
 * Local test commands accepted by the authoritative World when CHEATS_ENABLED=true.
 *
 * Keep this catalogue syntax-only: player-facing explanations live in i18n and the server
 * sends event codes, never prose. `/help` derives its output from this list so documentation
 * and parsing cannot silently drift apart.
 */
export const CHEAT_COMMAND_SYNTAX =
  "/up1…/up10 · /nodead · /heal · /hurt · /resource · /resetcd · /loot · /die · /ghost · /revive · /reset · /where";

export type CheatCommand =
  | { kind: "help" }
  | { kind: "level"; level: number }
  | { kind: "nodead" }
  | { kind: "heal" }
  | { kind: "hurt" }
  | { kind: "resource" }
  | { kind: "reset_cooldowns" }
  | { kind: "loot" }
  | { kind: "die" }
  | { kind: "ghost" }
  | { kind: "revive" }
  | { kind: "reset" }
  | { kind: "where" }
  | { kind: "unknown" };

/** Null means ordinary chat; every slash-prefixed line stays private and is treated as a command. */
export function parseCheatCommand(text: string): CheatCommand | null {
  const command = text.trim().toLowerCase();
  if (!command.startsWith("/")) return null;
  if (command === "/help" || command === "/cheats") return { kind: "help" };
  const level = /^\/up(10|[1-9])$/.exec(command);
  if (level) return { kind: "level", level: Number(level[1]) };
  if (command === "/nodead") return { kind: "nodead" };
  if (command === "/heal") return { kind: "heal" };
  if (command === "/hurt") return { kind: "hurt" };
  if (command === "/resource") return { kind: "resource" };
  if (command === "/resetcd") return { kind: "reset_cooldowns" };
  if (command === "/loot") return { kind: "loot" };
  if (command === "/die") return { kind: "die" };
  if (command === "/ghost") return { kind: "ghost" };
  if (command === "/revive") return { kind: "revive" };
  if (command === "/reset") return { kind: "reset" };
  if (command === "/where") return { kind: "where" };
  return { kind: "unknown" };
}
