import { MapInteriorShellDialog } from "@lindocara/editor/ui/editor/MapInteriorShellDialog.js";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

function Harness({
  canMakeInterior = true,
  onSave,
}: {
  canMakeInterior?: boolean;
  onSave: Parameters<typeof MapInteriorShellDialog>[0]["onSave"];
}) {
  const [open, setOpen] = useState(true);
  return (
    <MapInteriorShellDialog
      open={open}
      mapName="Grotte"
      environment="exterior"
      canMakeInterior={canMakeInterior}
      onOpenChange={setOpen}
      onSave={onSave}
    />
  );
}

describe("MapInteriorShellDialog", () => {
  it("saves a selected existing-asset style as an interior", async () => {
    const onSave = vi.fn(async () => true);
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByRole("radio", { name: "Volcano" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("interior", { style: "volcano" }));
  });

  it("lets the author keep perimeter walls full while opening painted inner walls", async () => {
    const onSave = vi.fn(async () => true);
    render(<Harness onSave={onSave} />);
    fireEvent.click(screen.getByRole("radio", { name: "Volcano" }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Open perimeter walls/ }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith("interior", {
        style: "volcano",
        openOuterWalls: false,
      }),
    );
  });

  it("keeps interior choices disabled on the adventure start map", () => {
    render(<Harness canMakeInterior={false} onSave={async () => true} />);
    expect(screen.getByRole("radio", { name: "Cave" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("start map must remain exterior");
  });
});
