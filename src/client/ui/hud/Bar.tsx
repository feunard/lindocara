import { cn } from "@/lib/utils.js";

const FILLS: Record<"hp" | "xp" | "quest" | "mana", string> = {
  hp: "bg-gradient-to-b from-[#f0796b] to-[#bd494e]",
  xp: "bg-gradient-to-b from-[#f0d060] to-[#b89a30]",
  quest: "bg-gradient-to-b from-[#7fb069] to-[#557d43]",
  mana: "bg-gradient-to-b from-[#68c6f0] to-[#3268bd]",
};

export function Bar({
  value,
  max,
  variant = "hp",
}: {
  value: number;
  max: number;
  variant?: keyof typeof FILLS;
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      className="h-3 w-full border-2 border-black/70 bg-black/50"
    >
      <div
        data-fill
        className={cn("h-full", FILLS[variant])}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  );
}
