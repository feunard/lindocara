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
  iron: "material.iron",
  meat: "material.meat",
};

const MATERIAL_GLYPH: Readonly<Record<PartyMaterialType, string>> = {
  wood: "W",
  stone: "S",
  iron: "I",
  meat: "M",
};

export function PeasantResourcesPanel() {
  useLocale();
  const isPeasant = useUiStore((state) => state.self?.class === "peasant");
  const materials = useUiStore((state) => state.selfState?.materials);
  const gold = useUiStore((state) => state.selfState?.inventory.gold ?? 0);
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
          <span
            key={material}
            className={`peasant-resource peasant-resource--${material}`}
            data-material={material}
          >
            <span className="peasant-resource__glyph" aria-hidden="true">
              {MATERIAL_GLYPH[material]}
            </span>
            <span>{t(MATERIAL_LABEL[material])}</span>
            <strong>{materials[material]}</strong>
          </span>
        ))}
        <span className="peasant-resource peasant-resource--gold">
          <span className="peasant-resource__glyph" aria-hidden="true">
            G
          </span>
          <span>{t("item.gold")}</span>
          <strong>{gold}</strong>
        </span>
      </div>
    </section>
  );
}
