import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultEventPage } from "../../src/client/game/editor-state.js";
import { setLocale, t } from "../../src/client/i18n.js";
import { EventDialog } from "../../src/client/ui/editor/EventDialog.js";
import { type AdventureRegistry, EMPTY_REGISTRY } from "../../src/shared/adventure-state.js";
import type { MapEvent } from "../../src/shared/map-events.js";

/** A fresh single-page event to seed the dialog draft with, at the given ordinal/cell. */
function seedEvent(overrides: Partial<MapEvent> = {}): MapEvent {
  return {
    id: "ev-1",
    col: 3,
    row: 4,
    name: "",
    ordinal: 1,
    kind: "normal",
    species: null,
    patrolRadius: null,
    pages: [defaultEventPage()],
    ...overrides,
  };
}

function renderDialog(event: MapEvent, registry: AdventureRegistry = EMPTY_REGISTRY) {
  const onCommit = vi.fn();
  const onDelete = vi.fn();
  const onCancel = vi.fn();
  render(
    <EventDialog
      event={event}
      registry={registry}
      onCommit={onCommit}
      onDelete={onDelete}
      onCancel={onCancel}
    />,
  );
  return { onCommit, onDelete, onCancel };
}

describe("EventDialog", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("round-trips every block across two pages and commits one draft with explicit nulls", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent());

    // Header: name.
    await user.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "Guard");

    // Page 1: switch condition on with id 0042; random movement; autorun trigger; always-on-top.
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const switchId = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    await user.clear(switchId);
    await user.type(switchId, "0042");
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.move.type") }),
      "random",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.trigger") }),
      "auto",
    );
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.opt.onTop") }));

    // Add page 2 (auto-selected) and author a different set of fields there.
    await user.click(screen.getByRole("button", { name: t("editor.event.page.add") }));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    const varId = screen.getByRole("textbox", { name: t("editor.event.cond.variable") });
    await user.clear(varId);
    await user.type(varId, "0007");
    const varMin = screen.getByRole("spinbutton", { name: t("editor.event.cond.variable.min") });
    await user.clear(varMin);
    await user.type(varMin, "5");
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.selfSwitch") }));
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.cond.selfSwitch") }),
      "B",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: t("editor.event.move.speed") }),
      "2",
    );

    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit).toHaveBeenCalledTimes(1);
    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.name).toBe("Guard");
    expect(committed.pages).toHaveLength(2);

    // Page 1 got page-1 edits and nothing from page 2 (the mutation-proof: a save that wrote to the
    // wrong page index would cross these fields).
    const [p1, p2] = committed.pages;
    expect(p1?.condSwitchId).toBe("0042");
    expect(p1?.moveType).toBe("random");
    expect(p1?.trigger).toBe("auto");
    expect(p1?.optOnTop).toBe(true);
    expect(p1?.condVariableId).toBeNull();
    expect(p1?.condVariableMin).toBeNull();
    expect(p1?.condSelfSwitch).toBeNull();

    // Page 2 got page-2 edits only.
    expect(p2?.condVariableId).toBe("0007");
    expect(p2?.condVariableMin).toBe(5);
    expect(p2?.condSelfSwitch).toBe("B");
    expect(p2?.moveSpeed).toBe(2);
    expect(p2?.condSwitchId).toBeNull();

    // Explicit nulls, never undefined — the wire parser rejects an absent condition field.
    expect(Object.hasOwn(p1 ?? {}, "condVariableId")).toBe(true);
    expect(p2?.condSwitchId === null).toBe(true);
  });

  it("discards the draft on cancel", async () => {
    const user = userEvent.setup();
    const { onCommit, onCancel } = renderDialog(seedEvent());

    await user.type(screen.getByRole("textbox", { name: t("editor.event.name") }), "Throwaway");
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.cancel") }));

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("commits an empty name as the EV{ordinal} string", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent({ ordinal: 5, name: "" }));

    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    expect(onCommit.mock.calls[0]?.[0].name).toBe("EV005");
  });

  it("caps pages at MAX_PAGES_PER_EVENT and disables add there", async () => {
    const user = userEvent.setup();
    renderDialog(seedEvent());

    const add = screen.getByRole("button", { name: t("editor.event.page.add") });
    // From one page, seven adds reach the cap of eight.
    for (let i = 0; i < 7; i += 1) await user.click(add);
    expect(screen.getAllByRole("tab")).toHaveLength(8);
    expect(add).toBeDisabled();
  });

  it("disables delete-page at a single page and removes the selected page otherwise", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent());

    expect(screen.getByRole("button", { name: t("editor.event.page.delete") })).toBeDisabled();

    // Two pages, each tagged by a distinct switch id, then delete page 1 (the mutation-proof: a
    // delete that removed the wrong index would leave 0001 instead of 0002).
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const id1 = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    await user.clear(id1);
    await user.type(id1, "0001");

    await user.click(screen.getByRole("button", { name: t("editor.event.page.add") }));
    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const id2 = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    await user.clear(id2);
    await user.type(id2, "0002");

    // Select page 1 and delete it.
    await user.click(screen.getByRole("tab", { name: t("editor.event.page.aria", { n: 1 }) }));
    await user.click(screen.getByRole("button", { name: t("editor.event.page.delete") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages).toHaveLength(1);
    expect(committed.pages[0]?.condSwitchId).toBe("0002");
  });

  it("normalizes a partial switch id to four digits on blur", () => {
    renderDialog(seedEvent());

    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const switchId = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    fireEvent.change(switchId, { target: { value: "5" } });
    fireEvent.blur(switchId);

    expect(switchId).toHaveValue("0005");
  });

  it("commits a cleared switch id as 0001", () => {
    const { onCommit } = renderDialog(seedEvent());

    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const switchId = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    fireEvent.change(switchId, { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condSwitchId).toBe("0001");
  });

  it("clamps a negative variable-min threshold to zero on blur", () => {
    renderDialog(seedEvent());

    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    const varMin = screen.getByRole("spinbutton", { name: t("editor.event.cond.variable.min") });
    fireEvent.change(varMin, { target: { value: "-3" } });
    fireEvent.blur(varMin);

    expect(varMin).toHaveValue(0);
  });

  it("normalizes an unblurred id when Save is clicked directly (no blur ever fires)", () => {
    const { onCommit } = renderDialog(seedEvent());

    fireEvent.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const switchId = screen.getByRole("textbox", { name: t("editor.event.cond.switch") });
    switchId.focus();
    fireEvent.change(switchId, { target: { value: "5" } });
    // Precondition: the field is still focused, so no blur handler has run yet — `fireEvent.click`
    // (unlike `userEvent.click`) does not simulate the browser's focus-follows-click behaviour, so
    // clicking Save below cannot blur it either. Only save()'s own commit-path normalization can be
    // responsible for the assertion that follows.
    expect(document.activeElement).toBe(switchId);
    fireEvent.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condSwitchId).toBe("0005");
  });

  it("deletes the event through the confirm path", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderDialog(seedEvent());

    await user.click(screen.getByRole("button", { name: t("editor.event.delete") }));
    // The confirm dialog opens; its own destructive button fires onDelete.
    const confirm = screen
      .getByText(t("editor.event.delete.confirm.title"))
      .closest('[data-slot="dialog-content"]');
    if (!(confirm instanceof HTMLElement)) throw new Error("confirm dialog not found");
    await user.click(within(confirm).getByRole("button", { name: t("editor.event.delete") }));

    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

describe("EventDialog condition pickers over the registry", () => {
  const registry = {
    switches: [
      { id: "0001", name: "Porte ouverte" },
      { id: "0002", name: "Pont abaissé" },
    ],
    variables: [{ id: "0007", name: "Or" }],
  };

  beforeEach(() => setLocale("en"));

  it("shows a Select over the registry switches (not free text) once it has entries", async () => {
    const user = userEvent.setup();
    renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    // A combobox appears; the free-text input does NOT.
    const select = screen.getByRole("combobox", { name: t("editor.event.cond.switch") });
    expect(select.tagName).toBe("SELECT");
    expect(
      screen.queryByRole("textbox", { name: t("editor.event.cond.switch") }),
    ).not.toBeInTheDocument();
    // Options render as "0001 · name".
    expect(within(select).getByRole("option", { name: "0001 · Porte ouverte" })).toBeDefined();
    expect(within(select).getByRole("option", { name: "0002 · Pont abaissé" })).toBeDefined();
    // No empty-registry hint.
    expect(screen.queryByText(t("editor.event.cond.empty.hint"))).not.toBeInTheDocument();
  });

  it("falls back to a normalized text input with a hint when the registry is empty", async () => {
    const user = userEvent.setup();
    renderDialog(seedEvent(), { switches: [], variables: [] });

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    expect(screen.getByRole("textbox", { name: t("editor.event.cond.switch") })).toBeDefined();
    expect(
      screen.queryByRole("combobox", { name: t("editor.event.cond.switch") }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(t("editor.event.cond.empty.hint"))).toBeVisible();
  });

  it("writes the picked entry's ID, not its name, into the committed page", async () => {
    // Mutation proof (b): a picker that writes the option's NAME instead of its id fails here —
    // the committed condSwitchId would be "Pont abaissé", never "0002".
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.switch") }));
    const select = screen.getByRole("combobox", { name: t("editor.event.cond.switch") });
    await user.selectOptions(select, "0002");
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condSwitchId).toBe("0002");
  });

  it("seeds the first registry entry when a condition is switched on", async () => {
    const user = userEvent.setup();
    const { onCommit } = renderDialog(seedEvent(), registry);

    await user.click(screen.getByRole("checkbox", { name: t("editor.event.cond.variable") }));
    await user.click(screen.getByRole("button", { name: t("editor.event.save") }));

    const committed = onCommit.mock.calls[0]?.[0] as MapEvent;
    expect(committed.pages[0]?.condVariableId).toBe("0007");
  });
});
