import { Input } from "@lindocara/ui/components/input.js";
import type { ComponentProps } from "react";
import { useEffect, useState } from "react";

interface QuestNumberInputProps
  extends Omit<ComponentProps<typeof Input>, "type" | "value" | "onChange"> {
  value: number | null;
  min?: number;
  max?: number;
  allowEmpty?: boolean;
  onValueChange(value: number | null): void;
}

/** Number inputs need a transient text draft: immediately replacing an empty field with its old
 * minimum turns the common “clear, then type 10” gesture into 110. */
export function QuestNumberInput({
  value,
  min,
  max,
  allowEmpty = false,
  onValueChange,
  onBlur,
  ...props
}: QuestNumberInputProps) {
  const [draft, setDraft] = useState(value === null ? "" : String(value));

  useEffect(() => {
    setDraft(value === null ? "" : String(value));
  }, [value]);

  function bounded(raw: string): number | null {
    if (raw.trim() === "") return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return Math.max(
      min ?? Number.MIN_SAFE_INTEGER,
      Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.trunc(parsed)),
    );
  }

  return (
    <Input
      {...props}
      type="number"
      min={min}
      max={max}
      value={draft}
      onChange={(event) => {
        const raw = event.currentTarget.value;
        setDraft(raw);
        const next = bounded(raw);
        if (next !== null) onValueChange(next);
        else if (allowEmpty && raw === "") onValueChange(null);
      }}
      onBlur={(event) => {
        const next = bounded(event.currentTarget.value);
        if (next === null) {
          if (allowEmpty) {
            setDraft("");
            onValueChange(null);
          } else {
            setDraft(value === null ? "" : String(value));
          }
        } else {
          setDraft(String(next));
          onValueChange(next);
        }
        onBlur?.(event);
      }}
    />
  );
}
