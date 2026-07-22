import { cn } from "@lindocara/ui/lib/utils.js";
import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/label.tsx),
// with its base shadcn/ui Label inlined. Restyled for the Tiny Swords skin: it now reads the
// explicit `--tiny-surface-ink` token from tokens.css rather than inheriting shadcn's own tokens.
// MIT-licensed upstream; modifications for lindocara's Tiny Swords skin.
export interface TinyLabelProps extends React.ComponentProps<typeof LabelPrimitive.Root> {}

function Label({ className, ...props }: TinyLabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "pixel-font mb-2 flex items-center gap-2 text-sm leading-none font-medium select-none",
        "[color:var(--tiny-surface-ink)]",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label as TinyLabel };
