import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { isMapSkillEnabled } from "@lindocara/engine/map-hero-settings.js";
import {
  PARTY_MATERIAL_TYPES,
  type PartyMaterialAmounts,
  type PartyMaterialType,
  spendPartyMaterials,
} from "@lindocara/engine/party-harvest-state.js";
import { skillResourceCost } from "@lindocara/engine/resources.js";
import type { SkillSlot } from "@lindocara/engine/skills.js";
import { CLASS_SKILLS, isSkillUnlocked, SKILL_UNLOCK_LEVEL } from "@lindocara/engine/skills.js";
import {
  activeEvolutionVariant,
  peasantBombTalentPlan,
  peasantConstructionTalentPlan,
  talentEffect,
} from "@lindocara/engine/talents.js";
import { keyboardBindingLabel } from "@lindocara/renderer/input-settings.js";
import { skillIconArt } from "@lindocara/renderer/tiny-swords-art.js";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { activeReactivationDeadline } from "../../game/cooldown-sync.js";
import { t } from "../../i18n.js";
import { useUiStore } from "../../store.js";
import { controlBindingLabel, useInputModeSettings } from "../input-hints.js";

export const SKILL_PAD_LAYOUT: Readonly<
  Record<SkillSlot, { row: 1 | 2; column: 1 | 2 | 3; numpad: 1 | 2 | 3 | 4 | 5 }>
> = {
  1: { row: 1, column: 2, numpad: 5 },
  2: { row: 2, column: 3, numpad: 3 },
  3: { row: 2, column: 2, numpad: 2 },
  4: { row: 2, column: 1, numpad: 1 },
  5: { row: 1, column: 1, numpad: 4 },
};

const MATERIAL_LABEL: Readonly<Record<PartyMaterialType, MessageKey>> = {
  wood: "material.wood",
  stone: "material.stone",
  iron: "material.iron",
  meat: "material.meat",
};

const MATERIAL_SHORT_LABEL: Readonly<Record<PartyMaterialType, MessageKey>> = {
  wood: "material.short.wood",
  stone: "material.short.stone",
  iron: "material.short.iron",
  meat: "material.short.meat",
};

function materialCostText(cost: Readonly<PartyMaterialAmounts>): string {
  return PARTY_MATERIAL_TYPES.flatMap((material) => {
    const amount = cost[material] ?? 0;
    return amount > 0 ? [`${t(MATERIAL_LABEL[material])} ${amount}`] : [];
  }).join(" · ");
}

