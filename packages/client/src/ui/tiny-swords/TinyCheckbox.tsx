import { cn } from "@lindocara/ui/lib/utils.js";
import type * as React from "react";

interface TinyCheckboxProps extends React.InputHTMLAttributes<HTMLInputElement> {
  children: React.ReactNode;
}

export function TinyCheckbox({ children, className, ...props }: TinyCheckboxProps) {
  return (
    <label className={cn("tiny-checkbox", className)}>
      <input type="checkbox" {...props} />
      <span className="tiny-checkbox__art" aria-hidden="true" />
      <span>{children}</span>
    </label>
  );
}
