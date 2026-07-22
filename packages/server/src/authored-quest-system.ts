import type {
  AdventureRegistry,
  AuthoredQuestProgress,
  PartyAdventureState,
} from "@lindocara/engine/adventure-state.js";
import {
  applyQuestBusinessEvent,
  completedQuestIds,
  createAuthoredQuestProgress,
  type QuestActor,
  type QuestBusinessEvent,
  type QuestObjectiveIndex,
  questEventActors,
  questObjectiveCandidates,
  questPrerequisitesHold,
} from "@lindocara/engine/quest-runtime.js";
import type { AuthoredQuestDefinition } from "@lindocara/engine/quests.js";

export interface AuthoredQuestChange {
  readonly scope: "party" | "personal";
  readonly heroId?: string;
  readonly questId: string;
  readonly objectiveIds: readonly string[];
  readonly status: AuthoredQuestProgress["status"];
}

export interface PersonalQuestUpdate {
  readonly actor: QuestActor;
  readonly progress: Record<string, AuthoredQuestProgress>;
}

export interface AuthoredQuestEventResult {
  readonly partyState: PartyAdventureState;
  readonly partyChanged: boolean;
  readonly personalUpdates: readonly PersonalQuestUpdate[];
  readonly changes: readonly AuthoredQuestChange[];
}

export interface AuthoredQuestEventContext {
  readonly registry: AdventureRegistry;
  readonly partyState: PartyAdventureState;
  readonly currentIndex: QuestObjectiveIndex;
  readonly partyPinnedIndex: QuestObjectiveIndex;
  readonly event: QuestBusinessEvent;
  readonly indexForDefinition: (definition: AuthoredQuestDefinition) => QuestObjectiveIndex;
  readonly loadPersonal: (actor: QuestActor) => Promise<Record<string, AuthoredQuestProgress>>;
  readonly personalPinnedIndex: (actor: QuestActor) => QuestObjectiveIndex;
  readonly savePersonal: (
    actor: QuestActor,
    questId: string,
    progress: AuthoredQuestProgress,
  ) => Promise<boolean>;
}

function eventActors(event: QuestBusinessEvent): QuestActor[] {
  const values =
    event.type === "monsterKilled" || event.type === "bossDefeated"
      ? [event.killer, ...event.contributors, ...event.nearbyParty]
      : [event.actor];
  const actors = new Map<string, QuestActor>();
  for (const actor of values) actors.set(actor.heroId, actor);
  return [...actors.values()];
}

function objectiveIdsFor(
  definition: AuthoredQuestDefinition,
  index: QuestObjectiveIndex,
  event: QuestBusinessEvent,
  heroId?: string,
): string[] {
  const ids: string[] = [];
  for (const candidate of questObjectiveCandidates(index, event)) {
    if (candidate.questId !== definition.id) continue;
    const objective = definition.objectives.find((item) => item.id === candidate.objectiveId);
    if (!objective) continue;
    const actors = questEventActors(objective, event);
    if (
      heroId === undefined ? actors.length > 0 : actors.some((actor) => actor.heroId === heroId)
    ) {
      ids.push(objective.id);
    }
  }
  return ids;
}

function candidateQuestIds(index: QuestObjectiveIndex, event: QuestBusinessEvent): Set<string> {
  return new Set(questObjectiveCandidates(index, event).map((candidate) => candidate.questId));
}

function prerequisitesHold(
  definition: AuthoredQuestDefinition,
  actor: QuestActor,
  personal: Readonly<Record<string, AuthoredQuestProgress>>,
  partyState: PartyAdventureState,
): boolean {
  const completed = new Set([
    ...completedQuestIds(personal),
    ...completedQuestIds(partyState.quests),
  ]);
  return questPrerequisitesHold(definition, {
    level: actor.level,
    completedQuestIds: completed,
    adventureState: partyState,
  });
}

