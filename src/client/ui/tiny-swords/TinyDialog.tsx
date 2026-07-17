import type * as React from "react";
import { cn } from "@/lib/utils.js";

export function TinyDialog({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("tiny-dialog tiny-panel framed", className)} {...props} />;
}
