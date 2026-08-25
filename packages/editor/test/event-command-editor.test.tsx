import { setLocale, t } from "@lindocara/client/i18n.js";
import {
  EventCommandEditor,
  type TeleportMap,
} from "@lindocara/editor/ui/editor/EventCommandEditor.js";
import type { RegistryEntry } from "@lindocara/engine/adventure-state.js";
import type { EventCommand } from "@lindocara/engine/event-commands.js";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";

/** A controlled harness: the editor is controlled, so the parent must feed each `onChange` back as
 *  the next `commands`. `latest` captures the current tree for assertions. */
function Harness({
  initial = [],
  switches = [],
  variables = [],
  maps = [],
  defaultSpeakerName,
  latest,
}: {
  initial?: readonly EventCommand[];
  switches?: readonly RegistryEntry[];
  variables?: readonly RegistryEntry[];
  maps?: readonly TeleportMap[];
  defaultSpeakerName?: string;
  latest: { current: readonly EventCommand[] };
}) {
  const [commands, setCommands] = useState<readonly EventCommand[]>(initial);
  latest.current = commands;
  return (
    <EventCommandEditor
      commands={commands}
      switches={switches}
      variables={variables}
      maps={maps}
      defaultSpeakerName={defaultSpeakerName}
      onChange={(next) => {
        latest.current = next;
        setCommands(next);
      }}
    />
  );
}

function insertVia(user: ReturnType<typeof userEvent.setup>, kind: EventCommand["t"]) {
  return async () => {
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.insert") }));
    await user.click(screen.getByRole("menuitem", { name: t(`editor.event.cmd.new.${kind}`) }));
  };
}

