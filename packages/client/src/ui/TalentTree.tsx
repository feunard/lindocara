import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import type { PartyMaterialAmounts } from "@lindocara/engine/party-harvest-state.js";
import { PEASANT_SUPPORT_SKILLS } from "@lindocara/engine/peasant-support.js";
import { isSkillUnlocked, skillFor } from "@lindocara/engine/skills.js";
import {
  CLASS_TALENTS,
  conflictingExclusiveTalent,
  peasantBombTalentPlan,
  peasantConstructionTalentPlan,
  type TalentEffect,
  type TalentLabel,
  talentBranchSlots,
  unlockTalent,
} from "@lindocara/engine/talents.js";
import { skillIconArt } from "@lindocara/renderer/tiny-swords-art.js";
import { type CSSProperties, useEffect, useState } from "react";

import { t, useLocale } from "../i18n.js";
import { partyMaterialCostText } from "../material-copy.js";
import { useUiStore } from "../store.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

const NODE_GLYPHS: Readonly<Record<Exclude<TalentLabel, "root">, string>> = {
  power: "+",
  range: "◎",
  distance: "➜",
  cooldown: "↻",
  guard_reduction: "◆",
  perfect_parry: "✦",
  perfect_retaliation: "↯",
  ally_guard: "◈",
  seismic_impact: "◉",
  king_challenge: "♛",
  rallying_cry: "✹",
  cyclone: "◌",
  ricochet: "⌁",
  line_piercer: "➵",
  extra_projectiles: "⋰",
  focused_volley: "≋",
  dash_invulnerability: "◇",
  retreat_shot: "⇤",
  execute: "✧",
  comet_arrow: "☄",
  chain_heal: "∞",
  emergency_mend: "✚",
  blink_heal: "✚",
  sacred_passage: "⌇",
  sanctuary: "☼",
  absolution: "✥",
  nova_judgment: "⚡",
  nova_mercy: "♡",
  evolution: "✦",
  ultimate: "✹",
  mastery: "★",
};

function effectValue(effects: readonly TalentEffect[]): string | number {
  const effect = effects[0];
  if (!effect) return "";
  if (
    effect.kind === "power_multiplier" ||
    effect.kind === "range_multiplier" ||
    effect.kind === "distance_multiplier" ||
    effect.kind === "cooldown_multiplier" ||
    effect.kind === "guard_reduction"
  )
    return Math.round(effect.value * 100);
  if (effect.kind === "perfect_parry") return effect.windowMs;
  if (effect.kind === "perfect_retaliation" || effect.kind === "chain_heal")
    return Math.round(effect.ratio * 100);
  if (effect.kind === "ricochet") return Math.round(effect.ratio * 100);
  if (effect.kind === "extra_projectiles" || effect.kind === "blink_heal") return effect.value;
  if (effect.kind === "execute") return Math.round(effect.threshold * 100);
  return "";
}

