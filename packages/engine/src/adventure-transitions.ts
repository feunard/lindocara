import type { AdventureBundleMap } from "./adventure-bundle.js";
import type { EventCommand, TransitionCategory } from "./event-commands.js";

export interface AuthoredTransition {
  readonly sourceMapId: string;
  readonly sourceEventId: string;
  readonly sourceName: string;
  readonly destinationMapId: string;
  readonly destinationCol: number;
  readonly destinationRow: number;
  readonly category: TransitionCategory;
}

export interface AuthoredTransitionGraph {
  readonly mapIds: readonly string[];
  readonly links: readonly AuthoredTransition[];
}

function visitTeleports(
  commands: readonly EventCommand[],
  visitor: (command: Extract<EventCommand, { t: "teleport" }>) => void,
): void {
  for (const command of commands) {
    if (command.t === "teleport") {
      visitor(command);
    } else if (command.t === "if") {
      visitTeleports(command.then, visitor);
      visitTeleports(command.else, visitor);
    } else if (command.t === "loop") {
      visitTeleports(command.body, visitor);
    } else if (command.t === "choices") {
      for (const option of command.options) visitTeleports(option.body, visitor);
    }
  }
}

/**
 * Builds a readable travel graph from the teleports players can actually trigger.
 *
 * The obsolete adventure exit graph cannot express conditional story gates. This derived graph
 * keeps those gates authoritative in their event pages, retains the authored passage category and
 * deliberately drops same-map puzzle/recovery jumps from the world topology.
 */
export function buildAuthoredTransitionGraph(
  maps: readonly AdventureBundleMap[],
): AuthoredTransitionGraph {
  const links = new Map<string, AuthoredTransition>();
  for (const map of maps) {
    for (const event of map.events) {
      for (const page of event.pages) {
        visitTeleports(page.commands, (command) => {
          const category = command.category ?? "geographic";
          if (command.mapId === map.id || category === "puzzle" || category === "recovery") {
            return;
          }
          const link: AuthoredTransition = {
            sourceMapId: map.id,
            sourceEventId: event.id,
            sourceName: event.name,
            destinationMapId: command.mapId,
            destinationCol: command.col,
            destinationRow: command.row,
            category,
          };
          const key = [
            link.sourceMapId,
            link.sourceEventId,
            link.destinationMapId,
            link.destinationCol,
            link.destinationRow,
            link.category,
          ].join(":");
          links.set(key, link);
        });
      }
    }
  }
  return {
    mapIds: maps.map((map) => map.id),
    links: [...links.values()],
  };
}

export function reachableTransitionMaps(
  graph: AuthoredTransitionGraph,
  startMapId: string,
): ReadonlySet<string> {
  const reached = new Set([startMapId]);
  const queue = [startMapId];
  while (queue.length > 0) {
    const source = queue.shift();
    if (!source) continue;
    for (const link of graph.links) {
      if (link.sourceMapId !== source || reached.has(link.destinationMapId)) continue;
      reached.add(link.destinationMapId);
      queue.push(link.destinationMapId);
    }
  }
  return reached;
}
