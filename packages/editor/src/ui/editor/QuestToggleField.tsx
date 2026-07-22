import { Checkbox } from "@lindocara/ui/components/checkbox.js";
import { useId } from "react";

interface QuestToggleFieldProps {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange(checked: boolean): void;
}

export function QuestToggleField({ label, checked, disabled, onChange }: QuestToggleFieldProps) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-xs text-foreground">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(next === true)}
      />
      <span>{label}</span>
    </label>
  );
}