export function TalentTree() {
  useLocale();
  const open = useUiStore((state) => state.talentsOpen);
  const setOpen = useUiStore((state) => state.setTalentsOpen);
  const self = useUiStore((state) => state.self);
  const talentState = useUiStore((state) => state.selfState?.talents);
  const game = useUiStore((state) => state.game);
  const [confirmReset, setConfirmReset] = useState(false);
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setConfirmReset(false);
      setInspectedNodeId(null);
    }
  }, [open]);

  if (!open || !self || !talentState) return null;
  const selected = new Set(talentState.selected);
  const branches = talentBranchSlots(self.class);
  const classNodes = CLASS_TALENTS[self.class];
  const materialCostForSlot = (slot: number): Readonly<PartyMaterialAmounts> | null => {
    if (self.class !== "peasant") return null;
    if (slot === 3) return PEASANT_SUPPORT_SKILLS[3].cost;
    if (slot === 4) return peasantConstructionTalentPlan(talentState.selected).support.cost;
    if (slot === 5) return peasantBombTalentPlan(talentState.selected).support.cost;
    return null;
  };
  const inspectedNode =
    classNodes.find((node) => node.id === inspectedNodeId) ?? classNodes.find((node) => node.root);
  const copyFor = (node: (typeof classNodes)[number]) => {
    const skill = skillFor(self.class, node.slot);
    const skillName = t(`skill.${self.class}.${skill.id}.name` as MessageKey);
    const evolutionSuffix = node.variantId ? `.${node.variantId}` : "";
    return {
      skillName,
      name: node.root
        ? skillName
        : node.tier === 4
          ? t(`talent.ultimate.${self.class}.${skill.id}.name` as MessageKey)
          : node.tier === 3
            ? t(`talent.evolution.${self.class}.${skill.id}${evolutionSuffix}.name` as MessageKey)
            : t(`talent.node.${node.label}.name` as MessageKey),
      description: node.root
        ? t(`skill.${self.class}.${skill.id}.description` as MessageKey)
        : node.tier === 4
          ? t(`talent.ultimate.${self.class}.${skill.id}.description` as MessageKey)
          : node.tier === 3
            ? t(
                `talent.evolution.${self.class}.${skill.id}${evolutionSuffix}.description` as MessageKey,
              )
            : t(`talent.node.${node.label}.description` as MessageKey, {
                skill: skillName,
                value: effectValue(node.effects),
              }),
    };
  };
  const inspectedCopy = inspectedNode ? copyFor(inspectedNode) : null;
  const inspectedConflict = inspectedNode
    ? conflictingExclusiveTalent(self.class, selected, inspectedNode)
    : undefined;

  return (
    <section
      className="talent-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="talent-title"
    >
      <div className="talent-panel">
        <header className="talent-header">
          <div>
            <p className="talent-kicker">{t(`class.${self.class}` as MessageKey)}</p>
            <h2 id="talent-title">
              {t("talent.title")} <span className="talent-v2">{t("talent.evolutions")}</span>
            </h2>
            <p>
              {t("talent.points", { available: talentState.pointsAvailable, total: self.level })}
            </p>
          </div>
          <TinyButton
            type="button"
            size="sm"
            onClick={() => setOpen(false)}
            aria-label={t("talent.close")}
          >
            ×
          </TinyButton>
        </header>

        <p className="talent-hint" data-text-surface="guidance">
          {t("talent.hint")}
        </p>
        <div className="talent-branches">
          {branches.map((slot) => {
            const skill = skillFor(self.class, slot);
            const skillName = t(`skill.${self.class}.${skill.id}.name` as MessageKey);
            const materialCost = materialCostForSlot(slot);
            const materialCostCopy = materialCost
              ? t("skill.material_cost", { cost: partyMaterialCostText(materialCost) })
              : null;
            const nodes = classNodes.filter((node) => node.slot === slot);
            const icon = skillIconArt(self.class, slot);
            const iconStyle = {
              backgroundImage: `url("${icon.source}")`,
              backgroundSize: `${icon.frames * 100}% 100%`,
              backgroundPosition: `${icon.frames === 1 ? 0 : (icon.frame / (icon.frames - 1)) * 100}% center`,
            } satisfies CSSProperties;
            return (
              <article className="talent-branch" key={skill.id}>
                <h3>{skillName}</h3>
                {materialCostCopy && <p className="talent-branch__cost">{materialCostCopy}</p>}
                <p className="talent-branch__choice">{t("talent.choice")}</p>
                <div className="talent-grid">
                  {nodes.map((node) => {
                    const rootActive = node.root && isSkillUnlocked(self.level, slot);
                    const active = rootActive || selected.has(node.id);
                    const exclusiveConflict = conflictingExclusiveTalent(
                      self.class,
                      selected,
                      node,
                    );
                    const result = unlockTalent(
                      self.class,
                      self.level,
                      talentState.selected,
                      node.id,
                    );
                    const available = !node.root && !active && result.ok;
                    const { name, description } = copyFor(node);
                    const variantLabel = node.variantId
                      ? t(`talent.variant.${node.variantId}` as MessageKey)
                      : null;
                    const status = active
                      ? t("talent.status.active")
                      : exclusiveConflict
                        ? t("talent.status.exclusive", {
                            variant: copyFor(exclusiveConflict).name,
                          })
                        : available
                          ? t("talent.status.available")
                          : t("talent.status.locked");
                    return (
                      <button
                        type="button"
                        key={node.id}
                        className={`talent-node${active ? " talent-node--active" : ""}${available ? " talent-node--available" : ""}${node.variantId ? ` talent-node--variant talent-node--variant-${node.variantId}` : ""}${node.tier === 4 ? " talent-node--ultimate" : ""}${exclusiveConflict ? " talent-node--exclusive-disabled" : ""}`}
                        style={{ gridRow: node.tier + 1, gridColumn: node.column + 2 }}
                        aria-pressed={active}
                        aria-disabled={exclusiveConflict ? true : undefined}
                        onClick={() => {
                          setInspectedNodeId(node.id);
                          if (available) game?.unlockTalent?.(node.id);
                        }}
                        aria-label={`${name}.${variantLabel ? ` ${variantLabel}.` : ""} ${description}${materialCostCopy ? ` ${materialCostCopy}.` : ""} ${status}.`}
                        title={`${name} — ${description}${materialCostCopy ? ` · ${materialCostCopy}` : ""}`}
                      >
                        <span className="talent-node__icon" style={iconStyle} aria-hidden="true" />
                        {!node.root && (
                          <span className="talent-node__glyph" aria-hidden="true">
                            {NODE_GLYPHS[node.label as Exclude<TalentLabel, "root">]}
                          </span>
                        )}
                        <span className="talent-node__name">{name}</span>
                        {node.variantId && (
                          <span className="talent-node__variant" aria-hidden="true">
                            {node.variantId.toUpperCase()}
                          </span>
                        )}
                        <span className="talent-node__cost" aria-hidden="true">
                          {node.root ? "0" : "1"}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>

        {inspectedNode && inspectedCopy && (
          <aside className="talent-detail" aria-live="polite">
            <div className="talent-detail__copy">
              <p>{inspectedCopy.skillName}</p>
              <h3>{inspectedCopy.name}</h3>
              <span>{inspectedCopy.description}</span>
              {materialCostForSlot(inspectedNode.slot) && (
                <span className="talent-detail__material-cost">
                  {t("skill.material_cost", {
                    cost: partyMaterialCostText(materialCostForSlot(inspectedNode.slot) ?? {}),
                  })}
                </span>
              )}
            </div>
            <strong>
              {inspectedNode.root || selected.has(inspectedNode.id)
                ? t("talent.status.active")
                : inspectedConflict
                  ? t("talent.status.exclusive", {
                      variant: copyFor(inspectedConflict).name,
                    })
                  : unlockTalent(self.class, self.level, talentState.selected, inspectedNode.id).ok
                    ? t("talent.status.available")
                    : t("talent.status.locked")}
            </strong>
          </aside>
        )}

        <footer className="talent-footer">
          {!confirmReset ? (
            <TinyButton
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={talentState.pointsSpent === 0}
            >
              {t("talent.reset")}
            </TinyButton>
          ) : (
            <div
              className="talent-reset-confirm"
              role="alertdialog"
              aria-label={t("talent.reset.confirm")}
            >
              <span>{t("talent.reset.confirm")}</span>
              <TinyButton
                type="button"
                onClick={() => {
                  game?.resetTalents?.();
                  setConfirmReset(false);
                }}
              >
                {t("talent.reset.yes")}
              </TinyButton>
              <TinyButton type="button" onClick={() => setConfirmReset(false)}>
                {t("talent.reset.no")}
              </TinyButton>
            </div>
          )}
          <span>{t("talent.free_reset")}</span>
        </footer>
      </div>
    </section>
  );
}