/**
 * Process one authoritative business event. Candidate discovery is index-based; the only progress
 * rows inspected beyond those candidates are active pinned snapshots, whose target may differ from
 * the current adventure version.
 */
export async function processAuthoredQuestEvent(
  context: AuthoredQuestEventContext,
): Promise<AuthoredQuestEventResult> {
  const definitions = new Map((context.registry.quests ?? []).map((quest) => [quest.id, quest]));
  const actors = eventActors(context.event);
  const representative = actors[0];
  const currentCandidates = candidateQuestIds(context.currentIndex, context.event);
  const partyQuests = { ...(context.partyState.quests ?? {}) };
  let partyChanged = false;
  const changes: AuthoredQuestChange[] = [];

  // The coordinator builds this pinned index once when it loads the save. No per-event quest scan.
  const partyCandidates = new Set([
    ...currentCandidates,
    ...candidateQuestIds(context.partyPinnedIndex, context.event),
  ]);

  for (const questId of partyCandidates) {
    let progress = partyQuests[questId];
    const wasNew = progress === undefined;
    const definition = progress?.definitionSnapshot ?? definitions.get(questId);
    if (definition?.scope !== "party") continue;
    const index = context.indexForDefinition(definition);
    const objectiveIds = objectiveIdsFor(definition, index, context.event);
    if (objectiveIds.length === 0) continue;
    if (!progress) {
      if (
        definition.acceptance !== "automatic" ||
        !representative ||
        !prerequisitesHold(definition, representative, {}, context.partyState)
      ) {
        continue;
      }
      progress = createAuthoredQuestProgress(definition);
    }
    const applied = applyQuestBusinessEvent(definition, progress, context.event, objectiveIds);
    if (!applied.eventConsumed) continue;
    partyQuests[questId] = applied.progress;
    partyChanged = true;
    if (
      wasNew ||
      applied.changedObjectiveIds.length > 0 ||
      applied.progress.status !== progress.status
    ) {
      changes.push({
        scope: "party",
        questId,
        objectiveIds: applied.changedObjectiveIds,
        status: applied.progress.status,
      });
    }
  }

  const partyState = partyChanged
    ? { ...context.partyState, quests: partyQuests }
    : context.partyState;
  const personalUpdates: PersonalQuestUpdate[] = [];
  for (const actor of actors) {
    const stored = await context.loadPersonal(actor);
    const personal = { ...stored };
    const personalCandidates = new Set([
      ...currentCandidates,
      ...candidateQuestIds(context.personalPinnedIndex(actor), context.event),
    ]);
    let personalChanged = false;
    for (const questId of personalCandidates) {
      let progress = personal[questId];
      const wasNew = progress === undefined;
      const definition = progress?.definitionSnapshot ?? definitions.get(questId);
      if (definition?.scope !== "personal") continue;
      const objectiveIds = objectiveIdsFor(
        definition,
        context.indexForDefinition(definition),
        context.event,
        actor.heroId,
      );
      if (objectiveIds.length === 0) continue;
      if (!progress) {
        if (
          definition.acceptance !== "automatic" ||
          !prerequisitesHold(definition, actor, personal, partyState)
        ) {
          continue;
        }
        progress = createAuthoredQuestProgress(definition);
      }
      const applied = applyQuestBusinessEvent(definition, progress, context.event, objectiveIds);
      if (!applied.eventConsumed) continue;
      if (!(await context.savePersonal(actor, questId, applied.progress))) continue;
      personal[questId] = applied.progress;
      personalChanged = true;
      if (
        wasNew ||
        applied.changedObjectiveIds.length > 0 ||
        applied.progress.status !== progress.status
      ) {
        changes.push({
          scope: "personal",
          heroId: actor.heroId,
          questId,
          objectiveIds: applied.changedObjectiveIds,
          status: applied.progress.status,
        });
      }
    }
    if (personalChanged) personalUpdates.push({ actor, progress: personal });
  }

  return { partyState, partyChanged, personalUpdates, changes };
}
