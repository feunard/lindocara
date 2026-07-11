import type { CSSProperties } from "react";
import type { CharacterAppearance, Equipment } from "../../shared/character.js";
import { classForEquipment, unitSheet } from "../game/tiny-swords-art.js";

export type PreviewMotion = "idle" | "walk" | "attack";

interface CharacterPreviewProps {
  appearance: CharacterAppearance;
  equipment: Equipment;
  motion?: PreviewMotion;
  compact?: boolean;
  label: string;
}

function UnitPreview({
  appearance,
  equipment,
  motion,
}: {
  appearance: CharacterAppearance;
  equipment: Equipment;
  motion: PreviewMotion;
}) {
  const playerClass = classForEquipment(equipment);
  const sheet = unitSheet(playerClass, appearance, motion === "walk" ? "run" : motion);
  return (
    <span
      className="character-preview__tiny-swords"
      aria-hidden="true"
      style={
        {
          "--unit-frames": sheet.frames,
          "--unit-distance": `${-192 * sheet.frames}px`,
          "--unit-duration": `${Math.max(520, sheet.frames * 95)}ms`,
        } as CSSProperties
      }
    >
      <img className="character-preview__unit-strip" src={sheet.source} alt="" />
    </span>
  );
}

export function CharacterPreview({
  appearance,
  equipment,
  motion = "idle",
  compact = false,
  label,
}: CharacterPreviewProps) {
  return (
    <div
      className={`character-preview character-preview--${motion}${compact ? " character-preview--compact" : ""}`}
      role="img"
      aria-label={label}
    >
      <span className="character-preview__shadow" />
      <span className="character-preview__actor">
        <UnitPreview appearance={appearance} equipment={equipment} motion={motion} />
      </span>
    </div>
  );
}
