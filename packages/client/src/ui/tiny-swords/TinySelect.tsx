import { cn } from "@alepha/ui/lib/utils";
import type * as React from "react";

export function TinySelect({ className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("tiny-select", className)} {...props} />;
}
