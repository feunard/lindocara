import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import type * as React from "react";
import { cn } from "@/lib/utils.js";

// Vendored from github.com/pixelact-ui/pixelact-ui (components/ui/pixelact-ui/button/), with
// its base shadcn/ui Button inlined — no separate @/components/ui/button layer — and
// restyled to the garrison skin (Task 2, step 4): the pixel box-shadow border technique from
// upstream's button.css is deleted (it fights border-image) and replaced by `btn-frame`
// (src/client/styles/theme.css), a 9-slice border-image button frame. Size variants are kept
// verbatim; color variants lose their box-shadow classes and inherit the single garrison
// bronze treatment, except `link`, which drops the frame entirely. MIT-licensed upstream; modifications for lindocara's garrison skin.
const pixelButtonVariants = cva(
  "btn-frame w-fit cursor-pointer items-center justify-center whitespace-nowrap text-sm transition-colors duration-100 disabled:cursor-not-allowed",
  {
    variants: {
      variant: {
        default: "",
        secondary: "",
        warning: "",
        success: "",
        destructive: "",
        link: "h-auto border-none bg-transparent p-0 text-current underline underline-offset-4",
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

export interface ButtonProps
  extends React.ComponentProps<"button">,
    VariantProps<typeof pixelButtonVariants> {
  asChild?: boolean;
}

function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";

  return (
    <Comp
      data-slot="button"
      className={cn(pixelButtonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, pixelButtonVariants };
