import { Button } from "@alepha/ui/components/ui/button";
import { Checkbox } from "@alepha/ui/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@alepha/ui/components/ui/dialog";
import { Input } from "@alepha/ui/components/ui/input";
import { Label } from "@alepha/ui/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@alepha/ui/components/ui/tabs";
import { t, useLocale } from "@lindocara/client/i18n.js";
import { PLAYER_CLASSES, type PlayerClass } from "@lindocara/engine/game.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import {
  defaultMapHeroSettings,
  MAP_HERO_STAT_LIMITS,
  type MapHeroClassStats,
  type MapHeroSettings,
  parseMapHeroSettings,
} from "@lindocara/engine/map-hero-settings.js";
import { CLASS_SKILLS, type SkillSlot } from "@lindocara/engine/skills.js";
import { useEffect, useState } from "react";

interface MapHeroSettingsDialogProps {
  open: boolean;
  mapName: string;
  initial: MapHeroSettings;
  onOpenChange(open: boolean): void;
  onSave(settings: MapHeroSettings): Promise<boolean>;
}

type NumericStat = "attackBase" | "attackPerLevel" | "attackRange" | "movementSpeed";

function NumericField({
  id,
  label,
  value,
  limits,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  limits: { readonly min: number; readonly max: number };
  onChange(value: number): void;
}) {
  const invalid = !Number.isFinite(value) || value < limits.min || value > limits.max;
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        min={limits.min}
        max={limits.max}
        value={Number.isNaN(value) ? "" : value}
        aria-invalid={invalid}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <p className={invalid ? "text-destructive text-xs" : "text-muted-foreground text-xs"}>
        {t("editor.heroSettings.range", { min: limits.min, max: limits.max })}
      </p>
    </div>
  );
}

