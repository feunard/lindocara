import type { PortraitArt } from "../../store.js";

export function UnitPortrait({ portrait }: { portrait: PortraitArt }) {
  return (
    <div className="unit-portrait unit-portrait--self" data-portrait-kind="unit" aria-hidden="true">
      <span
        style={{
          backgroundImage: `url("${portrait.source}")`,
          backgroundSize: `${portrait.frames * 100}% 100%`,
        }}
      />
    </div>
  );
}
