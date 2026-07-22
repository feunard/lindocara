import { Label } from "@lindocara/ui/components/label.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@lindocara/ui/components/select.js";
import { useId } from "react";

export interface QuestChoiceOption {
  readonly value: string;
  readonly label: string;
  readonly disabled?: boolean;
}

interface QuestChoiceFieldProps {
  label: string;
  value: string;
  options: readonly QuestChoiceOption[];
  disabled?: boolean;
  onChange(value: string): void;
}

export function QuestChoiceField({
  label,
  value,
  options,
  disabled,
  onChange,
}: QuestChoiceFieldProps) {
  const id = useId();
  const selectedLabel = options.find((option) => option.value === value)?.label ?? value;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select
        value={value}
        disabled={disabled}
        onValueChange={(next) => {
          if (typeof next === "string") onChange(next);
        }}
      >
        <SelectTrigger id={id} className="w-full">
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
