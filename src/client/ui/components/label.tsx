import type * as React from "react";

import { cn } from "@/lib/utils";

// Deviation from stock shadcn output (task-4-brief Step 9): this is a generic passthrough
// component, and Biome's a11y rule cannot see that call sites supply `htmlFor`/nest an input.
// Added a biome-ignore rather than an unconditional `for` attribute the component doesn't own.
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: generic passthrough; callers supply htmlFor/children.
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
