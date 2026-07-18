import type * as React from "react";
import { cn } from "@/lib/utils.js";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/kbd.tsx). No
// base shadcn/ui component to inline — self-contained. Restyled for the Tiny Swords skin: it
// now reads the explicit `--tiny-surface-sunken`/`--tiny-surface-sunken-ink` tokens (from Task 2)
// rather than inheriting shadcn's own tokens. MIT-licensed upstream; Tiny Swords skin modifications.
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pixel-font",
        "inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 p-2 font-sans text-xs select-none pointer-events-none",
        "[background-color:var(--tiny-surface-sunken)] [color:var(--tiny-surface-sunken-ink)]",
        "[&_svg:not([class*='size-'])]:size-3",
        className,
      )}
      {...props}
    />
  );
}

export { Kbd as TinyKbd };
