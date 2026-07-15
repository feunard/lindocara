import type { PortraitArt } from "../../store.js";

export function UnitPortrait({
  portrait,
  size = "target",
}: {
  portrait: PortraitArt;
  size?: "self" | "target";
}) {
  return (
    <div
      className={`unit-portrait unit-portrait--${size} unit-portrait--${portrait.kind}`}
      aria-hidden="true"
      data-portrait-kind={portrait.kind}
    >
      <span
        style={{
          backgroundImage: `url("${portrait.source}")`,
          backgroundSize: portrait.kind === "enemy" ? "contain" : `${portrait.frames * 100}% 100%`,
        }}
      />
    </div>
  );
}
