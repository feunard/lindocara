/**
 * Sombregué's chain: seven quests that walk the archipelago from the port to the warchief, and that
 * introduce the Goblin Raiders warband one species at a time — spear, torch, pig, rider, shaman.
 *
 * The shape follows the pack's own escalation. A pillager is a nuisance; a drove of pigs is a
 * problem; a shaman-warded camp is a siege. Every quest names a real objective type the runtime
 * already resolves: kill by species, collect by item, talk to an event, reach an area, defeat a
 * specific event.
 */
import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestDialogues,
  QuestEventReference,
} from "@lindocara/engine/quests.js";
import { emptyQuestDialogues, emptyQuestRewards } from "@lindocara/engine/quests.js";

import { AREA_CAMP, ITEM_CRATE, type MapKey, SWITCH_GRUMLOK, type WorldRefs } from "./maps.js";

export type MapIdByKey = Record<MapKey, string>;

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
    category: "main",
    region: "Sombregué",
    landmark: "",
    giverName: "",
    knownConsequence: "",
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
  return { label: "", optional: false, hidden: false, stage: 0, target: 1, ...rest, id };
}

function after(previousQuestId: string): AuthoredQuestDefinition["prerequisites"] {
  return { minLevel: null, previousQuestId, mode: "all", conditions: [] };
}

