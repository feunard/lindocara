import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.js";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/badge.tsx),
// with its base shadcn/ui Badge inlined. Not a Task 2 restyle touchpoint — untouched from
// upstream, "inherits tokens".
const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-none border-none px-2 py-0.5 text-xs font-medium whitespace-nowrap shadow-(--pixel-box-shadow) box-shadow-margin transition-[color,box-shadow] focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      font: {
        normal: "",
        pixel: "pixel-font",
      },
      variant: {
        default: "bg-primary text-primary-foreground",
        secondary: "bg-secondary text-secondary-foreground",
        destructive: "bg-destructive text-white",
        outline: "bg-background text-foreground",
      },
    },
    defaultVariants: {
      font: "pixel",
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.ComponentProps<"span">,
    VariantProps<typeof badgeVariants> {
  asChild?: boolean;
}

function Badge({ className, font, variant, asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";

  return (
    <div className="relative inline-flex">
      <Comp
        data-slot="badge"
        className={cn(badgeVariants({ variant, font }), className)}
        {...props}
      />
    </div>
  );
}

export { Badge, badgeVariants };
