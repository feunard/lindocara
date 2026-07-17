import type * as React from "react";
import { cn } from "@/lib/utils.js";

export function TinyTooltip({ className, ...props }: React.ComponentProps<"span">) {
  return <span role="tooltip" className={cn("tiny-tooltip framed", className)} {...props} />;
}
