import { cn } from "@alepha/ui/lib/utils";
import type * as React from "react";

export function TinyPanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-text-surface="information"
      className={cn("tiny-panel framed", className)}
      {...props}
    />
  );
}
