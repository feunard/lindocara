import { t } from "@lindocara/client/i18n.js";
import { MapAudioDialog } from "@lindocara/editor/ui/editor/MapAudioDialog.js";
import { EMPTY_MAP_AUDIO } from "@lindocara/engine/audio-catalog.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Harness({ onSave }: { onSave: () => Promise<boolean> }) {
  const [open, setOpen] = useState(true);
  return (
    <MapAudioDialog
      open={open}
      mapName="Map 1"
      initial={EMPTY_MAP_AUDIO}
      onOpenChange={setOpen}
      onSave={onSave}
    />
  );
}

describe("MapAudioDialog", () => {
  it("stays mounted during persistence and closes only after a successful save", async () => {
    let finish: ((saved: boolean) => void) | undefined;
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness onSave={onSave} />);

    const save = screen.getByRole("button", { name: t("editor.save") });
    await userEvent.click(save);
    expect(onSave).toHaveBeenCalledOnce();
    expect(save).toBeDisabled();
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    finish?.(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("remains closable when persistence fails", async () => {
    render(<Harness onSave={() => Promise.resolve(false)} />);

    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: t("adventure.delete.cancel") }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});
