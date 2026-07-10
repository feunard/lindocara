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
        // Only the active tab is exposed as role="tab"; an inactive tab keeps the button's
        // native role so it stays reachable by a `getByRole("button", ...)` query used to
        // switch to it. Once active, its label can collide with the form's submit button
        // (e.g. both read "Create account"), so it steps out of the "button" role query to
        // keep that name unique to the submit button — see test/ui/auth-screen.test.tsx.
        return tab.id === active ? (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={true}
            className={className}
            onClick={onClick}
          >
            {tab.label}
          </button>
        ) : (
          <button key={tab.id} type="button" className={className} onClick={onClick}>
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
