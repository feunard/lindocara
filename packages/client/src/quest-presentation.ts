import type { AuthoredQuestTracker } from "@lindocara/engine/adventure-state.js";
import type { MessageKey } from "@lindocara/engine/i18n/index.js";
import { t } from "./i18n.js";

export type TrackedQuestObjective = AuthoredQuestTracker["objectives"][number];

function humanize(value: string): string {
  return value
    .replaceAll(/[-_]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim()
    .replace(/^./, (first) => first.toUpperCase());
}

function translatedName(key: MessageKey, fallback: string): string {
  const translated = t(key);
  return translated === key ? humanize(fallback) : translated;
}

export function questItemName(itemId: string): string {
  return translatedName(`consumable.${itemId}.name` as MessageKey, itemId);
}

/** Localized automatic copy generated from the structured rule; custom prose always wins. */
export function questObjectiveLabel(objective: TrackedQuestObjective): string {
  if (objective.label.trim()) return objective.label.trim();
  const rule = objective.rule;
  switch (rule.type) {
    case "kill":
      return t("quest.objective.kill", {
        target: translatedName(`monster.${rule.species}` as MessageKey, rule.species),
      });
    case "defeat-target":
      return t("quest.objective.defeatTarget");
    case "collect":
      return t("quest.objective.collect", { item: questItemName(rule.itemId) });
    case "deliver":
      return t("quest.objective.deliver", { item: questItemName(rule.itemId) });
    case "interact":
      return t(rule.interaction === "talk" ? "quest.objective.talk" : "quest.objective.interact");
    case "reach":
      return rule.destination.kind === "area"
        ? t("quest.objective.reachArea", { area: humanize(rule.destination.areaId) })
        : t("quest.objective.reachMap");
    case "use-item":
      return t("quest.objective.useItem", { item: questItemName(rule.itemId) });
    case "activity":
      return t("quest.objective.activity", { activity: humanize(rule.activityId) });
    case "manual":
      return t("quest.objective.manual");
  }
}

export function questObjectiveProgressText(objective: TrackedQuestObjective): string {
  return t("quest.objective.progress", {
    label: questObjectiveLabel(objective),
    progress: objective.progress,
    target: objective.target,
  });
}

export function questStatusLabel(status: AuthoredQuestTracker["status"]): string {
  return t(`quest.journal.status.${status}` as MessageKey);
}

export function questScopeLabel(scope: AuthoredQuestTracker["scope"]): string {
  return t(`quest.journal.scope.${scope}` as MessageKey);
}

export interface QuestTrackerNotification {
  text: string;
  tone: "info" | "good" | "bad";
}

/** Diff two authoritative snapshots. Repeated snapshots and reconnects cannot duplicate notices. */
export function questTrackerNotifications(
  previous: readonly AuthoredQuestTracker[] | undefined,
  next: readonly AuthoredQuestTracker[] | undefined,
): QuestTrackerNotification[] {
  if (!previous) return [];
  const before = new Map(previous.map((quest) => [quest.id, quest]));
  const notifications: QuestTrackerNotification[] = [];
  for (const quest of next ?? []) {
    const prior = before.get(quest.id);
    if (!prior) {
      if (quest.status === "active" || quest.status === "ready") {
        notifications.push({
          text: t("quest.notification.accepted", { title: quest.title }),
          tone: "good",
        });
      }
      continue;
    }
    const priorObjectives = new Map(prior.objectives.map((objective) => [objective.id, objective]));
    for (const objective of quest.objectives) {
      const priorObjective = priorObjectives.get(objective.id);
      if (
        (!priorObjective && objective.progress === 0) ||
        objective.progress <= (priorObjective?.progress ?? 0)
      ) {
        continue;
      }
      notifications.push({
        text:
          (priorObjective?.progress ?? 0) < objective.target &&
          objective.progress >= objective.target
            ? t("quest.notification.objectiveComplete", {
                objective: questObjectiveLabel(objective),
              })
            : questObjectiveProgressText(objective),
        tone: "good",
      });
    }
    if (prior.status === quest.status) continue;
    if (quest.status === "ready") {
      notifications.push({
        text: t("quest.notification.ready", { title: quest.title }),
        tone: "good",
      });
    } else if (quest.status === "completed") {
      notifications.push({
        text: t("quest.notification.completed", { title: quest.title }),
        tone: "good",
      });
    } else if (quest.status === "abandoned") {
      notifications.push({
        text: t("quest.notification.abandoned", { title: quest.title }),
        tone: "info",
      });
    } else if (quest.status === "failed") {
      notifications.push({
        text: t("quest.notification.failed", { title: quest.title }),
        tone: "bad",
      });
    }
  }
  return notifications;
}
