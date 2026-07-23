/**
 * The six chained Brumeval quests, schema v2.
 * Content table: docs/superpowers/specs/2026-07-24-brumeval-adventure-design.md
 */
import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestDialogues,
  QuestEventReference,
} from "@lindocara/engine/quests.js";
import { emptyQuestDialogues, emptyQuestRewards } from "@lindocara/engine/quests.js";
import { AREA_CAMP_GNOLL, type BrumevalRefs, ITEM_FIOLE, SWITCH_MALGRIN } from "./maps.js";

export type MapIdByKey = Record<"abbaye" | "ronceclair" | "antre", string>;

function dialogues(overrides: Partial<QuestDialogues>): QuestDialogues {
  return { ...emptyQuestDialogues(), ...overrides };
}

function quest(
  base: Pick<AuthoredQuestDefinition, "id" | "title" | "description" | "journalSummary">,
  overrides: Partial<AuthoredQuestDefinition>,
): AuthoredQuestDefinition {
  return {
    schemaVersion: 2,
    version: 1,
    recommendedLevel: null,
    scope: "personal",
    repeatable: false,
    abandonable: false,
    acceptance: "manual",
    completion: "turn-in",
    giver: null,
    turnInTarget: null,
    prerequisites: { minLevel: null, previousQuestId: null, mode: "all", conditions: [] },
    objectiveMode: "simultaneous",
    objectives: [],
    rewards: emptyQuestRewards(),
    dialogues: emptyQuestDialogues(),
    ...base,
    ...overrides,
  };
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

function objective(
  id: string,
  rest: DistributiveOmit<
    AuthoredQuestObjective,
    "id" | "label" | "optional" | "hidden" | "stage" | "target"
  > & { target?: number },
): AuthoredQuestObjective {
  return {
    label: "",
    optional: false,
    hidden: false,
    stage: 0,
    target: 1,
    ...rest,
    id,
  } as AuthoredQuestObjective;
}

export function buildQuests(mapId: MapIdByKey, refs: BrumevalRefs): AuthoredQuestDefinition[] {
  const anselme: QuestEventReference = { mapId: mapId.abbaye, eventId: refs.anselme.id };
  const aldric: QuestEventReference = { mapId: mapId.abbaye, eventId: refs.aldric.id };
  const lise: QuestEventReference = { mapId: mapId.antre, eventId: refs.lise.id };
  const malgrin: QuestEventReference = { mapId: mapId.antre, eventId: refs.malgrin.id };

  return [
    quest(
      {
        id: "0001",
        title: "L'appel de Brumeval",
        description:
          "Vous voilà à l'abbaye de Brumeval. Frère Anselme accueille les voyageurs sur le parvis — présentez-vous.",
        journalSummary: "Parler à Frère Anselme, sur le parvis de l'abbaye.",
      },
      {
        acceptance: "automatic",
        completion: "automatic",
        objectives: [
          objective("0001", { type: "interact", interaction: "talk", targetRef: anselme }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 40 },
        dialogues: dialogues({
          completed: "Que la brume te soit légère, voyageur.",
        }),
      },
    ),
    quest(
      {
        id: "0002",
        title: "Des gobelins dans les vignes",
        description:
          "Des gobelins pillards saccagent les vignes de l'abbaye. Frère Anselme cherche un bras armé pour les chasser.",
        journalSummary: "Chasser 5 gobelins pillards des vignes de l'abbaye.",
      },
      {
        giver: anselme,
        turnInTarget: anselme,
        prerequisites: {
          minLevel: null,
          previousQuestId: "0001",
          mode: "all",
          conditions: [],
        },
        objectives: [
          objective("0001", {
            type: "kill",
            species: "spear_goblin",
            mapScope: { kind: "maps", mapIds: [mapId.abbaye] },
            credit: "nearby-party",
            target: 5,
          }),
        ],
        rewards: {
          ...emptyQuestRewards(),
          experience: 120,
          gold: 40,
          items: [{ itemId: ITEM_FIOLE, quantity: 2 }],
        },
        dialogues: dialogues({
          offer:
            "Les vignes nourrissent l'abbaye, et ces gobelins les mettent en pièces. Chasse-les, je t'en prie.",
          accepted: "Le Ciel guide ta lame. Ils rôdent entre les rangs de vigne, à l'est.",
          refused: "Je comprends. Les vignes attendront... tant qu'il en restera.",
          reminder: "Les gobelins rôdent toujours dans les vignes, à l'est du parvis.",
          ready: "Les vignes sont calmes — c'est ton œuvre ?",
          turnIn: "Cinq pillards en moins ! Tiens, des fioles de notre cave. Tu les as méritées.",
          completed: "Les vignes te doivent leur paix.",
          unavailable: "Présente-toi d'abord, voyageur.",
        }),
      },
    ),
    quest(
      {
        id: "0003",
        title: "Rapport au maréchal",
        description:
          "Frère Anselme veut que le maréchal Aldric, qui garde la porte sud, apprenne ce que vous avez vu dans les vignes.",
        journalSummary: "Faire son rapport au maréchal Aldric, à la porte sud.",
      },
      {
        giver: anselme,
        turnInTarget: aldric,
        prerequisites: {
          minLevel: null,
          previousQuestId: "0002",
          mode: "all",
          conditions: [],
        },
        objectives: [
          objective("0001", { type: "interact", interaction: "talk", targetRef: aldric }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 60 },
        dialogues: dialogues({
          offer:
            "Ces pillards n'étaient qu'une avant-garde, j'en ai peur. Va prévenir le maréchal Aldric, à la porte sud.",
          accepted: "Dis-lui tout : le nombre, les lances, la direction d'où ils venaient.",
          refused: "Aldric doit pourtant savoir...",
          reminder: "Aldric garde la porte sud. Il attend ton rapport.",
          ready: "Un rapport ? Parle, voyageur.",
          turnIn: "Des lances gobelines dans les vignes... C'est Ronceclair qui déborde. Merci du rapport.",
          completed: "Ton rapport a été précieux.",
          unavailable: "Occupe-toi d'abord des vignes.",
        }),
      },
    ),
    quest(
      {
        id: "0004",
        title: "La route de Ronceclair",
        description:
          "Le maréchal veut rouvrir la route du sud : réduire le camp gobelin de Ronceclair et récupérer les fioles de soin volées à l'abbaye.",
        journalSummary:
          "Abattre 4 gobelins incendiaires et récupérer 3 fioles volées dans la forêt de Ronceclair.",
      },
      {
        giver: aldric,
        completion: "automatic",
        prerequisites: {
          minLevel: null,
          previousQuestId: "0003",
          mode: "all",
          conditions: [],
        },
        objectives: [
          objective("0001", {
            type: "kill",
            species: "torch_goblin",
            mapScope: { kind: "maps", mapIds: [mapId.ronceclair] },
            credit: "nearby-party",
            target: 4,
          }),
          objective("0002", {
            type: "collect",
            itemId: ITEM_FIOLE,
            counting: "acquired",
            target: 3,
          }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 200, gold: 60, nextQuestId: "0005" },
        dialogues: dialogues({
          offer:
            "La route du sud traverse Ronceclair. Un camp gobelin la tient : des incendiaires, et nos fioles volées dans leurs caches. Rends-nous les deux.",
          accepted: "Prends la porte sud. Et méfie-toi des torches — elles brûlent plus que les lances.",
          refused: "La route restera coupée, alors.",
          reminder: "Le camp gobelin tient toujours la route, au cœur de Ronceclair.",
          completed: "La route respire enfin.",
          unavailable: "Fais d'abord ton rapport.",
        }),
      },
    ),
    quest(
      {
        id: "0005",
        title: "Repérage du camp gnoll",
        description:
          "Des gnolls maraudeurs tiennent l'est de Ronceclair. Avant tout assaut, il faut approcher leur camp et jauger leurs forces.",
        journalSummary:
          "Atteindre la lisière du camp gnoll et abattre 3 gnolls maraudeurs à l'est de Ronceclair.",
      },
      {
        acceptance: "automatic",
        completion: "automatic",
        prerequisites: {
          minLevel: null,
          previousQuestId: "0004",
          mode: "all",
          conditions: [],
        },
        objectives: [
          objective("0001", {
            type: "reach",
            destination: { kind: "area", mapId: mapId.ronceclair, areaId: AREA_CAMP_GNOLL },
          }),
          objective("0002", {
            type: "kill",
            species: "gnoll_marauder",
            mapScope: { kind: "maps", mapIds: [mapId.ronceclair] },
            credit: "nearby-party",
            target: 3,
          }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 240, gold: 80, nextQuestId: "0006" },
        dialogues: dialogues({}),
      },
    ),
    quest(
      {
        id: "0006",
        title: "Le seigneur de la meute",
        description:
          "Les gnolls répondaient à Malgrin, un minotaure retranché dans son antre à l'est. Tant qu'il vit, la vallée tremble. L'éclaireuse Lise guette près de l'entrée.",
        journalSummary: "Vaincre Malgrin dans son antre, puis retrouver l'éclaireuse Lise.",
      },
      {
        scope: "party",
        acceptance: "automatic",
        completion: "turn-in",
        turnInTarget: lise,
        prerequisites: {
          minLevel: null,
          previousQuestId: "0005",
          mode: "all",
          conditions: [],
        },
        objectives: [
          objective("0001", {
            type: "defeat-target",
            targetRef: malgrin,
            credit: "nearby-party",
          }),
        ],
        rewards: {
          ...emptyQuestRewards(),
          experience: 500,
          gold: 150,
          items: [{ itemId: ITEM_FIOLE, quantity: 3 }],
          stateChanges: [{ type: "switch", switchId: SWITCH_MALGRIN, value: true }],
        },
        dialogues: dialogues({
          ready: "Le sol a tremblé, puis plus rien... Il est tombé, n'est-ce pas ?",
          turnIn: "Alors la meute n'a plus de seigneur. Brumeval est libre — grâce à toi.",
          completed: "La vallée est libre.",
          unavailable: "Reviens quand la meute n'aura plus de chef.",
        }),
      },
    ),
  ];
}

export interface Registry {
  switches: { id: string; name: string }[];
  variables: { id: string; name: string }[];
  quests: AuthoredQuestDefinition[];
}

export function buildRegistry(mapId: MapIdByKey, refs: BrumevalRefs): Registry {
  return {
    switches: [{ id: SWITCH_MALGRIN, name: "Malgrin vaincu" }],
    variables: [],
    quests: buildQuests(mapId, refs),
  };
}
