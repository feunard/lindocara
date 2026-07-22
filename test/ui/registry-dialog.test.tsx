import type { AdventureDraft, DraftMemberInfo } from "@lindocara/client/adventure-draft.js";
import { setLocale, t } from "@lindocara/client/i18n.js";
import { useUiStore } from "@lindocara/client/store.js";
import { RegistryDialog } from "@lindocara/editor/ui/editor/RegistryDialog.js";
import type { AdventureRegistry } from "@lindocara/engine/adventure-state.js";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const noop = () => {};

function member(mapId: string, name: string, entryId: string, exitId: string): DraftMemberInfo {
  return {
    mapId,
    name,
    revision: 1,
    solid: ["."],
    monsterCount: 0,
    entryIds: [entryId],
    exitIds: [exitId],
    entryLabels: {},
    exitLabels: {},
  };
}

/** A complete draft so Save is enabled (its `toAdventureInput` is non-null). */
function completeDraft(registry: AdventureRegistry): AdventureDraft {
  return {
    title: "Donjon",
    maxPlayers: 4,
    members: [member("m1", "Verdant", "door", "east")],
    registry,
  };
}

function seedSession(draft: AdventureDraft, adventureId: string | null): void {
  useUiStore.setState({
    adventureEditorSession: {
      adventureId,
      draftId: "draft-1",
      draft,
      invalidatedLinks: [],
      savedDraft: JSON.stringify(draft),
    },
  });
}

/** Captures every PUT body the dialog sends. */
function backend() {
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const one = url.match(/^\/api\/adventures\/([A-Za-z0-9-]+)$/);
    if (one?.[1] && method === "PUT") {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return Promise.resolve(
        new Response(JSON.stringify({ ...body, id: one[1], accountId: "acct", version: 2 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
}

describe("RegistryDialog", () => {
  beforeEach(() => {
    setLocale("en");
    useUiStore.setState({ adventureEditorSession: null });
  });

  it("mints, renames and deletes, then persists the exact registry through the adventure PUT", async () => {
    const user = userEvent.setup();
    seedSession(completeDraft({ switches: [], variables: [] }), "adv-1");
    const mock = backend();
    vi.stubGlobal("fetch", mock);
    render(<RegistryDialog open onOpenChange={noop} onSessionExpired={noop} />);

    const switches = screen.getByRole("region", { name: t("editor.registry.switches") });
    // Add mints 0001, then 0002 — monotone.
    await user.click(within(switches).getByRole("button", { name: /Add Switches/ }));
    await user.click(within(switches).getByRole("button", { name: /Add Switches/ }));
    expect(within(switches).getByLabelText(`${t("editor.registry.name.aria")} 0001`)).toBeDefined();
    expect(within(switches).getByLabelText(`${t("editor.registry.name.aria")} 0002`)).toBeDefined();

    // Rename 0001 in place.
    await user.type(
      within(switches).getByLabelText(`${t("editor.registry.name.aria")} 0001`),
      "Porte",
    );

    // Delete 0002 behind the confirm.
    await user.click(
      within(switches).getByRole("button", { name: `${t("editor.registry.delete")} 0002` }),
    );
    expect(
      screen.getByText(t("editor.registry.delete.confirm.title", { id: "0002", name: "" })),
    ).toBeVisible();
    // The fail-closed wording is present in the confirm body.
    expect(screen.getByText(t("editor.registry.delete.confirm.body"))).toBeVisible();
    const confirm = screen
      .getByText(t("editor.registry.delete.confirm.body"))
      .closest('[data-slot="dialog-content"]');
    if (!(confirm instanceof HTMLElement)) throw new Error("confirm dialog not found");
    await user.click(within(confirm).getByRole("button", { name: t("editor.registry.delete") }));

    // Add a variable too.
    const variables = screen.getByRole("region", { name: t("editor.registry.variables") });
    await user.click(within(variables).getByRole("button", { name: /Add Variables/ }));

    await user.click(screen.getByRole("button", { name: t("editor.registry.save") }));

    await waitFor(() => {
      const put = mock.mock.calls.find(
        ([url, init]) => url === "/api/adventures/adv-1" && (init as RequestInit)?.method === "PUT",
      );
      expect(put).toBeDefined();
      const body = JSON.parse(String((put?.[1] as RequestInit)?.body)) as {
        registry: AdventureRegistry;
      };
      // 0002 deleted, 0001 renamed, one variable minted at 0001 (variables are their own namespace).
      expect(body.registry).toEqual({
        switches: [{ id: "0001", name: "Porte" }],
        variables: [{ id: "0001", name: "" }],
      });
    });
  });

  it("lists the account's adventures when no session is loaded", async () => {
    const mock = vi.fn((url: string) => {
      if (url === "/api/adventures") {
        return Promise.resolve(
          new Response(JSON.stringify([{ id: "adv-9", title: "Ruines", maxPlayers: 2 }]), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }
      return Promise.resolve(new Response(null, { status: 404 }));
    });
    vi.stubGlobal("fetch", mock);
    render(<RegistryDialog open onOpenChange={noop} onSessionExpired={noop} />);

    expect(await screen.findByText("Ruines")).toBeVisible();
    expect(screen.getByText(t("editor.registry.pick"))).toBeVisible();
  });
});
