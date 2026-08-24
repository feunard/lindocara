import { t } from "@lindocara/client/i18n.js";
import { MapAudioDialog } from "@lindocara/editor/ui/editor/MapAudioDialog.js";
import {
  EMPTY_MAP_AUDIO,
  type MapAudioConfig,
  type UploadedMusicTrack,
  uploadedMusicTrack,
} from "@lindocara/engine/audio-catalog.js";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

interface HarnessProps {
  onSave(audio: MapAudioConfig): Promise<boolean>;
  listSounds?(): Promise<UploadedMusicTrack[]>;
  uploadSound?(file: File): Promise<UploadedMusicTrack>;
}

function Harness({ onSave, listSounds = () => Promise.resolve([]), uploadSound }: HarnessProps) {
  const [open, setOpen] = useState(true);
  return (
    <MapAudioDialog
      open={open}
      mapName="Map 1"
      initial={EMPTY_MAP_AUDIO}
      onOpenChange={setOpen}
      onSave={onSave}
      listSounds={listSounds}
      {...(uploadSound ? { uploadSound } : {})}
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

  it("uploads a reusable sound and selects it for the current map before saving", async () => {
    const uploaded = uploadedMusicTrack(
      "0198d55c-5b67-7000-8000-000000000001~0198d55c-5b67-7000-8000-000000000002~Q291cnNlIGR1IHRvaXQ.ogg",
      "Course du toit",
      "Mira",
    );
    if (!uploaded) throw new Error("invalid uploaded sound fixture");
    const uploadSound = vi.fn(() => Promise.resolve(uploaded));
    const onSave = vi.fn(() => Promise.resolve(true));
    render(<Harness onSave={onSave} uploadSound={uploadSound} />);

    const file = new File([new Uint8Array([79, 103, 103, 83])], "Course du toit.ogg", {
      type: "audio/ogg",
    });
    await userEvent.upload(screen.getByLabelText(t("editor.audio.uploadButton")), file);
    await waitFor(() => expect(uploadSound).toHaveBeenCalledWith(file));

    await userEvent.click(screen.getByRole("button", { name: t("editor.save") }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ music: uploaded.id }));
  });
});
