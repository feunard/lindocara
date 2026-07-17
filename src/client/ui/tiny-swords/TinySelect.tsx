import type * as React from "react";
import { cn } from "@/lib/utils.js";

export function TinySelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("tiny-select", className)} {...props} />;
}
