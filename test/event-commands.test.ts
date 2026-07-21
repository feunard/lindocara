/**
 * `parseEventCommands` off the wire: totality (every malformed field lands on `null`, never a
 * throw), the recursive count and depth caps, choices option bounds, and the mutation proofs the
 * plan names (the depth cap, and the recursive — not top-level — count). The parser is the only
 * boundary between an untrusted client body and the interpreter, so the table is deliberately wide.
 */
import { describe, expect, it } from "vitest";
import {
  type EventCommand,
  MAX_CHOICE_OPTIONS,
  MAX_COMMAND_DEPTH,
  MAX_COMMANDS_PER_PAGE,
  parseEventCommands,
} from "../src/shared/event-commands.js";

const UUID = "11111111-1111-4111-8111-111111111111";

/** A well-formed instance of every opcode, so the good-payload round-trip covers the whole union. */
const ONE_OF_EACH: EventCommand[] = [
  { t: "say", text: "Bonjour", name: "Mira" },
  { t: "say", text: "", name: null },
  {
    t: "choices",
    prompt: "Ouvrir ?",
    options: [
      { label: "Oui", body: [{ t: "changeGold", amount: 10 }] },
      { label: "Non", body: [] },
    ],
  },
  { t: "setSwitch", switchId: "0001", value: true },
  { t: "setVariable", variableId: "0002", op: "add", value: -3 },
  { t: "setVariable", variableId: "0003", op: "set", value: 7 },
  { t: "setSelfSwitch", selfSwitch: "B", value: false },
  {
    t: "if",
    cond: { type: "variable", variableId: "0004", min: 2 },
    then: [{ t: "breakLoop" }],
    else: [{ t: "exitRun" }],
  },
  { t: "loop", body: [{ t: "wait", frames: 20 }] },
  { t: "breakLoop" },
  { t: "exitRun" },
  { t: "wait", frames: 1 },
  { t: "teleport", mapId: UUID, col: 0, row: 12 },
  { t: "changeGold", amount: -50 },
  { t: "changeItems", itemId: "health_potion", count: 3 },
  { t: "startQuest", questId: "0001" },
  { t: "advanceQuest", questId: "0001", objectiveId: "0002", amount: 1 },
  { t: "completeQuest", questId: "0001" },
  { t: "comment", text: "author note" },
];

describe("parseEventCommands: good payloads", () => {
  it("round-trips one of every opcode unchanged", () => {
    expect(parseEventCommands(ONE_OF_EACH)).toEqual(ONE_OF_EACH);
  });

  it("accepts the empty program", () => {
    expect(parseEventCommands([])).toEqual([]);
  });

  it("accepts all three condition forms", () => {
    const program: EventCommand[] = [
      { t: "if", cond: { type: "switch", switchId: "0001" }, then: [], else: [] },
      { t: "if", cond: { type: "variable", variableId: "0001", min: 0 }, then: [], else: [] },
      { t: "if", cond: { type: "selfSwitch", selfSwitch: "C" }, then: [], else: [] },
    ];
    expect(parseEventCommands(program)).toEqual(program);
  });

  it("accepts a nested program: an if with a loop and a break inside a then-branch", () => {
    const program: EventCommand[] = [
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [
          {
            t: "loop",
            body: [
              {
                t: "if",
                cond: { type: "switch", switchId: "0002" },
                then: [{ t: "breakLoop" }],
                else: [],
              },
            ],
          },
        ],
        else: [{ t: "comment", text: "skip" }],
      },
    ];
    expect(parseEventCommands(program)).toEqual(program);
  });
});

