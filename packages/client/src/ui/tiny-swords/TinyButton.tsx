import { TINY_SWORDS_UI } from "@lindocara/engine/tiny-swords-catalog.js";
import { cn } from "@lindocara/ui/lib/utils.js";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";

// Accessible PixelAct/shadcn structure, skinned by Tiny Swords' authored 3-slice states. The data
// attributes expose the stable semantic ids to tests and developer tools.
const pixelButtonVariants = cva(
  "tiny-button inline-flex w-fit items-center justify-center whitespace-nowrap text-sm disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: "",
        secondary: "",
        warning: "",
        success: "",
        destructive: "",
        link: "tiny-button--link h-auto border-none bg-transparent p-0 text-current underline underline-offset-4",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3 text-xs",
        lg: "h-11 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface TinyButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof pixelButtonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: TinyButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  const family = variant === "destructive" || variant === "warning" ? "red" : "blue";
  const assets = TINY_SWORDS_UI.button[family];

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      data-tiny-normal={assets.normal.id}
      data-tiny-hover={assets.hover.id}
      data-tiny-pressed={assets.pressed.id}
      data-tiny-disabled={assets.disabled.id}
      className={cn(pixelButtonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button as TinyButton, pixelButtonVariants as tinyButtonVariants };
