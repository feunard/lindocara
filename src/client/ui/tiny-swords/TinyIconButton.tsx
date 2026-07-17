import { cn } from "@/lib/utils.js";
import { Button, type ButtonProps } from "../pixelact-ui/button/index.js";

export function TinyIconButton({ className, ...props }: ButtonProps) {
  return <Button size="sm" className={cn("tiny-icon-button", className)} {...props} />;
}
