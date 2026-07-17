import type * as React from "react";
import { cn } from "@/lib/utils.js";

export function TinyBanner({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("tiny-banner", className)} {...props} />;
}
