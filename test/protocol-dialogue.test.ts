/**
 * The dialogue protocol (tranche 5, Task 4), both directions. The client intents (`event.advance`/
 * `event.choose`) and the server beats (`event.say`/`event.choices`/`event.close`) are each accepted
 * when well-formed and DROPPED (→ null) on anything malformed — the same message discipline the rest
 * of the wire follows. Authored prose is bounded by `COMMAND_TEXT_MAX`; options by `MAX_CHOICE_OPTIONS`;
 * every `runId` is a wire id; the choose index is a wire-bounded safe int (the server re-validates it
 * against the live pending offer regardless, `event-run-system.test.ts` pins that half).
 */

import { COMMAND_TEXT_MAX, MAX_CHOICE_OPTIONS } from "@lindocara/engine/event-commands.js";
import { parseClientMessage, parseServerMessage } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

const RUN = "run-abc_123";

describe("client dialogue intents", () => {
  it("accepts a well-formed advance and choose", () => {
    expect(parseClientMessage(JSON.stringify({ t: "event.advance", runId: RUN }))).toEqual({
      t: "event.advance",
      runId: RUN,
    });
    expect(parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN, index: 0 }))).toEqual(
      {
        t: "event.choose",
        runId: RUN,
        index: 0,
      },
    );
    expect(parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN, index: 3 }))).toEqual(
      {
        t: "event.choose",
        runId: RUN,
        index: 3,
      },
    );
  });

  it("drops an advance with a bad or missing runId, or extra keys", () => {
    expect(parseClientMessage(JSON.stringify({ t: "event.advance", runId: "" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "event.advance", runId: "bad id!" }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "event.advance" }))).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "event.advance", runId: RUN, extra: 1 })),
    ).toBeNull();
  });

  it("drops a choose whose index is a float, negative, or beyond the wire cap", () => {
    expect(
      parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN, index: 1.5 })),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN, index: -1 })),
    ).toBeNull();
    // At or beyond MAX_CHOICE_OPTIONS is refused at the wire (a real offer never has more options).
    expect(
      parseClientMessage(
        JSON.stringify({ t: "event.choose", runId: RUN, index: MAX_CHOICE_OPTIONS }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN, index: "0" })),
    ).toBeNull();
    expect(parseClientMessage(JSON.stringify({ t: "event.choose", runId: RUN }))).toBeNull();
  });
});

describe("server dialogue beats", () => {
  it("accepts a say (with and without a name), choices, and close", () => {
    expect(
      parseServerMessage(JSON.stringify({ t: "event.say", runId: RUN, text: "Hail, traveller." })),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "event.say", runId: RUN, text: "Hail.", name: "Mira" }),
      ),
    ).not.toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "event.choices", runId: RUN, prompt: "Well?", options: ["Yes", "No"] }),
      ),
    ).not.toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "event.close", runId: RUN }))).not.toBeNull();
  });

  it("drops a say whose text exceeds COMMAND_TEXT_MAX or is not a string", () => {
    const tooLong = "x".repeat(COMMAND_TEXT_MAX + 1);
    expect(
      parseServerMessage(JSON.stringify({ t: "event.say", runId: RUN, text: tooLong })),
    ).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "event.say", runId: RUN, text: 42 }))).toBeNull();
    // A present but over-long name fails the whole beat.
    expect(
      parseServerMessage(JSON.stringify({ t: "event.say", runId: RUN, text: "hi", name: tooLong })),
    ).toBeNull();
  });

  it("drops choices with zero or more than MAX_CHOICE_OPTIONS, or a non-string option", () => {
    expect(
      parseServerMessage(
        JSON.stringify({ t: "event.choices", runId: RUN, prompt: "?", options: [] }),
      ),
    ).toBeNull();
    const tooMany = Array.from({ length: MAX_CHOICE_OPTIONS + 1 }, (_, i) => `o${i}`);
    expect(
      parseServerMessage(
        JSON.stringify({ t: "event.choices", runId: RUN, prompt: "?", options: tooMany }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ t: "event.choices", runId: RUN, prompt: "?", options: ["ok", 3] }),
      ),
    ).toBeNull();
  });

  it("drops any beat carrying a malformed runId", () => {
    expect(parseServerMessage(JSON.stringify({ t: "event.close", runId: "" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "event.close", runId: "bad id!" }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ t: "event.say", runId: 7, text: "hi" }))).toBeNull();
  });
});
