import type { CharacterAppearance, Equipment } from "../../shared/character.js";
import {
  CHARACTER_ATLAS_URL,
  MAIN_HAND_ART,
  OFF_HAND_ART,
  PLAYER_ATLAS_FRAMES,
} from "../game/character-art.js";

export type PreviewMotion = "idle" | "walk" | "attack";

interface CharacterPreviewProps {
  appearance: CharacterAppearance;
  equipment: Equipment;
  motion?: PreviewMotion;
  compact?: boolean;
  label: string;
}

function AtlasLayer({
  frame,
}: {
  frame: (typeof PLAYER_ATLAS_FRAMES)[keyof typeof PLAYER_ATLAS_FRAMES];
}) {
  return (
    <span
      className="character-preview__body"
      style={{
        backgroundImage: `url(${CHARACTER_ATLAS_URL})`,
        backgroundPosition: `-${frame.x}px -${frame.y}px`,
      }}
    />
  );
}

export function CharacterPreview({
  appearance,
  equipment,
  motion = "idle",
  compact = false,
  label,
}: CharacterPreviewProps) {
  const frame = PLAYER_ATLAS_FRAMES[appearance.primaryColor];
  const mainHand = MAIN_HAND_ART[equipment.mainHand];
  const offHand = equipment.offHand ? OFF_HAND_ART[equipment.offHand] : null;

  return (
    <div
      className={`character-preview character-preview--${motion}${compact ? " character-preview--compact" : ""}`}
      role="img"
      aria-label={label}
    >
      <span className="character-preview__shadow" />
      <span className="character-preview__actor">
        {offHand && (
          <img
            className="character-preview__offhand"
            src={offHand.source}
            width={offHand.width}
            height={offHand.height}
            alt=""
          />
        )}
        <AtlasLayer frame={frame} />
        {mainHand.source === "atlas" ? (
          <span className="character-preview__mainhand character-preview__mainhand--sword" />
        ) : (
          <img
            className={`character-preview__mainhand character-preview__mainhand--${equipment.mainHand}`}
            src={mainHand.source}
            width={mainHand.width}
            height={mainHand.height}
            alt=""
          />
        )}
      </span>
    </div>
  );
}
