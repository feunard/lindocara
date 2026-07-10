import { Label as LabelPrimitive } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.js";
import "./styles/styles.css";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/label.tsx),
// with its base shadcn/ui Label inlined. Not a Task 2 restyle touchpoint — untouched from
// upstream, "inherits tokens". MIT-licensed upstream; modifications for lindocara's garrison skin.
export interface LabelProps extends React.ComponentProps<typeof LabelPrimitive.Root> {}

function Label({ className, ...props }: LabelProps) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        "pixel-font mb-2 flex items-center gap-2 text-sm leading-none font-medium text-foreground select-none",
        "group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50",
        "peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
