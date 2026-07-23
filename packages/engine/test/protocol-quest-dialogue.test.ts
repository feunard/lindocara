import { parseClientMessage, parseServerMessage } from "@lindocara/engine/protocol.js";
import { describe, expect, it } from "vitest";

describe("quest dialogue protocol", () => {
  it("accepts bounded quest actions and rejects client-supplied outcomes", () => {
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "quest.action",
          conversationId: "conversation-1",
          questId: "0001",
          action: "turn-in",
          rewardChoiceId: "0002",
        }),
      ),
    ).toEqual({
      t: "quest.action",
      conversationId: "conversation-1",
      questId: "0001",
      action: "turn-in",
      rewardChoiceId: "0002",
    });
    expect(
      parseClientMessage(
        JSON.stringify({ t: "quest.action", conversationId: "conversation-1", action: "close" }),
      ),
    ).toEqual({ t: "quest.action", conversationId: "conversation-1", action: "close" });
    expect(
      parseClientMessage(
        JSON.stringify({
          t: "quest.action",
          conversationId: "conversation-1",
          questId: "0001",
          action: "accept",
          rewards: { gold: 999999 },
        }),
      ),
    ).toBeNull();
    expect(
      parseClientMessage(
        JSON.stringify({ t: "quest.action", conversationId: "conversation-1", action: "accept" }),
      ),
    ).toBeNull();
  });

  it("parses authored quest panels and bounds every prose and choice field", () => {
    const open = {
      t: "quest.open",
      conversationId: "conversation-1",
      entries: [
        {
          questId: "0001",
          title: "Mira's request",
          text: "Will you help?",
          phase: "offer",
          canAccept: true,
          canTurnIn: false,
          rewardChoices: [{ id: "0001", label: "A potion" }],
        },
      ],
    };
    expect(parseServerMessage(JSON.stringify(open))).toEqual(open);
    expect(
      parseServerMessage(
        JSON.stringify({ ...open, entries: [{ ...open.entries[0], phase: "admin" }] }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({ ...open, entries: [{ ...open.entries[0], text: "x".repeat(2_001) }] }),
      ),
    ).toBeNull();
    expect(
      parseServerMessage(
        JSON.stringify({
          t: "quest.result",
          conversationId: "conversation-1",
          questId: "0001",
          title: "Mira's request",
          text: "Thank you.",
          outcome: "completed",
        }),
      ),
    ).toMatchObject({ t: "quest.result", outcome: "completed" });
  });
});
