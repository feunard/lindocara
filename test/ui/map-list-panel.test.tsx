import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPayload, MapSummary } from "../../src/client/api.js";
import { setLocale, t } from "../../src/client/i18n.js";
import { MapListPanel } from "../../src/client/ui/editor/MapListPanel.js";
import { EMPTY_MARKERS } from "../../src/shared/map-data.js";
import { layersFromBlocks } from "../../src/shared/map-migrate.js";
import { encodeTileLayer } from "../../src/shared/tile-layer-codec.js";
import { TINY_SWORDS_TILESET_ID } from "../../src/shared/tilesets/tiny-swords.js";

const OPEN_LAYERS = layersFromBlocks(Array.from({ length: 30 }, () => ".".repeat(40))).layers.map(
  encodeTileLayer,
);

const twoMaps: MapSummary[] = [
  { id: "m1", name: "Verdant Reach", revision: 1, cols: 40, rows: 30, isFirst: true },
  { id: "m2", name: "Frostfen", revision: 1, cols: 48, rows: 32, isFirst: false },
];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function payloadFor(summary: MapSummary): MapPayload {
  return {
    id: summary.id,
    name: summary.name,
    revision: summary.revision,
    tilesetId: TINY_SWORDS_TILESET_ID,
    cols: summary.cols,
    rows: summary.rows,
    layers: OPEN_LAYERS,
    elements: [],
    spawn: { col: 20, row: 15 },
    markers: EMPTY_MARKERS,
    events: [],
  };
}

/** A tiny /api/maps* backend consistent across list/create/delete calls. */
function mapsBackend(maps: MapSummary[] = twoMaps) {
  const list = maps.map((m) => ({ ...m }));
  return vi.fn((url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.startsWith("/api/maps?adventure=") && method === "GET")
      return Promise.resolve(jsonResponse(list));
    if (url === "/api/maps" && method === "POST") {
      const created: MapPayload = {
        id: "new",
        name: "New map",
        revision: 1,
        tilesetId: TINY_SWORDS_TILESET_ID,
        cols: 40,
        rows: 30,
        layers: OPEN_LAYERS,
        elements: [],
        spawn: { col: 20, row: 15 },
        markers: EMPTY_MARKERS,
        events: [],
      };
      list.push({ id: "new", name: "New map", revision: 1, cols: 40, rows: 30, isFirst: false });
      return Promise.resolve(jsonResponse(created, 201));
    }
    const idMatch = url.match(/^\/api\/maps\/([^/]+)$/);
    if (idMatch?.[1]) {
      const summary = list.find((m) => m.id === idMatch[1]);
      if (method === "GET") {
        if (!summary) return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
        return Promise.resolve(jsonResponse(payloadFor(summary)));
      }
      if (method === "DELETE") {
        const index = list.findIndex((m) => m.id === idMatch[1]);
        if (index >= 0) list.splice(index, 1);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
    }
    return Promise.resolve(jsonResponse({ error: "map_not_found" }, 404));
  });
}

