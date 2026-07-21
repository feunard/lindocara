import type { QuestChapter } from "@lindocara/engine/game.js";
import type { ZoneDefinition } from "@lindocara/engine/zones.js";

export function questDefinition(zone: ZoneDefinition, chapter: QuestChapter) {
  return zone.quests.find((quest) => quest.id === chapter);
}

export function nextQuestChapter(zone: ZoneDefinition, chapter: QuestChapter): QuestChapter | null {
  const chapters = zone.quests.map((quest) => quest.id);
  const index = chapters.indexOf(chapter);
  return chapters[index + 1] ?? null;
}
