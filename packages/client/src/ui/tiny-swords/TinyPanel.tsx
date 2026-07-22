import { cn } from "@lindocara/ui/lib/utils.js";
import type * as React from "react";

export function TinyPanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-tiny-panel="ui.panel.carved"
      data-tiny-slice="64 64 64 64"
      className={cn("tiny-panel framed", className)}
      {...props}
    />
  );
}