describe("EventCommandEditor", () => {
  beforeEach(() => setLocale("en"));

  it("authors say → if → nested say in then → loop + break as the exact tree", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);
    const insert = (kind: EventCommand["t"]) => insertVia(user, kind)();

    await insert("say");
    await insert("if"); // lands after the say (index 1), and is selected

    // Nest a say into the THEN branch by selecting that branch's slot first.
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.slot.then") }));
    await insert("say");

    // Append a loop at the end of the program, then a break inside its body.
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.slot.root") }));
    await insert("loop");
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.slot.loop") }));
    await insert("breakLoop");

    expect(latest.current).toEqual([
      { t: "say", text: "" },
      {
        t: "if",
        cond: { type: "selfSwitch", selfSwitch: "A" },
        then: [{ t: "say", text: "" }],
        else: [],
      },
      { t: "loop", body: [{ t: "breakLoop" }] },
    ]);
  });

  it("leaves a new dialogue line following the event's name instead of copying it", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness defaultSpeakerName="Warden Mira" latest={latest} />);

    await insertVia(user, "say")();

    // No `name` at all: the copy is what used to freeze at creation, so renaming the event left
    // every existing line saying the old name.
    expect(latest.current).toEqual([{ t: "say", text: "" }]);
    const speaker = screen.getByRole("combobox", { name: t("editor.event.cmd.field.name") });
    expect(speaker).toHaveValue("inherit");
    expect(
      screen.getByRole("option", {
        name: t("editor.event.cmd.speaker.inherit", { name: "Warden Mira" }),
      }),
    ).toBeInTheDocument();
    // The list line still shows who will speak it, resolved the way the runtime resolves it.
    expect(screen.getByRole("button", { name: /Warden Mira:/ })).toBeInTheDocument();
    expect(screen.getByText(t("editor.event.cmd.field.name.hint"))).toBeVisible();
  });

  it("gives one line a different speaker, and another none at all", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness defaultSpeakerName="Warden Mira" latest={latest} />);

    await insertVia(user, "say")();
    const speaker = screen.getByRole("combobox", { name: t("editor.event.cmd.field.name") });

    await user.selectOptions(speaker, "none");
    expect(latest.current).toEqual([{ t: "say", text: "", name: null }]);

    await user.selectOptions(speaker, "custom");
    const override = screen.getByRole("textbox", { name: t("editor.event.cmd.speaker.custom") });
    await user.clear(override);
    await user.type(override, "The wind");
    expect(latest.current).toEqual([{ t: "say", text: "", name: "The wind" }]);

    await user.selectOptions(speaker, "inherit");
    expect(latest.current).toEqual([{ t: "say", text: "" }]);
  });

  it("authors an editable lethal damage action", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "damage")();
    const damage = screen.getByRole("spinbutton", { name: t("editor.event.cmd.field.damage") });
    await user.clear(damage);
    await user.type(damage, "40");
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cmd.field.lethal") }),
      "on",
    );

    expect(latest.current).toEqual([{ t: "damage", amount: 40, lethal: true }]);
  });

  it("authors a configurable movement bonus or penalty", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "movementEffect")();
    expect(latest.current).toEqual([
      { t: "movementEffect", effect: "speed_boost", durationMs: 6_000, power: 1.35 },
    ]);

    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cmd.field.movementEffect") }),
      "double_jump",
    );
    expect(latest.current).toEqual([
      { t: "movementEffect", effect: "double_jump", durationMs: 9_000, power: 1 },
    ]);
  });

  it("inserts AFTER the selected command, not at the end (mutation proof a)", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    const initial: EventCommand[] = [
      { t: "comment", text: "a" },
      { t: "comment", text: "b" },
      { t: "comment", text: "c" },
    ];
    render(<Harness initial={initial} latest={latest} />);

    // Select the first comment, then insert a say: it must land at index 1, between a and b.
    await user.click(
      screen.getByRole("button", { name: t("editor.event.cmd.comment", { text: "a" }) }),
    );
    await insertVia(user, "say")();

    expect(latest.current[1]?.t).toBe("say");
    expect((latest.current[0] as { text: string }).text).toBe("a");
    expect((latest.current[2] as { text: string }).text).toBe("b");
    expect(latest.current).toHaveLength(4);
  });

  it("reorders a command down within its body", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    const initial: EventCommand[] = [
      { t: "comment", text: "a" },
      { t: "comment", text: "b" },
    ];
    render(<Harness initial={initial} latest={latest} />);

    await user.click(
      screen.getByRole("button", { name: t("editor.event.cmd.comment", { text: "a" }) }),
    );
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.moveDown") }));

    expect(latest.current.map((c) => (c as { text: string }).text)).toEqual(["b", "a"]);
  });

  it("deletes a command AND its body, orphaning nothing (mutation proof b)", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    const initial: EventCommand[] = [
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [{ t: "say", text: "buried", name: null }],
        else: [],
      },
    ];
    render(<Harness initial={initial} switches={[{ id: "0001", name: "Door" }]} latest={latest} />);

    await user.click(
      screen.getByRole("button", {
        name: t("editor.event.cmd.if", {
          cond: t("editor.event.cmd.cond.switch", { id: "Door" }),
        }),
      }),
    );
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.delete") }));

    // The whole subtree is gone — the nested say did not survive as an orphan.
    expect(latest.current).toEqual([]);
  });

  it("refuses an insert past MAX_COMMANDS_PER_PAGE counting recursively (mutation proof c)", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    // 1 loop + 199 nested breaks = 200 nodes recursively, but only ONE top-level command. A guard
    // counting only the top-level array would see 1 and allow the insert.
    const body: EventCommand[] = Array.from({ length: 199 }, () => ({ t: "breakLoop" }));
    const initial: EventCommand[] = [{ t: "loop", body }];
    render(<Harness initial={initial} latest={latest} />);

    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.slot.root") }));
    await insertVia(user, "comment")();

    expect(screen.getByRole("alert").textContent).toContain("200");
    expect(latest.current).toBe(initial); // unchanged — nothing was inserted
  });

  it("refuses an insert past MAX_COMMAND_DEPTH", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    // Eight nested loops: the innermost loop's body sits at depth 9, one past the depth-8 cap.
    let nested: EventCommand = { t: "loop", body: [] };
    for (let i = 0; i < 7; i += 1) nested = { t: "loop", body: [nested] };
    render(<Harness initial={[nested]} latest={latest} />);

    // The deepest loop-body slot renders first (the tree unwinds outward), so it is slot #0.
    const slots = screen.getAllByRole("button", { name: t("editor.event.cmd.slot.loop") });
    const deepest = slots[0];
    if (!deepest) throw new Error("no loop slot");
    await user.click(deepest);
    await insertVia(user, "comment")();

    expect(screen.getByRole("alert").textContent).toContain(String(8));
    expect(latest.current[0]).toEqual(nested); // unchanged
  });

  it("writes the picked switch registry ID (not its name) for setSwitch", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    const switches: RegistryEntry[] = [
      { id: "0001", name: "Door" },
      { id: "0002", name: "Bridge" },
    ];
    render(<Harness switches={switches} latest={latest} />);

    await insertVia(user, "setSwitch")();
    const select = screen.getByRole("combobox", { name: t("editor.event.cmd.field.switchId") });
    await user.selectOptions(select, "0002");

    expect(latest.current[0]).toEqual({ t: "setSwitch", switchId: "0002", value: true });
  });

  it("disables global state commands until named adventure data exists", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.insert") }));

    expect(
      screen.getByRole("menuitem", { name: t("editor.event.cmd.new.setSwitch") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: t("editor.event.cmd.new.setVariable") }),
    ).toBeDisabled();
    expect(
      screen.getByRole("menuitem", { name: t("editor.event.cmd.new.setSelfSwitch") }),
    ).toBeEnabled();
    expect(screen.queryByRole("textbox", { name: /state|counter/i })).not.toBeInTheDocument();
    expect(latest.current).toEqual([]);
  });

  it("authors readable area and activity facts instead of raw quest counters", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "enterArea")();
    const area = screen.getByRole("textbox", { name: t("editor.event.cmd.field.area") });
    await user.clear(area);
    await user.type(area, "North Gate");
    await insertVia(user, "completeActivity")();
    const activity = screen.getByRole("textbox", {
      name: t("editor.event.cmd.field.activity"),
    });
    await user.clear(activity);
    await user.type(activity, "Défense du Village");

    expect(latest.current).toEqual([
      { t: "enterArea", areaId: "north_gate" },
      { t: "completeActivity", activityId: "defense_du_village" },
    ]);
  });

  it("adds and removes choice options and nests into a chosen option's branch", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "choices")();
    // One option by default; add a second.
    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.field.addOption") }));
    expect((latest.current[0] as unknown as { options: unknown[] }).options).toHaveLength(2);

    // Label option 2, then nest a say into its branch by selecting that option's slot.
    await user.type(
      screen.getByRole("textbox", { name: t("editor.event.cmd.field.option", { n: 2 }) }),
      "Yes",
    );
    await user.click(
      screen.getByRole("button", { name: t("editor.event.cmd.slot.option", { label: "Yes" }) }),
    );
    await insertVia(user, "say")();

    const choices = latest.current[0] as unknown as {
      t: "choices";
      options: { label: string; body: EventCommand[] }[];
    };
    expect(choices.options[0]?.body).toEqual([]);
    expect(choices.options[1]?.label).toBe("Yes");
    expect(choices.options[1]?.body).toEqual([{ t: "say", text: "" }]);

    // Re-select the choices command (nesting the say moved the selection into option 2's branch),
    // then remove option 1 — the remaining option keeps its nested say.
    await user.click(screen.getByRole("button", { name: /choices:/i }));
    await user.click(
      screen.getByRole("button", { name: t("editor.event.cmd.field.removeOption", { n: 1 }) }),
    );
    const after = latest.current[0] as unknown as { options: { label: string }[] };
    expect(after.options).toHaveLength(1);
    expect(after.options[0]?.label).toBe("Yes");
  });

  it("clamps a teleport cell to the chosen map's dims and reclamps on a map switch", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    const maps: TeleportMap[] = [
      {
        mapId: "11111111-1111-4111-8111-111111111111",
        name: "Town",
        cols: 25,
        rows: 18,
        destinations: [],
      },
      {
        mapId: "22222222-2222-4222-8222-222222222222",
        name: "Cave",
        cols: 8,
        rows: 6,
        destinations: [],
      },
    ];
    render(<Harness maps={maps} latest={latest} />);

    await insertVia(user, "teleport")();
    expect(latest.current[0]).toMatchObject({ category: "geographic" });
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cmd.field.transitionCategory") }),
      "shortcut",
    );
    expect(latest.current[0]).toMatchObject({ category: "shortcut" });
    const col = screen.getByRole("spinbutton", {
      name: t("editor.event.cmd.field.col", { max: 25 }),
    });
    expect(col).toHaveAttribute("min", "1");
    expect(col).toHaveAttribute("max", "25");
    expect(col).toHaveValue(1);
    await user.clear(col);
    await user.type(col, "99");
    await user.tab(); // blur → clamp to Town's max column (24)
    expect((latest.current[0] as { col: number }).col).toBe(24);
    expect(col).toHaveValue(25);

    // Switch to the smaller Cave map: the column reclamps to 7.
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cmd.field.map") }),
      maps[1]?.mapId ?? "",
    );
    expect(latest.current[0]).toMatchObject({
      t: "teleport",
      mapId: maps[1]?.mapId,
      col: 7,
    });
    expect(
      screen.getByRole("spinbutton", {
        name: t("editor.event.cmd.field.col", { max: 8 }),
      }),
    ).toHaveValue(8);
  });

  it("only offers the tranche-5 vocabulary in the insert palette", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.insert") }));
    const menu = screen.getByRole("menu", { name: t("editor.event.cmd.insert") });
    // The core event language plus the authored quest/fact commands, the endAdventure beat, the
    // `openShop` counter, reusable damage/impulse traps and movement modifiers, the authored cue and
    // the three ambience commands; deferred common-event and screen commands remain absent.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(28);
    expect(
      within(menu).getByRole("menuitem", { name: t("editor.event.cmd.new.openShop") }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole("menuitem", { name: t("editor.event.cmd.new.playSound") }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole("menuitem", { name: t("editor.event.cmd.new.movementEffect") }),
    ).toBeEnabled();
    expect(
      within(menu).getByRole("menuitem", { name: t("editor.event.cmd.new.trapImpulse") }),
    ).toBeEnabled();
    expect(within(menu).queryByText(/common event/i)).toBeNull();
    expect(within(menu).queryByText(/BGM/i)).toBeNull();
  });

  it("authors the sky, the clock and the soundtrack, each with the map's own as the way back", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    // Dropped in and left alone, an ambience command is harmless: it says "the map's own value".
    await insertVia(user, "setWeather")();
    expect(latest.current).toEqual([{ t: "setWeather", weather: null }]);

    const weather = screen.getByRole("combobox", { name: t("editor.event.cmd.field.weather") });
    await user.selectOptions(weather, "storm");
    expect(latest.current).toEqual([{ t: "setWeather", weather: "storm" }]);
    await user.selectOptions(weather, "");
    expect(latest.current).toEqual([{ t: "setWeather", weather: null }]);
  });

  it("authors a cue from the catalogue, grouped by what it is for", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "playSound")();
    // A catalogue id, never a path: that is what lets a cue be re-recorded without touching a map.
    expect(latest.current).toEqual([{ t: "playSound", soundId: "hurt" }]);

    const picker = screen.getByRole("combobox", { name: t("editor.event.cmd.field.sound") });
    await user.selectOptions(picker, "coins");
    expect(latest.current).toEqual([{ t: "playSound", soundId: "coins" }]);
    expect(screen.getByRole("button", { name: /coins/ })).toBeInTheDocument();
  });

  it("disables the teleport command when the adventure has no maps", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.insert") }));
    expect(
      screen.getByRole("menuitem", { name: t("editor.event.cmd.new.teleport") }),
    ).toBeDisabled();
  });
});
