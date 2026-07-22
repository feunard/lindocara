import { cn } from "@lindocara/ui/lib/utils.js";
import { TinyButton, type TinyButtonProps } from "./TinyButton.js";

export function TinyIconButton({ className, ...props }: TinyButtonProps) {
  return <TinyButton size="sm" className={cn("tiny-icon-button", className)} {...props} />;
}
