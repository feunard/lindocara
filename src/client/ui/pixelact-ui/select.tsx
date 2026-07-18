import * as React from "react";
import { cn } from "@/lib/utils.js";

/** Accessible native select with the same Tiny Swords surface treatment as PixelAct inputs. */
export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

const Select = React.forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, disabled, children, ...props }, ref) => (
    <select
      ref={ref}
      disabled={disabled}
      className={cn(
        "max-w-full p-2 outline-none",
        "[background-color:var(--tiny-surface)] [color:var(--tiny-surface-ink)]",
        "[font-family:var(--font-ui)]",
        "border-2 border-solid [border-color:color-mix(in_srgb,var(--parchment-ink)_55%,transparent)]",
        "focus-visible:ring-2 focus-visible:ring-[var(--gold)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = "Select";

export { Select };
