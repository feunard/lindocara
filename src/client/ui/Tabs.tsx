import { cn } from "@/lib/utils.js";

interface TabsProps {
  tabs: ReadonlyArray<{ id: string; label: string }>;
  active: string;
  onSelect(id: string): void;
}

export function Tabs({ tabs, active, onSelect }: TabsProps) {
  return (
    <div className="flex gap-2" role="tablist">
      {tabs.map((tab) => {
        const className = cn(
          "btn-frame flex-1 py-2 opacity-60",
          tab.id === active && "opacity-100 font-bold",
        );
        const onClick = () => onSelect(tab.id);
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === active}
            className={className}
            onClick={onClick}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
