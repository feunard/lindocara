import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  PARTY_MATERIAL_TYPES,
  type PartyMaterialType,
} from "@lindocara/engine/party-harvest-state.js";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";

const MATERIAL_LABEL: Readonly<Record<PartyMaterialType, MessageKey>> = {
  wood: "material.wood",
  stone: "material.stone",
  meat: "material.meat",
};

const MATERIAL_GLYPH: Readonly<Record<PartyMaterialType, string>> = {
  wood: "W",
  stone: "S",
  meat: "M",
};

export function PeasantResourcesPanel() {
  useLocale();
  const isPeasant = useUiStore((state) => state.self?.class === "peasant");
  const materials = useUiStore((state) => state.selfState?.materials);
  if (!isPeasant || !materials) return null;

  return (
    <section
      className="peasant-resources panel"
      role="status"
      aria-live="polite"
      aria-label={t("hud.peasant_resources")}
    >
      <div className="peasant-resources__heading">
        <strong>{t("hud.peasant_resources")}</strong>
        <span>{t("hud.materials.shared")}</span>
      </div>
      <div className="peasant-resources__list">
        {PARTY_MATERIAL_TYPES.map((material) => (
          <output
            key={material}
            className={`peasant-resource peasant-resource--${material}`}
            data-material={material}
            aria-label={`${t(MATERIAL_LABEL[material])}: ${materials[material]}`}
          >
            <span className="peasant-resource__glyph" aria-hidden="true">
              {MATERIAL_GLYPH[material]}
            </span>
            <span>{t(MATERIAL_LABEL[material])}</span>
            <strong>{materials[material]}</strong>
          </output>
        ))}
      </div>
    </section>
  );
}
