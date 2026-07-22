import { WS_CLOSE } from "@lindocara/engine/close-codes.js";
import { describe, expect, it } from "vitest";
import { Client, until } from "./world-harness.js";

async function formParty(
  leader: Client,
  member: Client,
): Promise<{ leaderId: string; memberId: string }> {
  const leaderWelcome = await until("leader welcome", () => leader.welcome);
  const memberWelcome = await until("member welcome", () => member.welcome);
  leader.sendRaw(JSON.stringify({ t: "party.create" }));
  await until("party created", () =>
    leader.received.find((message) => message.t === "party.state" && message.party !== null),
  );
  leader.sendRaw(JSON.stringify({ t: "party.invite", playerId: memberWelcome.selfId }));
  const invite = await until("party invitation", () =>
    member.received.find((message) => message.t === "party.invite"),
  );
  if (invite.t !== "party.invite") throw new Error("invalid invitation");
  member.sendRaw(JSON.stringify({ t: "party.accept", inviteId: invite.inviteId }));
  await until("member joined", () =>
    member.received.find(
      (message) => message.t === "party.state" && message.party?.members.length === 2,
    ),
  );
  return { leaderId: leaderWelcome.selfId, memberId: memberWelcome.selfId };
}

describe("party integration", () => {
  it("validates invitations, leader authority, and party chat through the real room", async () => {
    const leader = await Client.join("party_leader");
    const member = await Client.join("party_member");
    const outsider = await Client.join("party_outsider");
    await until("outsider welcome", () => outsider.welcome);

    member.sendRaw(
      JSON.stringify({
        t: "party.accept",
        inviteId: "44444444-4444-4444-8444-444444444444",
      }),
    );
    await until("forged invite rejected", () =>
      member.received.find((message) => message.t === "event" && message.code === "party.invalid"),
    );
    const { leaderId, memberId } = await formParty(leader, member);

    member.sendRaw(JSON.stringify({ t: "party.kick", playerId: leaderId }));
    await until("non leader rejected", () =>
      member.received.find(
        (message) => message.t === "event" && message.code === "party.forbidden",
      ),
    );

    const outsiderCount = outsider.received.length;
    leader.sendRaw(JSON.stringify({ t: "chat", channel: "party", text: "secret" }));
    await until("leader party chat", () =>
      leader.received.find(
        (message) =>
          message.t === "chat" && message.channel === "party" && message.text === "secret",
      ),
    );
    await until("member party chat", () =>
      member.received.find(
        (message) =>
          message.t === "chat" && message.channel === "party" && message.text === "secret",
      ),
    );
    expect(
      outsider.received
        .slice(outsiderCount)
        .some((message) => message.t === "chat" && message.channel === "party"),
    ).toBe(false);

    leader.sendRaw(JSON.stringify({ t: "party.kick", playerId: memberId }));
    await until("member kicked", () =>
      member.received.find((message) => message.t === "party.state" && message.party === null),
    );
    leader.close();
    member.close();
    outsider.close();
  });

  it("removes a transitioning member from the source-room party", async () => {
    const runner = await Client.join("p_portal_run", { position: { x: 880, y: 450 } });
    const member = await Client.join("p_portal_mem");
    const { leaderId, memberId } = await formParty(runner, member);
    runner.action("interact");
    expect((await until("party transition", () => runner.closeInfo ?? undefined)).code).toBe(
      WS_CLOSE.ZONE_TRANSITION,
    );
    const adapted = await until("party adapted", () =>
      [...member.received]
        .reverse()
        .find((message) => message.t === "party.state" && message.party?.leaderId === memberId),
    );
    if (adapted.t !== "party.state" || !adapted.party) throw new Error("missing adapted party");
    expect(adapted.party.members.some((entry) => entry.id === leaderId)).toBe(false);
    member.close();
  });

  // Experience is split, so sharing it costs nothing. Loot is minted per recipient and quest
  // credit granted per recipient — so a party member who never lifts a finger used to multiply
  // both by party size. Park alts at REWARD_DISTANCE and every kill pays out again.
  it("shares experience with an idle party member but never loot", {
    timeout: 30_000,
  }, async () => {
    const killer = await Client.join("LeechKiller", {
      zoneId: "verdant-reach",
      position: { x: 1870, y: 820 },
      level: 10,
    });
    // Alive, authorized, and well inside REWARD_DISTANCE (900) of the monster - the exact
    // position from which a leech used to collect a full personal drop for doing nothing.
    const leech = await Client.join("LeechIdler", {
      zoneId: "verdant-reach",
      position: { x: 2270, y: 820 },
      level: 10,
    });
    try {
      await formParty(killer, leech);

      killer.action("attack");
      await scheduler.wait(600);
      killer.action("attack");

      // The leech shares the kill: experience is split, so it still gets the event.
      await until("idle member shares the kill", () =>
        leech.received.find(
          (message) => message.t === "event" && message.code === "monster.defeated",
        ),
      );

      // The killer earned a drop. It lands at the monster's feet, where the killer is standing,
      // so it is often picked up the same tick it appears - accept either sighting.
      await until("killer earns loot", () => {
        if ((killer.latestSnapshot?.loot.length ?? 0) > 0) return true;
        return killer.received.some(
          (message) => message.t === "event" && message.code === "loot.picked",
        )
          ? true
          : undefined;
      });

      // ...and the leech earned none. Loot is only ever sent to its owner, so an empty list is
      // proof of absence, not of distance. Give the room several snapshots to settle first.
      await scheduler.wait(1_000);
      expect(leech.latestSnapshot?.loot ?? []).toEqual([]);
      expect(
        leech.received.some((message) => message.t === "event" && message.code === "loot.picked"),
      ).toBe(false);
    } finally {
      killer.close();
      leech.close();
    }
  });
});