export function SkillBar() {
  const self = useUiStore((state) => state.self);
  const game = useUiStore((state) => state.game);
  const selfState = useUiStore((state) => state.selfState);
  const attackCooldownUntil = useUiStore((state) => state.attackCooldownUntil);
  const cooldowns = useUiStore((state) => state.skillCooldowns);
  const mapHeroSettings = useUiStore((state) => state.mapHeroSettings);
  const { mode, settings: inputSettings } = useInputModeSettings();
  const [now, setNow] = useState(() => performance.now());
  const heldPointer = useRef<{ pointerId: number; slot: SkillSlot } | null>(null);
  const shadowReturnUntil =
    self?.class === "rogue" ? (selfState?.rogue?.shadowReturnUntil ?? 0) : 0;
  const shadowReturnServerNow = selfState?.serverNow ?? 0;
  const shadowReturnLocalDeadline = useMemo(() => {
    const remaining = Math.max(0, shadowReturnUntil - shadowReturnServerNow);
    return remaining > 0 ? performance.now() + remaining : 0;
  }, [shadowReturnServerNow, shadowReturnUntil]);
  const afterimageUntil = self?.class === "ranger" ? (selfState?.ranger?.afterimageUntil ?? 0) : 0;
  const afterimageLocalDeadline = useMemo(() => {
    const remaining = Math.max(0, afterimageUntil - shadowReturnServerNow);
    return remaining > 0 ? performance.now() + remaining : 0;
  }, [afterimageUntil, shadowReturnServerNow]);
  const danceMarksUntil = self?.class === "rogue" ? (selfState?.rogue?.danceMarksUntil ?? 0) : 0;
  const danceMarksAvailableAt =
    self?.class === "rogue" ? (selfState?.rogue?.danceMarksAvailableAt ?? 0) : 0;
  const danceMarksLocalAvailableAt = useMemo(() => {
    const remaining = Math.max(0, danceMarksAvailableAt - shadowReturnServerNow);
    return remaining > 0 ? performance.now() + remaining : 0;
  }, [danceMarksAvailableAt, shadowReturnServerNow]);
  const danceMarksLocalDeadline = useMemo(() => {
    const remaining = Math.max(0, danceMarksUntil - shadowReturnServerNow);
    return remaining > 0 ? performance.now() + remaining : 0;
  }, [danceMarksUntil, shadowReturnServerNow]);

  useEffect(() => {
    const releaseHeldPointer = (event: PointerEvent) => {
      const held = heldPointer.current;
      if (!held || held.pointerId !== event.pointerId) return;
      heldPointer.current = null;
      useUiStore.getState().game?.releaseSkill?.(held.slot);
    };
    window.addEventListener("pointerup", releaseHeldPointer);
    window.addEventListener("pointercancel", releaseHeldPointer);
    return () => {
      window.removeEventListener("pointerup", releaseHeldPointer);
      window.removeEventListener("pointercancel", releaseHeldPointer);
      const held = heldPointer.current;
      if (held) useUiStore.getState().game?.releaseSkill?.(held.slot);
      heldPointer.current = null;
    };
  }, []);

  useEffect(() => {
    const latestDeadline = Math.max(
      attackCooldownUntil,
      shadowReturnLocalDeadline,
      afterimageLocalDeadline,
      danceMarksLocalAvailableAt,
      danceMarksLocalDeadline,
      ...Object.values(cooldowns),
    );
    const startedAt = performance.now();
    setNow(startedAt);
    if (latestDeadline <= startedAt) return;
    let timer: number | null = null;
    const tick = () => {
      const next = performance.now();
      setNow(next);
      if (next >= latestDeadline && timer !== null) {
        window.clearInterval(timer);
        timer = null;
      }
    };
    timer = window.setInterval(tick, 100);
    return () => {
      if (timer !== null) window.clearInterval(timer);
    };
  }, [
    afterimageLocalDeadline,
    attackCooldownUntil,
    cooldowns,
    danceMarksLocalAvailableAt,
    danceMarksLocalDeadline,
    shadowReturnLocalDeadline,
  ]);

  if (!self) return null;
  const ironGuardActive = self.class === "warrior" && self.guarding === true;
  const materials = self.class === "peasant" ? selfState?.materials : undefined;
  const peasantPlans =
    self.class === "peasant"
      ? {
          camp: peasantConstructionTalentPlan(selfState?.talents?.selected ?? []).support,
          bomb: peasantBombTalentPlan(selfState?.talents?.selected ?? []).support,
        }
      : null;

  return (
    <section className="skill-bar panel" aria-label={t("hud.abilities")}>
      {materials && (
        <div
          className="skill-bar__materials"
          role="status"
          aria-live="polite"
          aria-label={t("hud.materials")}
        >
          {PARTY_MATERIAL_TYPES.map((material) => (
            <span
              key={material}
              className={`skill-bar__material skill-bar__material--${material}`}
              data-material={material}
            >
              <span className="sr-only">
                {t("hud.materials.amount", {
                  material: t(MATERIAL_LABEL[material]),
                  amount: materials[material],
                })}
              </span>
              <span aria-hidden="true">{t(MATERIAL_SHORT_LABEL[material])}</span>
              <strong aria-hidden="true">{materials[material]}</strong>
            </span>
          ))}
        </div>
      )}
      {CLASS_SKILLS[self.class].map((skill) => {
        const cooldownUntil = skill.slot === 1 ? attackCooldownUntil : cooldowns[skill.slot];
        const remaining = Math.max(0, cooldownUntil - now);
        const shadowReturnReady =
          self.class === "rogue" && skill.slot === 2 && now < shadowReturnLocalDeadline;
        const afterimageReady =
          self.class === "ranger" && skill.slot === 4 && now < afterimageLocalDeadline;
        const danceRepositionReady =
          self.class === "rogue" &&
          skill.slot === 5 &&
          activeReactivationDeadline(danceMarksLocalAvailableAt, danceMarksLocalDeadline, now) > 0;
        const cooling =
          remaining > 0 && !shadowReturnReady && !afterimageReady && !danceRepositionReady;
        const evolution = activeEvolutionVariant(
          self.class,
          selfState?.talents?.selected ?? [],
          skill.slot,
        );
        const evolutionSuffix = evolution?.variantId ? `.${evolution.variantId}` : "";
        const evolutionLabel = evolution?.variantId
          ? t(`talent.variant.${evolution.variantId}` as MessageKey)
          : null;
        const name = evolution
          ? t(`talent.evolution.${self.class}.${skill.id}${evolutionSuffix}.name` as MessageKey)
          : t(`skill.${self.class}.${skill.id}.name` as MessageKey);
        const description = evolution
          ? t(
              `talent.evolution.${self.class}.${skill.id}${evolutionSuffix}.description` as MessageKey,
            )
          : t(`skill.${self.class}.${skill.id}.description` as MessageKey);
        const requiredLevel = SKILL_UNLOCK_LEVEL[skill.slot];
        const unlocked = isSkillUnlocked(self.level, skill.slot);
        const enabledOnMap = isMapSkillEnabled(
          mapHeroSettings ?? undefined,
          self.class,
          skill.slot,
        );
        const manaCost = skillResourceCost(self.class, skill.slot);
        const lacksMana =
          manaCost > 0 && (selfState?.resource?.current ?? Number.NEGATIVE_INFINITY) < manaCost;
        const guardToggle = self.class === "warrior" && skill.id === "iron_guard";
        const heldSkill =
          (self.class === "priest" && skill.id === "blink") ||
          (self.class === "ranger" &&
            skill.id === "heartseeker" &&
            talentEffect(self.class, selfState?.talents?.selected ?? [], "sworn_prey", 5) !==
              undefined);
        const blockedByGuard = ironGuardActive && !guardToggle;
        const unavailable = !unlocked || !enabledOnMap || cooling || lacksMana || blockedByGuard;
        const manaText = manaCost > 0 ? t("skill.mana_cost", { cost: manaCost }) : null;
        const support =
          skill.slot === 4 ? peasantPlans?.camp : skill.slot === 5 ? peasantPlans?.bomb : null;
        const affordable =
          support == null ||
          (materials !== undefined && spendPartyMaterials(materials, support.cost) !== null);
        const supportCost = support ? materialCostText(support.cost) : null;
        const supportText = supportCost
          ? `${t("skill.material_cost", { cost: supportCost })}${
              affordable ? "" : ` · ${t("skill.materials_insufficient")}`
            }`
          : null;
        const icon = skillIconArt(self.class, skill.slot);
        const control = `skill${skill.slot}` as const;
        const keyBindings = inputSettings.keyboard[control];
        const layout = SKILL_PAD_LAYOUT[skill.slot];
        const numpadLabel =
          keyBindings
            .filter((binding) => binding.code.startsWith("Numpad"))
            .map(keyboardBindingLabel)[0] ?? `Num ${layout.numpad}`;
        const primaryLabels = keyBindings
          .filter((binding) => !binding.code.startsWith("Numpad"))
          .map(keyboardBindingLabel);
        const displayedLabels =
          mode === "gamepad" ? [controlBindingLabel(control, mode, inputSettings)] : primaryLabels;
        const iconStyle = {
          backgroundImage: `url("${icon.source}")`,
          backgroundSize: `${icon.frames * 100}% 100%`,
          backgroundPosition: `${icon.frames === 1 ? 0 : (icon.frame / (icon.frames - 1)) * 100}% center`,
        } satisfies CSSProperties;
        return (
          <button
            type="button"
            key={skill.id}
            className={`skill-slot skill-slot--${skill.slot}${unavailable ? " cooling" : ""}${support && !affordable ? " unaffordable" : ""}${guardToggle && ironGuardActive ? " active" : ""}${shadowReturnReady || afterimageReady || danceRepositionReady ? " return-ready" : ""}${evolution ? ` evolved evolved--${evolution.variantId ?? "active"}` : ""}`}
            style={{ gridRow: layout.row, gridColumn: layout.column }}
            data-numpad={layout.numpad}
            data-evolution-variant={evolution?.variantId}
            data-shadow-return-ready={shadowReturnReady || undefined}
            data-afterimage-ready={afterimageReady || undefined}
            data-dance-reposition-ready={danceRepositionReady || undefined}
            data-material-affordable={support ? String(affordable) : undefined}
            disabled={!game || self.life !== "alive" || unavailable}
            onPointerDown={
              heldSkill
                ? (event) => {
                    event.currentTarget.setPointerCapture?.(event.pointerId);
                    heldPointer.current = { pointerId: event.pointerId, slot: skill.slot };
                    game?.castSkill(skill.slot);
                  }
                : undefined
            }
            onClick={(event) => {
              if (!heldSkill) game?.castSkill(skill.slot);
              else if (event.detail === 0) {
                game?.castSkill(skill.slot);
                game?.releaseSkill?.(skill.slot);
              }
            }}
            aria-pressed={guardToggle ? ironGuardActive : undefined}
            aria-label={`${skill.slot}. ${name}${evolutionLabel ? `. ${evolutionLabel}` : ""}${shadowReturnReady ? `. ${t("skill.rogue.shadow_return.ready")}` : ""}${afterimageReady ? `. ${t("skill.ranger.afterimage.ready")}` : ""}${danceRepositionReady ? `. ${t("skill.rogue.dance_master.ready")}` : ""}${supportText ? `. ${supportText}` : ""}`}
            aria-keyshortcuts={keyBindings.map((binding) => binding.code).join(" ")}
            title={
              !enabledOnMap
                ? `${name} — ${t("skill.disabled_on_map")}`
                : unlocked
                  ? `${name} — ${description} · ${skill.cooldownMs / 1000}s${manaText ? ` · ${manaText}` : ""}`
                  : `${name} — ${t("skill.unlock_at", { level: requiredLevel })}`
            }
          >
            <span className="skill-slot__key">{displayedLabels.join(" / ")}</span>
            {mode === "keyboard" && (
              <span className="skill-slot__pad" aria-hidden="true">
                {numpadLabel}
              </span>
            )}
            <span
              className={`skill-slot__icon skill-slot__icon--${icon.variant}`}
              style={iconStyle}
              aria-hidden="true"
            />
            <span className="skill-slot__name">{name}</span>
            {evolution?.variantId && (
              <span className="skill-slot__variant" aria-hidden="true">
                {evolution.variantId.toUpperCase()}
              </span>
            )}
            {manaCost > 0 && <span className="skill-slot__cost">{manaCost}</span>}
            {support && (
              <span className="skill-slot__material-costs" aria-hidden="true">
                {PARTY_MATERIAL_TYPES.flatMap((material) => {
                  const amount = support.cost[material] ?? 0;
                  if (amount <= 0) return [];
                  const missing = (materials?.[material] ?? 0) < amount;
                  return [
                    <span
                      key={material}
                      className={`skill-slot__material-cost${missing ? " missing" : ""}`}
                      data-material-cost={material}
                      aria-hidden="true"
                    >
                      {t(MATERIAL_SHORT_LABEL[material])}
                      {amount}
                    </span>,
                  ];
                })}
              </span>
            )}
            {!unlocked && <span className="skill-slot__lock">{requiredLevel}</span>}
            {unlocked && !enabledOnMap && <span className="skill-slot__lock">×</span>}
            {shadowReturnReady && (
              <span className="skill-slot__return">{t("skill.rogue.shadow_return.ready")}</span>
            )}
            {afterimageReady && (
              <span className="skill-slot__return">{t("skill.ranger.afterimage.ready")}</span>
            )}
            {danceRepositionReady && (
              <span className="skill-slot__return">{t("skill.rogue.dance_master.ready")}</span>
            )}
            {cooling && (
              <span className="skill-slot__cooldown" aria-hidden="true">
                {(remaining / 1000).toFixed(remaining < 950 ? 1 : 0)}
              </span>
            )}
            <span className="skill-slot__tooltip" role="tooltip">
              {!enabledOnMap
                ? t("skill.disabled_on_map")
                : unlocked
                  ? `${description}${manaText ? ` · ${manaText}` : ""}`
                  : t("skill.unlock_at", { level: requiredLevel })}
            </span>
          </button>
        );
      })}
    </section>
  );
}