describe("parseEventCommands: totality — every malformed field lands on null", () => {
  const cases: Record<string, unknown> = {
    "not an array": { t: "say", text: "x", name: null },
    "a non-object element": ["nope"],
    "null element": [null],
    "unknown opcode": [{ t: "teleportarium" }],
    "missing discriminant": [{ text: "x" }],
    "say: non-string text": [{ t: "say", text: 42, name: null }],
    "say: overlong text": [{ t: "say", text: "x".repeat(201), name: null }],
    "say: non-string name": [{ t: "say", text: "x", name: 7 }],
    "say: overlong name": [{ t: "say", text: "x", name: "y".repeat(201) }],
    "choices: non-array options": [{ t: "choices", prompt: "p", options: {} }],
    "choices: zero options": [{ t: "choices", prompt: "p", options: [] }],
    "choices: too many options": [
      {
        t: "choices",
        prompt: "p",
        options: Array.from({ length: MAX_CHOICE_OPTIONS + 1 }, () => ({ label: "o", body: [] })),
      },
    ],
    "choices: overlong label": [
      { t: "choices", prompt: "p", options: [{ label: "x".repeat(201), body: [] }] },
    ],
    "choices: option body not an array": [
      { t: "choices", prompt: "p", options: [{ label: "o", body: "nope" }] },
    ],
    "choices: malformed command in an option body": [
      { t: "choices", prompt: "p", options: [{ label: "o", body: [{ t: "nope" }] }] },
    ],
    "setSwitch: bad id shape": [{ t: "setSwitch", switchId: "1", value: true }],
    "setSwitch: non-boolean value": [{ t: "setSwitch", switchId: "0001", value: 1 }],
    "setVariable: bad op": [{ t: "setVariable", variableId: "0001", op: "mul", value: 1 }],
    "setVariable: non-integer value": [
      { t: "setVariable", variableId: "0001", op: "add", value: 1.5 },
    ],
    "setSelfSwitch: bad letter": [{ t: "setSelfSwitch", selfSwitch: "E", value: true }],
    "if: unknown cond type": [{ t: "if", cond: { type: "nope" }, then: [], else: [] }],
    "if: variable cond missing min": [
      { t: "if", cond: { type: "variable", variableId: "0001" }, then: [], else: [] },
    ],
    "if: switch cond bad id": [
      { t: "if", cond: { type: "switch", switchId: "x" }, then: [], else: [] },
    ],
    "if: non-array then": [
      { t: "if", cond: { type: "switch", switchId: "0001" }, then: {}, else: [] },
    ],
    "if: non-array else": [
      { t: "if", cond: { type: "switch", switchId: "0001" }, then: [], else: 0 },
    ],
    "loop: non-array body": [{ t: "loop", body: 3 }],
    "wait: below the floor": [{ t: "wait", frames: 0 }],
    "wait: above the ceiling": [{ t: "wait", frames: 601 }],
    "wait: non-integer": [{ t: "wait", frames: 5.5 }],
    "teleport: non-uuid mapId": [{ t: "teleport", mapId: "map1", col: 0, row: 0 }],
    "teleport: negative col": [{ t: "teleport", mapId: UUID, col: -1, row: 0 }],
    "teleport: non-integer row": [{ t: "teleport", mapId: UUID, col: 0, row: 1.5 }],
    "changeGold: non-integer amount": [{ t: "changeGold", amount: 1.5 }],
    "changeItems: bad id shape (uppercase)": [{ t: "changeItems", itemId: "Health", count: 1 }],
    "changeItems: bad id shape (leading digit)": [
      { t: "changeItems", itemId: "1potion", count: 1 },
    ],
    "changeItems: zero count": [{ t: "changeItems", itemId: "health_potion", count: 0 }],
    "changeItems: non-integer count": [{ t: "changeItems", itemId: "health_potion", count: 1.2 }],
    "comment: non-string text": [{ t: "comment", text: 9 }],
  };

  for (const [name, value] of Object.entries(cases)) {
    it(`rejects: ${name}`, () => {
      expect(parseEventCommands(value)).toBeNull();
    });
  }
});

/** Nest `depth` loops, then place a `say` inside the innermost body. The say sits at nesting level
 *  `depth + 1` (the top array is level 1). */
function nestedToDepth(depth: number): unknown {
  let inner: unknown[] = [{ t: "say", text: "deep", name: null }];
  for (let i = 0; i < depth; i += 1) inner = [{ t: "loop", body: inner }];
  return inner;
}

describe("parseEventCommands: depth cap", () => {
  it(`accepts a command at depth ${MAX_COMMAND_DEPTH}`, () => {
    // MAX_COMMAND_DEPTH - 1 loops put the say at exactly MAX_COMMAND_DEPTH.
    expect(parseEventCommands(nestedToDepth(MAX_COMMAND_DEPTH - 1))).not.toBeNull();
  });

  it(`rejects a command at depth ${MAX_COMMAND_DEPTH + 1}`, () => {
    // One more loop pushes the say to MAX_COMMAND_DEPTH + 1 (i.e. depth 9).
    expect(parseEventCommands(nestedToDepth(MAX_COMMAND_DEPTH))).toBeNull();
  });

  it("allows an empty body at the depth a command would be refused", () => {
    // A stack of MAX_COMMAND_DEPTH loops: the innermost loop sits at exactly MAX_COMMAND_DEPTH, and
    // its EMPTY body is the array at MAX+1. Empty, it holds no command at that depth, so nothing is
    // refused — the cap gates a command's presence, not an array's existence. Put a `say` in that
    // same body (nestedToDepth(MAX_COMMAND_DEPTH), the reject case above) and it fails.
    let inner: unknown[] = [];
    for (let i = 0; i < MAX_COMMAND_DEPTH; i += 1) inner = [{ t: "loop", body: inner }];
    expect(parseEventCommands(inner)).not.toBeNull();
  });
});

describe("parseEventCommands: recursive count cap", () => {
  it(`accepts exactly ${MAX_COMMANDS_PER_PAGE} commands`, () => {
    const flat = Array.from({ length: MAX_COMMANDS_PER_PAGE }, () => ({ t: "breakLoop" }));
    expect(parseEventCommands(flat)).not.toBeNull();
  });

  it(`rejects ${MAX_COMMANDS_PER_PAGE + 1} commands`, () => {
    const flat = Array.from({ length: MAX_COMMANDS_PER_PAGE + 1 }, () => ({ t: "breakLoop" }));
    expect(parseEventCommands(flat)).toBeNull();
  });

  it("counts NESTED commands toward the page total", () => {
    // 1 loop + 200 commands in its body = 201 nodes total. If the count were top-level-only this
    // would read as 1 command and pass — this is the mutation proof for recursive counting.
    const body = Array.from({ length: MAX_COMMANDS_PER_PAGE }, () => ({ t: "breakLoop" }));
    expect(parseEventCommands([{ t: "loop", body }])).toBeNull();
  });

  it("a nested program of exactly the cap passes", () => {
    // Mutation-proof companion: 1 loop + 199 body commands = 200 nodes, right at the ceiling.
    const body = Array.from({ length: MAX_COMMANDS_PER_PAGE - 1 }, () => ({ t: "breakLoop" }));
    expect(parseEventCommands([{ t: "loop", body }])).not.toBeNull();
  });
});
