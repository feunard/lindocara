import type * as React from "react";
import { cn } from "@/lib/utils.js";

export function TinyRange({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input type="range" className={cn("tiny-range", className)} {...props} />;
}
