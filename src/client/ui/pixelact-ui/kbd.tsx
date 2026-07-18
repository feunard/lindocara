import type * as React from "react";
import { cn } from "@/lib/utils.js";
import "./styles/styles.css";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/kbd.tsx). No
// base shadcn/ui component to inline — self-contained. Not a Task 2 restyle touchpoint —
// untouched from upstream, "inherits tokens". MIT-licensed upstream; Tiny Swords skin modifications.
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

function KbdGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <kbd
      data-slot="kbd-group"
      className={cn("inline-flex items-center gap-1", className)}
      {...props}
    />
  );
}

export { Kbd, KbdGroup };
