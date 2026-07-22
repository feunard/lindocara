import { cn } from "@lindocara/ui/lib/utils.js";
import * as React from "react";

/** Accessible native select with the same Tiny Swords surface treatment as PixelAct inputs. */
export interface TinyFieldSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  className?: string;
}

const Select = React.forwardRef<HTMLSelectElement, TinyFieldSelectProps>(
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

export { Select as TinyFieldSelect };
