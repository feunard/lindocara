import { describe, expect, it } from "vitest";
import { parseCheatCommand } from "../src/cheats.js";

describe("parseCheatCommand /tp", () => {
  it("parses /tp col row into a teleport command", () => {
    expect(parseCheatCommand("/tp 12 7")).toEqual({ kind: "teleport", col: 12, row: 7 });
  });

  it("tolerates extra whitespace and uppercase", () => {
    expect(parseCheatCommand("  /TP  3   15 ")).toEqual({ kind: "teleport", col: 3, row: 15 });
  });

  it("rejects malformed coordinates as unknown", () => {
    expect(parseCheatCommand("/tp")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/tp 5")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/tp -1 4")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/tp a b")).toEqual({ kind: "unknown" });
    expect(parseCheatCommand("/tp 1.5 2")).toEqual({ kind: "unknown" });
  });

  it("keeps ordinary chat out of the command path", () => {
    expect(parseCheatCommand("tp 1 2")).toBeNull();
  });
});
