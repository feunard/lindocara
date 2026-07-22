import { cn } from "@lindocara/ui/lib/utils.js";
import type * as React from "react";

export function TinySelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("tiny-select", className)} {...props} />;
}
