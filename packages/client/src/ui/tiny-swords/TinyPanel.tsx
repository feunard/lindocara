import type * as React from "react";
import { cn } from "@/lib/utils.js";

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
