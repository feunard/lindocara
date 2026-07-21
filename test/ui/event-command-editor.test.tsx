import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it } from "vitest";
import { setLocale, t } from "../../src/client/i18n.js";
import {
  EventCommandEditor,
  type TeleportMap,
} from "../../src/client/ui/editor/EventCommandEditor.js";
import type { RegistryEntry } from "../../src/shared/adventure-state.js";
import type { EventCommand } from "../../src/shared/event-commands.js";

/** A controlled harness: the editor is controlled, so the parent must feed each `onChange` back as
 *  the next `commands`. `latest` captures the current tree for assertions. */
function Harness({
  initial = [],
  switches = [],
  variables = [],
  maps = [],
  latest,
}: {
  initial?: readonly EventCommand[];
  switches?: readonly RegistryEntry[];
  variables?: readonly RegistryEntry[];
  maps?: readonly TeleportMap[];
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
      { t: "say", text: "", name: null },
      {
        t: "if",
        cond: { type: "switch", switchId: "0001" },
        then: [{ t: "say", text: "", name: null }],
        else: [],
      },
      { t: "loop", body: [{ t: "breakLoop" }] },
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
    render(<Harness initial={initial} latest={latest} />);

    await user.click(
      screen.getByRole("button", {
        name: t("editor.event.cmd.if", { cond: t("editor.event.cmd.cond.switch", { id: "0001" }) }),
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

  it("falls back to a free-text switch id when the registry is empty", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await insertVia(user, "setSwitch")();
    // No combobox for the id — a normalized text input instead, defaulting to the 0001 placeholder.
    expect(
      screen.queryByRole("combobox", { name: t("editor.event.cmd.field.switchId") }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: t("editor.event.cmd.field.switchId") }),
    ).toBeDefined();
    expect(latest.current[0]).toEqual({ t: "setSwitch", switchId: "0001", value: true });
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
    expect(choices.options[1]?.body).toEqual([{ t: "say", text: "", name: null }]);

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
      { mapId: "11111111-1111-4111-8111-111111111111", name: "Town", cols: 25, rows: 18 },
      { mapId: "22222222-2222-4222-8222-222222222222", name: "Cave", cols: 8, rows: 6 },
    ];
    render(<Harness maps={maps} latest={latest} />);

    await insertVia(user, "teleport")();
    const col = screen.getByRole("spinbutton", { name: t("editor.event.cmd.field.col") });
    await user.clear(col);
    await user.type(col, "99");
    await user.tab(); // blur → clamp to Town's max column (24)
    expect((latest.current[0] as { col: number }).col).toBe(24);

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
  });

  it("only offers the tranche-5 vocabulary in the insert palette", async () => {
    const user = userEvent.setup();
    const latest = { current: [] as readonly EventCommand[] };
    render(<Harness latest={latest} />);

    await user.click(screen.getByRole("button", { name: t("editor.event.cmd.insert") }));
    const menu = screen.getByRole("menu", { name: t("editor.event.cmd.insert") });
    // The core event language plus three authored-quest commands; deferred common-event/audio and
    // screen commands remain absent.
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(17);
    expect(within(menu).queryByText(/common event/i)).toBeNull();
    expect(within(menu).queryByText(/BGM/i)).toBeNull();
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
