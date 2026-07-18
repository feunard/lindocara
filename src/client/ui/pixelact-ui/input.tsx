import * as React from "react";
import { cn } from "@/lib/utils.js";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/input.tsx).
// PixelAct's structure is kept as-is; only the two touchpoints called out in the Task 2
// brief change: the "Press Start 2P" pixel font becomes `--font-ui`, and the hard-edged
// pixel box-shadow border becomes a 2px solid border derived from `--parchment-ink`, for use
// on parchment surfaces. MIT-licensed upstream; modifications for lindocara's Tiny Swords skin.
export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  disabled?: boolean;
  className?: string;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, disabled, ...props }, ref) => {
    return (
      <input
        className={cn(
          "max-w-full p-2 outline-none placeholder:text-sm md:placeholder:text-base",
          "[background-color:var(--tiny-surface)] [color:var(--tiny-surface-ink)]",
          "[font-family:var(--font-ui)]",
          "border-2 border-solid [border-color:color-mix(in_srgb,var(--parchment-ink)_55%,transparent)]",
          "disabled:opacity-40",
          disabled && "disabled:cursor-not-allowed disabled:opacity-40",
          className,
        )}
        disabled={disabled}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
