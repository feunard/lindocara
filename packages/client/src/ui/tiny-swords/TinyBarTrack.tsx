import { cn } from "@lindocara/ui/lib/utils.js";
import type * as React from "react";

export function TinyBarTrack({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      aria-hidden="true"
      data-tiny-bar-track="ui.bar.small.base"
      className={cn("tiny-bar-track", className)}
      {...props}
    >
      <span className="tiny-bar-track__cap tiny-bar-track__cap--start" />
      <span className="tiny-bar-track__middle" />
      <span className="tiny-bar-track__cap tiny-bar-track__cap--end" />
    </span>
  );
}
