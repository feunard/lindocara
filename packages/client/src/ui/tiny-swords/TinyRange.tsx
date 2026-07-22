import { cn } from "@lindocara/ui/lib/utils.js";
import type * as React from "react";
import { TinyBarTrack } from "./TinyBarTrack.js";

export function TinyRange({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="tiny-range-shell">
      <TinyBarTrack className="tiny-range-track" />
      <input type="range" className={cn("tiny-range", className)} {...props} />
    </span>
  );
}