export function buildQuests(mapId: MapIdByKey, refs: WorldRefs): AuthoredQuestDefinition[] {
  const capitaine: QuestEventReference = {
    mapId: mapId.port,
    eventId: refs.npc.capitaine?.id ?? "",
  };
  const osmond: QuestEventReference = { mapId: mapId.port, eventId: refs.npc.osmond?.id ?? "" };
  const wynn: QuestEventReference = { mapId: mapId.bois, eventId: refs.npc.wynn?.id ?? "" };
  const wynnEperon: QuestEventReference = {
    mapId: mapId.eperon,
    eventId: refs.npc.wynnEperon?.id ?? "",
  };
  const grumlok: QuestEventReference = { mapId: mapId.eperon, eventId: refs.grumlok.id };

  return [
    quest(
      {
        id: "0001",
        title: "Débarquer à Port-Aubépine",
        description:
          "Le quai sent le goudron et la peur. Le capitaine Vaudray tient la porte du fort — présentez-vous à lui.",
        journalSummary: "Parler au capitaine Vaudray, sur le parvis du fort.",
      },
      {
        acceptance: "automatic",
        completion: "automatic",
        objectives: [
          objective("0001", { type: "interact", interaction: "talk", targetRef: capitaine }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 40 },
        dialogues: dialogues({ completed: "Que la marée te soit douce." }),
      },
    ),
    quest(
      {
        id: "0002",
        title: "Les pillards de la Grève",
        description:
          "Des gobelins à lance ont éventré les caisses de vivres échouées sur la Grève aux Épaves. Vaudray veut la plage nette.",
        journalSummary: "Abattre 5 pillards à lance sur la Grève aux Épaves.",
      },
      {
        giver: capitaine,
        turnInTarget: capitaine,
        prerequisites: after("0001"),
        objectives: [
          objective("0001", {
            type: "kill",
            species: "spear_goblin",
            target: 5,
            mapScope: { kind: "maps", mapIds: [mapId.greve] },
            credit: "nearby-party",
          }),
        ],
        rewards: {
          ...emptyQuestRewards(),
          experience: 120,
          gold: 45,
          items: [{ itemId: ITEM_CRATE, quantity: 2 }],
        },
        dialogues: dialogues({
          offer:
            "Cinq lances rôdent entre les épaves. Va les chercher, et la grève redeviendra une grève.",
          accepted: "Prends le passage à l’est du port. Ils ne se cachent même plus.",
          refused: "Alors ils reviendront. Ils reviennent toujours.",
          reminder: "Les pillards tiennent toujours la Grève aux Épaves.",
          ready: "La plage est calme. C’est ton œuvre ?",
          turnIn: "Cinq de moins. Frère Osmond va vouloir te parler de ses caisses.",
          completed: "La grève te doit sa paix.",
          unavailable: "Présente-toi d’abord, voyageur.",
        }),
      },
    ),
    quest(
      {
        id: "0003",
        title: "Ce qu’il reste des vivres",
        description:
          "Frère Osmond compte ses pertes. Trois caisses ont survécu au pillage, quelque part sur la grève.",
        journalSummary: "Récupérer 3 caisses de vivres sur la Grève aux Épaves.",
      },
      {
        giver: osmond,
        turnInTarget: osmond,
        prerequisites: after("0002"),
        objectives: [
          objective("0001", {
            type: "collect",
            itemId: ITEM_CRATE,
            target: 3,
            counting: "acquired",
          }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 90, gold: 30 },
        dialogues: dialogues({
          offer: "Trois caisses, mon enfant. Trois. Le fort mange dessus tout l’hiver.",
          accepted: "Elles sont marquées du sceau d’Aubépine. Tu ne peux pas les manquer.",
          refused: "Le Ciel y pourvoira. Peut-être.",
          reminder: "Il reste des caisses à retrouver sur la grève.",
          ready: "Tu les as toutes ? Béni sois-tu.",
          turnIn: "Trois caisses. L’hiver sera moins long. Merci.",
          completed: "Le cellier te salue.",
          unavailable: "Nettoie d’abord la plage.",
        }),
      },
    ),
    quest(
      {
        id: "0004",
        title: "Le bois qui brûle",
        description:
          "Au-delà de la grève, le Bois de Ronceleau part en fumée : les incendiaires y allument ce qu’ils ne peuvent pas emporter.",
        journalSummary:
          "Abattre 4 incendiaires dans le Bois de Ronceleau, puis trouver l’éclaireuse Wynn.",
      },
      {
        giver: capitaine,
        turnInTarget: wynn,
        prerequisites: after("0003"),
        objectives: [
          objective("0001", {
            type: "kill",
            species: "torch_goblin",
            target: 4,
            mapScope: { kind: "maps", mapIds: [mapId.bois] },
            credit: "nearby-party",
          }),
          objective("0002", { type: "interact", interaction: "talk", targetRef: wynn }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 200, gold: 60 },
        dialogues: dialogues({
          offer:
            "Le bois brûle depuis trois nuits. Mon éclaireuse est là-bas quelque part — trouve-la, et éteins ces torches.",
          accepted: "Wynn se poste toujours sous couvert. Cherche l’ombre la plus immobile.",
          refused: "Le bois brûlera sans toi, alors.",
          reminder: "Des torches courent toujours sous les ronces.",
          ready: "",
          turnIn: "Tu as vu la fumée à l’est ? Ce sont leurs enclos. Ils élèvent des sangliers.",
          completed: "Le bois fume encore, mais il tient.",
          unavailable: "Occupe-toi d’abord des vivres.",
        }),
      },
    ),
    quest(
      {
        id: "0005",
        title: "Briser la meute",
        description:
          "Les Enclos fournissent la cavalerie du warband. Sans montures, les chevaucheurs ne sont plus que des gobelins à pied.",
        journalSummary: "Abattre 4 sangliers et 3 chevaucheurs dans les Enclos.",
      },
      {
        giver: wynn,
        turnInTarget: wynn,
        prerequisites: after("0004"),
        objectives: [
          objective("0001", {
            type: "kill",
            species: "war_pig",
            target: 4,
            mapScope: { kind: "maps", mapIds: [mapId.enclos] },
            credit: "nearby-party",
          }),
          objective("0002", {
            type: "kill",
            species: "pig_rider",
            target: 3,
            mapScope: { kind: "maps", mapIds: [mapId.enclos] },
            credit: "nearby-party",
          }),
        ],
        rewards: {
          ...emptyQuestRewards(),
          experience: 280,
          gold: 90,
          items: [{ itemId: ITEM_CRATE, quantity: 2 }],
        },
        dialogues: dialogues({
          offer:
            "Coupe-leur les jambes : les bêtes d’abord, les cavaliers ensuite. Un chevaucheur à pied, ça se rattrape.",
          accepted:
            "Méfie-toi des sangliers. Ils chargent avant de réfléchir — c’est leur seule ruse.",
          refused: "Ils reviendront en selle, alors.",
          reminder: "Les enclos tournent toujours à plein.",
          ready: "Plus un grognement là-bas. Bien.",
          turnIn: "La meute est brisée. Reste le camp — et ce qui le garde.",
          completed: "Les enclos sont vides.",
          unavailable: "Éteins d’abord le bois.",
        }),
      },
    ),
    quest(
      {
        id: "0006",
        title: "Les gardiens du camp",
        description:
          "Trois chamanes tiennent le camp de Grumlok sous ward. Tant qu’ils psalmodient, l’Éperon reste fermé.",
        journalSummary: "Atteindre la lisière du camp et abattre 3 chamanes des maléfices.",
      },
      {
        giver: wynn,
        turnInTarget: null,
        completion: "automatic",
        prerequisites: after("0005"),
        objectives: [
          objective("0001", {
            type: "reach",
            destination: { kind: "area", mapId: mapId.camp, areaId: AREA_CAMP },
          }),
          objective("0002", {
            type: "kill",
            species: "hex_shaman",
            target: 3,
            mapScope: { kind: "maps", mapIds: [mapId.camp] },
            credit: "nearby-party",
          }),
        ],
        rewards: { ...emptyQuestRewards(), experience: 340, gold: 110 },
        dialogues: dialogues({
          offer:
            "Leurs chamanes jettent un ward sur le passage. Abats-les et l’Éperon s’ouvrira de lui-même.",
          accepted: "Ils frappent de loin et meurent vite. Va au contact.",
          refused: "Le ward tiendra, alors.",
          reminder: "Le camp psalmodie toujours.",
          completed: "Le ward est rompu.",
          unavailable: "Brise d’abord la meute.",
        }),
      },
    ),
    quest(
      {
        id: "0007",
        title: "Grumlok, chef de guerre",
        description:
          "Il attend sur l’Éperon, seul, parce qu’il n’a jamais eu besoin de plus. Abattez-le et l’archipel respirera.",
        journalSummary: "Vaincre Grumlok sur l’Éperon, puis retrouver Wynn.",
      },
      {
        scope: "party",
        acceptance: "automatic",
        completion: "turn-in",
        turnInTarget: wynnEperon,
        prerequisites: after("0006"),
        objectives: [
          objective("0001", {
            type: "defeat-target",
            targetRef: grumlok,
            credit: "nearby-party",
          }),
        ],
        rewards: {
          ...emptyQuestRewards(),
          experience: 600,
          gold: 200,
          items: [{ itemId: ITEM_CRATE, quantity: 3 }],
          stateChanges: [{ type: "switch", switchId: SWITCH_GRUMLOK, value: true }],
        },
        dialogues: dialogues({
          ready: "Le sol a tremblé, puis plus rien. Il est tombé, n’est-ce pas ?",
          turnIn: "Alors le warband n’a plus de chef. Sombregué est libre — grâce à toi.",
          unavailable: "Reviens quand le camp se taira.",
        }),
      },
    ),
  ];
}