export function MapHeroSettingsDialog({
  open,
  mapName,
  initial,
  onOpenChange,
  onSave,
}: MapHeroSettingsDialogProps) {
  useLocale();
  const [settings, setSettings] = useState<MapHeroSettings>(
    () => parseMapHeroSettings(initial) ?? defaultMapHeroSettings(),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSettings(parseMapHeroSettings(initial) ?? defaultMapHeroSettings());
    setSaving(false);
  }, [initial, open]);

  function updateStat(playerClass: PlayerClass, key: NumericStat, value: number): void {
    setSettings((current) => ({
      classes: {
        ...current.classes,
        [playerClass]: {
          ...current.classes[playerClass],
          stats: { ...current.classes[playerClass].stats, [key]: value },
        },
      },
    }));
  }

  function updateHeal(
    playerClass: PlayerClass,
    key: keyof NonNullable<MapHeroClassStats["heal"]>,
    value: number,
  ): void {
    const currentHeal = settings.classes[playerClass].stats.heal;
    if (!currentHeal) return;
    setSettings((current) => ({
      classes: {
        ...current.classes,
        [playerClass]: {
          ...current.classes[playerClass],
          stats: {
            ...current.classes[playerClass].stats,
            heal: { ...currentHeal, [key]: value },
          },
        },
      },
    }));
  }

  function setSkillEnabled(playerClass: PlayerClass, slot: SkillSlot, enabled: boolean): void {
    setSettings((current) => {
      const disabled = current.classes[playerClass].disabledSkills;
      const disabledSkills = enabled
        ? disabled.filter((candidate) => candidate !== slot)
        : [...new Set([...disabled, slot])].sort((a, b) => a - b);
      return {
        classes: {
          ...current.classes,
          [playerClass]: { ...current.classes[playerClass], disabledSkills },
        },
      };
    });
  }

  function resetClass(playerClass: PlayerClass): void {
    const defaults = defaultMapHeroSettings();
    setSettings((current) => ({
      classes: { ...current.classes, [playerClass]: defaults.classes[playerClass] },
    }));
  }

  const parsed = parseMapHeroSettings(settings);

  async function save(): Promise<void> {
    if (saving || !parsed) return;
    setSaving(true);
    try {
      if (await onSave(parsed)) onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[88vh] flex-col sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{t("editor.heroSettings.title", { name: mapName })}</DialogTitle>
        </DialogHeader>
        <p className="text-muted-foreground text-sm">{t("editor.heroSettings.hint")}</p>
        <Tabs defaultValue="warrior" className="min-h-0 flex-1 overflow-hidden">
          <TabsList className="grid w-full grid-cols-5">
            {PLAYER_CLASSES.map((playerClass) => (
              <TabsTrigger key={playerClass} value={playerClass}>
                {t(`class.${playerClass}` as MessageKey)}
              </TabsTrigger>
            ))}
          </TabsList>
          {PLAYER_CLASSES.map((playerClass) => {
            const current = settings.classes[playerClass];
            const prefix = `map-hero-${playerClass}`;
            return (
              <TabsContent
                key={playerClass}
                value={playerClass}
                className="max-h-[58vh] overflow-y-auto py-3 pr-2"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t("editor.heroSettings.stats")}</h3>
                  <Button variant="outline" size="sm" onClick={() => resetClass(playerClass)}>
                    {t("editor.heroSettings.resetClass")}
                  </Button>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <NumericField
                    id={`${prefix}-attack-base`}
                    label={t("editor.heroSettings.attackBase")}
                    value={current.stats.attackBase}
                    limits={MAP_HERO_STAT_LIMITS.attackBase}
                    onChange={(value) => updateStat(playerClass, "attackBase", value)}
                  />
                  <NumericField
                    id={`${prefix}-attack-level`}
                    label={t("editor.heroSettings.attackPerLevel")}
                    value={current.stats.attackPerLevel}
                    limits={MAP_HERO_STAT_LIMITS.attackPerLevel}
                    onChange={(value) => updateStat(playerClass, "attackPerLevel", value)}
                  />
                  <NumericField
                    id={`${prefix}-attack-range`}
                    label={t("editor.heroSettings.attackRange")}
                    value={current.stats.attackRange}
                    limits={MAP_HERO_STAT_LIMITS.attackRange}
                    onChange={(value) => updateStat(playerClass, "attackRange", value)}
                  />
                  <NumericField
                    id={`${prefix}-movement-speed`}
                    label={t("editor.heroSettings.movementSpeed")}
                    value={current.stats.movementSpeed}
                    limits={MAP_HERO_STAT_LIMITS.movementSpeed}
                    onChange={(value) => updateStat(playerClass, "movementSpeed", value)}
                  />
                  {current.stats.heal && (
                    <>
                      <NumericField
                        id={`${prefix}-heal-base`}
                        label={t("editor.heroSettings.healBase")}
                        value={current.stats.heal.base}
                        limits={MAP_HERO_STAT_LIMITS.healBase}
                        onChange={(value) => updateHeal(playerClass, "base", value)}
                      />
                      <NumericField
                        id={`${prefix}-heal-level`}
                        label={t("editor.heroSettings.healPerLevel")}
                        value={current.stats.heal.perLevel}
                        limits={MAP_HERO_STAT_LIMITS.healPerLevel}
                        onChange={(value) => updateHeal(playerClass, "perLevel", value)}
                      />
                      <NumericField
                        id={`${prefix}-heal-range`}
                        label={t("editor.heroSettings.healRange")}
                        value={current.stats.heal.range}
                        limits={MAP_HERO_STAT_LIMITS.healRange}
                        onChange={(value) => updateHeal(playerClass, "range", value)}
                      />
                    </>
                  )}
                </div>
                <h3 className="mt-5 mb-2 text-sm font-semibold">
                  {t("editor.heroSettings.skills")}
                </h3>
                <div className="grid gap-2 rounded-md border p-3">
                  {CLASS_SKILLS[playerClass].map((skill) => {
                    const id = `${prefix}-skill-${skill.slot}`;
                    const enabled = !current.disabledSkills.includes(skill.slot);
                    return (
                      <label
                        key={skill.id}
                        htmlFor={id}
                        className="flex items-center gap-3 text-sm"
                      >
                        <Checkbox
                          id={id}
                          checked={enabled}
                          onCheckedChange={(checked) =>
                            setSkillEnabled(playerClass, skill.slot, checked === true)
                          }
                        />
                        <span>
                          {skill.slot}. {t(`skill.${playerClass}.${skill.id}.name` as MessageKey)}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t("adventure.delete.cancel")}
          </Button>
          <Button disabled={saving || !parsed} onClick={() => void save()}>
            {t("editor.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
