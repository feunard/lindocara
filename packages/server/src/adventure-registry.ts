import {
  type AdventureRegistry,
  EMPTY_REGISTRY,
  parseAdventureRegistry,
  reconcileAuthoredQuestVersions,
} from "@lindocara/engine/adventure-state.js";

/** Decode the legacy empty-string sentinel or a defensively parsed registry row. */
export function decodeStoredAdventureRegistry(raw: string): AdventureRegistry {
  if (raw === "") return EMPTY_REGISTRY;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("registry: stored registry is corrupt");
  }
  const registry = parseAdventureRegistry(value);
  if (!registry) throw new Error("registry: stored registry is corrupt");
  return registry;
}

/** Parse an untrusted write and assign quest versions from stored content, never client claims. */
export function prepareAdventureRegistry(
  value: unknown,
  current: AdventureRegistry = EMPTY_REGISTRY,
): AdventureRegistry {
  const parsed = parseAdventureRegistry(value);
  if (!parsed) throw new Error("registry: invalid");
  const quests = reconcileAuthoredQuestVersions(current.quests ?? [], parsed.quests ?? []);
  return {
    switches: parsed.switches,
    variables: parsed.variables,
    ...(quests.length > 0 ? { quests } : {}),
  };
}