/** Holds the two dialog-open props the screen owns so the panel can drive them in isolation. */
function Harness(overrides: {
  adventureId?: string | null;
  activeMapId?: string | null;
  startMapId?: string | null;
  startableMapIds?: ReadonlySet<string>;
  dirty?: boolean;
  onOpenPayload?: (payload: MapPayload) => void;
  onSetStart?: (mapId: string) => void;
  onSessionExpired?: () => void;
}) {
  const [newMapOpen, setNewMapOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  return (
    <MapListPanel
      adventureId={overrides.adventureId ?? "adv-1"}
      activeMapId={overrides.activeMapId ?? null}
      startMapId={overrides.startMapId ?? null}
      startableMapIds={overrides.startableMapIds ?? new Set(["m1", "m2"])}
      dirty={overrides.dirty ?? false}
      refreshNonce={0}
      newMapOpen={newMapOpen}
      onNewMapOpenChange={setNewMapOpen}
      confirmDeleteId={confirmDeleteId}
      onConfirmDeleteIdChange={setConfirmDeleteId}
      onRequestOpen={() => {}}
      onOpenPayload={overrides.onOpenPayload ?? (() => {})}
      onActiveDeleted={() => {}}
      onSetStart={overrides.onSetStart ?? (() => {})}
      onOpenSettings={() => {}}
      onError={() => {}}
      onSessionExpired={overrides.onSessionExpired ?? (() => {})}
    />
  );
}

describe("MapListPanel", () => {
  beforeEach(() => {
    setLocale("en");
  });

  it("lists the author's maps with a dimensions badge", async () => {
    vi.stubGlobal("fetch", mapsBackend());
    render(<Harness />);

    expect(await screen.findByRole("button", { name: "Verdant Reach" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Frostfen" })).toBeInTheDocument();
    expect(screen.getByText("40×30")).toBeInTheDocument();
    expect(screen.getByText("48×32")).toBeInTheDocument();
  });

  it("disables the start star on a map with no entry, with a hint (UX wave #6 review fix)", async () => {
    vi.stubGlobal("fetch", mapsBackend());
    const onSetStart = vi.fn();
    // Only m1 has an entry to point the graph start at; m2 has none.
    render(<Harness startableMapIds={new Set(["m1"])} onSetStart={onSetStart} />);
    await screen.findByRole("button", { name: "Frostfen" });

    const stars = screen.getAllByRole("button", { name: t("editor.shell.maps.start") });
    expect(stars[0]).toBeEnabled();
    expect(stars[1]).toBeDisabled();
    expect(stars[1]).toHaveAttribute("title", t("editor.shell.maps.start.noEntry"));

    // The disabled star raises nothing; the enabled one sets the start (no misleading error path).
    await userEvent.click(stars[1] as HTMLElement);
    expect(onSetStart).not.toHaveBeenCalled();
    await userEvent.click(stars[0] as HTMLElement);
    expect(onSetStart).toHaveBeenCalledWith("m1");
  });

  it("asks for confirmation before deleting, then refreshes the list", async () => {
    const mock = mapsBackend();
    vi.stubGlobal("fetch", mock);
    render(<Harness />);
    await screen.findByRole("button", { name: "Frostfen" });

    await userEvent.click(screen.getByRole("button", { name: `${t("editor.delete")} Frostfen` }));
    expect(mock).not.toHaveBeenCalledWith(
      "/api/maps/m2",
      expect.objectContaining({ method: "DELETE" }),
    );
    expect(screen.getByText(t("editor.delete.title", { name: "Frostfen" }))).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: t("editor.delete.confirm") }));
    expect(mock).toHaveBeenCalledWith(
      "/api/maps/m2",
      expect.objectContaining({ method: "DELETE" }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Frostfen" })).not.toBeInTheDocument(),
    );
  });

  it("guards unsaved stage edits when renaming the open map: cancel makes no refetch or remount", async () => {
    const mock = mapsBackend();
    vi.stubGlobal("fetch", mock);
    const onOpenPayload = vi.fn();
    render(<Harness activeMapId="m1" dirty onOpenPayload={onOpenPayload} />);
    await screen.findByRole("button", { name: "Verdant Reach" });

    await userEvent.click(
      screen.getByRole("button", { name: `${t("editor.shell.maps.rename")} Verdant Reach` }),
    );
    await userEvent.type(screen.getByLabelText(t("editor.name")), " Renamed");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));

    expect(confirm).toHaveBeenCalledWith(t("editor.shell.exit.confirm"));
    // Cancelled: the open map was neither refetched (remount) nor written.
    expect(mock).not.toHaveBeenCalledWith(
      "/api/maps/m1",
      expect.objectContaining({ method: "PUT" }),
    );
    expect(onOpenPayload).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("redirects to the auth screen when the session has expired", async () => {
    const onSessionExpired = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "session_expired" }, 401)),
    );
    render(<Harness onSessionExpired={onSessionExpired} />);

    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
  });
});
