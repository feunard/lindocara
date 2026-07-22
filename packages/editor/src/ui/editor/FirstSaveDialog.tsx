import { t, useLocale } from "@lindocara/client/i18n.js";
import { ADVENTURE_TITLE_MAX } from "@lindocara/engine/adventure.js";
import { Button } from "@lindocara/ui/components/button.js";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@lindocara/ui/components/dialog.js";
import { Input } from "@lindocara/ui/components/input.js";
import { Label } from "@lindocara/ui/components/label.js";
import { useState } from "react";

interface FirstSaveDialogProps {
  open: boolean;
  /** The default title the adventure was born with, prefilled and selected for a quick rename. */
  defaultTitle: string;
  /** Confirm: persist this title, then continue the pending map save. */
  onConfirm(title: string): void;
  /** Cancel: abort the whole save — nothing is written, and the author stays in the editor. */
  onCancel(): void;
}

/**
 * UX wave #14: the name popup shown at an adventure's very first save. Creating an adventure no longer
 * asks for a name — it is born with the localized default and drops the author straight into the
 * editor — so the first explicit save (⌘S or the menu) is where the real name is confirmed. Confirm
 * sends the title with the map in one atomic authoring request; Cancel writes nothing at all. Stock
 * shadcn: this is a creator surface, so the two-tree rule keeps Tiny Swords out.
 */
export function FirstSaveDialog({ open, defaultTitle, onConfirm, onCancel }: FirstSaveDialogProps) {
  useLocale();
  const [title, setTitle] = useState(defaultTitle);
  const trimmed = title.trim();

  function confirm(): void {
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
    >
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            confirm();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("editor.firstSave.title")}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{t("editor.firstSave.hint")}</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="first-save-title">{t("adventure.name")}</Label>
          <Input
            id="first-save-title"
            type="text"
            maxLength={ADVENTURE_TITLE_MAX}
            value={title}
            onChange={(event) => setTitle(event.currentTarget.value)}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t("editor.firstSave.cancel")}
          </Button>
          <Button disabled={trimmed.length === 0} onClick={confirm}>
            {t("editor.firstSave.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
