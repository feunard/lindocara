/**
 * Les sept quêtes de la Baie.
 *
 * Une décision d'authoring gouverne tout ce fichier : **aucune quête n'est liée par `giver` ni par
 * `turnInTarget`.** Le panneau de quête d'un PNJ lié capture son interaction pour de bon, ce qui
 * tuerait les dialogues à pages conditionnelles qui portent l'histoire (Ondine change trois fois de
 * réplique, Saline deux). Les quêtes sont donc liées par COMMANDE — `startQuest` dans la réplique
 * qui les propose, `completeQuest` dans celle qui les solde — ce que le validateur accepte
 * explicitement (`offeredQuestIds` / `turnInQuestIds`).
 *
 * Les objectifs sont écrits contre des faits que le serveur émet lui-même : `completeActivity`,
 * `enterArea`, la mort d'une espèce ou d'un événement-monstre précis. Jamais un objectif `manual`,
 * qui ne serait qu'une case à cocher que rien ne coche.
 */
import type { AdventureBundleMap } from "@lindocara/engine/adventure-bundle.js";
import {
  type AuthoredQuestDefinition,
  type AuthoredQuestObjective,
  emptyQuestDialogues,
  QUEST_SCHEMA_VERSION,
  type QuestDialogues,
  type QuestPrerequisiteCondition,
  type QuestRewards,
} from "@lindocara/engine/quests.js";
import { MAP_IDS, Q, S, type StoryRefs, V } from "./campaign.js";

interface QuestSpec {
  id: string;
  title: string;
  description: string;
  journalSummary: string;
  recommendedLevel: number;
  objectives: readonly AuthoredQuestObjective[];
  rewards: Partial<QuestRewards>;
  dialogues: Partial<QuestDialogues>;
  previousQuestId?: string;
  conditions?: readonly QuestPrerequisiteCondition[];
  completion?: "automatic" | "turn-in";
  objectiveMode?: "simultaneous" | "sequential";
}

function quest(spec: QuestSpec): AuthoredQuestDefinition {
  return {
    schemaVersion: QUEST_SCHEMA_VERSION,
    version: 1,
    id: spec.id,
    title: spec.title,
    description: spec.description,
    journalSummary: spec.journalSummary,
    category: "main",
    region: "Baie des Cent Voiles",
    landmark: "",
    giverName: "",
    knownConsequence: "",
    recommendedLevel: spec.recommendedLevel,
    scope: "party",
    repeatable: false,
    abandonable: false,
    // Proposée par une réplique (`startQuest`), soldée par les faits ou par une réplique.
    acceptance: "manual",
    completion: spec.completion ?? "automatic",
    giver: null,
    turnInTarget: null,
    prerequisites: {
      minLevel: null,
      previousQuestId: spec.previousQuestId ?? null,
      mode: "all",
      conditions: spec.conditions ?? [],
    },
    objectiveMode: spec.objectiveMode ?? "simultaneous",
    objectives: spec.objectives,
    rewards: {
      experience: 0,
      gold: 0,
      items: [],
      choices: [],
      nextQuestId: null,
      stateChanges: [],
      customCommands: [],
      ...spec.rewards,
    },
    dialogues: { ...emptyQuestDialogues(), ...spec.dialogues },
  };
}

const base = { label: "", optional: false, hidden: false, stage: 0 } as const;

export function buildQuests(refs: StoryRefs): AuthoredQuestDefinition[] {
  const ref = (key: string): { mapId: string; eventId: string } => {
    const event = refs[key];
    if (!event) throw new Error(`quête : événement inconnu « ${key} »`);
    const mapKey = key.split(".")[0] as keyof typeof MAP_IDS;
    return { mapId: MAP_IDS[mapKey], eventId: event.id };
  };

  return [
    quest({
      id: Q.castaways,
      title: "Les naufragés de la grève",
      description:
        "Le récif a ouvert la coque en deux et la grève est pleine de gens qui respirent encore. Bosco ne peut plus marcher : il compte les vagues en attendant que quelqu’un ramène les trois autres.",
      journalSummary: "Secourir les trois naufragés échoués sur la Grève des Épaves.",
      recommendedLevel: 1,
      objectives: [
        {
          ...base,
          id: "0001",
          type: "activity",
          activityId: "naufrage_secouru",
          target: 3,
          label: "Naufragés secourus",
        },
      ],
      rewards: {
        experience: 150,
        gold: 40,
        items: [{ itemId: "health_potion", quantity: 2 }],
        stateChanges: [{ type: "switch", switchId: S.castawaysRescued, value: true }],
      },
      dialogues: {
        offer:
          "Trois des nôtres ne se sont pas relevés. Ils respirent encore, je les entends d’ici.",
        accepted: "Allez. Je compte les vagues en vous attendant.",
        reminder: "Ils sont sur la grève, entre les épaves. Cherchez ce qui bouge.",
        ready: "Trois sauvés, trois debout. Vous avez fait ce qu’il fallait.",
      },
    }),

    quest({
      id: Q.oil,
      title: "L’huile du fanal",
      description:
        "Le miroir de Malemer ne s’allume pas sans huile, et l’huile du phare a été prise aux Brisants. Ondine ne montera pas au rocher les mains vides.",
      journalSummary: "Gagner les Brisants et récupérer les barriques d’huile du phare.",
      recommendedLevel: 3,
      previousQuestId: Q.castaways,
      objectiveMode: "sequential",
      objectives: [
        {
          ...base,
          id: "0001",
          type: "reach",
          destination: { kind: "map", mapId: MAP_IDS.reefs },
          label: "Débarquer aux Brisants",
          target: 1,
          stage: 0,
        },
        {
          ...base,
          id: "0002",
          type: "activity",
          activityId: "huile_recuperee",
          label: "Barriques d’huile récupérées",
          target: 1,
          stage: 1,
        },
      ],
      rewards: {
        experience: 260,
        gold: 70,
        stateChanges: [{ type: "variable", variableId: V.allies, op: "add", value: 1 }],
      },
      dialogues: {
        offer:
          "Il me faut l’huile du fanal. Elle est aux Brisants, dans les mains de ceux qui l’ont prise.",
        accepted: "La chaloupe est à vous. Ramenez les barriques entières.",
        reminder: "Les barriques portent le fer du phare. Vous ne pouvez pas les confondre.",
        ready: "De l’huile pour trois hivers. Il ne manque plus que le verre.",
      },
    }),

    quest({
      id: Q.bridge,
      title: "La passerelle des Brisants",
      description:
        "Les deux travées centrales de la passerelle ont été sciées du côté est — pour que personne n’aille voir. Maître Galiane la remonterait avant la marée si on lui disait ce qu’il en reste.",
      journalSummary: "Examiner la passerelle brisée des Brisants pour Maître Galiane.",
      recommendedLevel: 3,
      conditions: [{ type: "switch", switchId: S.ondineAllied, value: true }],
      objectives: [
        {
          ...base,
          id: "0001",
          type: "interact",
          interaction: "interact",
          targetRef: ref("reefs.footbridge"),
          label: "Examiner la passerelle sciée",
          target: 1,
        },
      ],
      rewards: {
        experience: 180,
        gold: 50,
        stateChanges: [{ type: "switch", switchId: S.reefBridge, value: true }],
      },
      dialogues: {
        offer: "Dites-moi ce qu’il reste de la passerelle et je la remonte.",
        accepted: "Regardez les coupes. On saura qui a scié, et de quel côté.",
        reminder: "La passerelle est au milieu du chenal. Difficile de la manquer.",
        ready: "Sciée à l’est, proprement. Je m’en occupe.",
      },
    }),

    quest({
      id: Q.camp,
      title: "Le croissant renversé",
      description:
        "Les pillards des Brisants n’entassent pas du butin : ils entassent de l’huile, des cordages et de la poix. On ne prépare pas un pillage avec ça. Grish, leur brûleur de fanaux, saura pour qui.",
      journalSummary: "Briser le camp des Brisants et abattre Grish, brûleur de fanaux.",
      recommendedLevel: 5,
      previousQuestId: Q.oil,
      objectiveMode: "sequential",
      // Un choix de récompense n'existe qu'au rendu de quête : c'est le moment où l'on tend la main.
      // C'est aussi ce que le validateur exige (`quest.reward.choices_require_turn_in`).
      completion: "turn-in",
      objectives: [
        {
          ...base,
          id: "0001",
          type: "kill",
          species: "spear_goblin",
          label: "Pillards des Brisants abattus",
          mapScope: { kind: "maps", mapIds: [MAP_IDS.reefs] },
          credit: "contributors",
          target: 3,
          stage: 0,
        },
        {
          ...base,
          id: "0002",
          type: "defeat-target",
          targetRef: ref("reefs.shaman"),
          label: "Grish, brûleur de fanaux",
          credit: "contributors",
          target: 1,
          stage: 1,
        },
      ],
      rewards: {
        experience: 520,
        gold: 160,
        // Un vrai choix de récompense : la seule quête qui en propose un, à la fin de l'acte I.
        choices: [
          {
            id: "0001",
            label: "La prime de la capitaine (or)",
            experience: 0,
            gold: 120,
            items: [],
          },
          {
            id: "0002",
            label: "Le coffre du brûleur (fioles)",
            experience: 60,
            gold: 0,
            items: [
              { itemId: "health_potion", quantity: 3 },
              { itemId: "damage_elixir", quantity: 1 },
            ],
          },
        ],
        stateChanges: [{ type: "variable", variableId: V.goblinThreat, op: "add", value: 1 }],
      },
      dialogues: {
        offer: "Six nuits de feux qui ne sont pas des feux de pêche. Allez voir de près.",
        accepted: "Comptez leurs barriques avant de compter leurs morts.",
        reminder: "Le camp tient la terrasse, à l’est du chenal.",
        ready: "Le croissant renversé. Alors c’est Varn, et il vient.",
      },
    }),

    quest({
      id: Q.valves,
      title: "Les trois vannes",
      description:
        "Le marais s’est arrêté de respirer : les trois vannes sont prises dans le sel. Sans eau, pas de sel ; sans sel, pas de verre ; sans verre, pas de miroir.",
      journalSummary: "Rouvrir les trois vannes du Marais de Sel.",
      recommendedLevel: 4,
      conditions: [{ type: "switch", switchId: S.ondineAllied, value: true }],
      objectives: [
        {
          ...base,
          id: "0001",
          type: "activity",
          activityId: "vanne_ouverte",
          target: 3,
          label: "Vannes rouvertes",
        },
        // Optionnel et assumé : on peut rouvrir les vannes sans vider le marais de ses trolls.
        {
          ...base,
          id: "0002",
          type: "kill",
          species: "mire_troll",
          label: "Trolls des vases chassés",
          mapScope: { kind: "maps", mapIds: [MAP_IDS.marsh] },
          credit: "contributors",
          target: 3,
          optional: true,
        },
      ],
      rewards: {
        experience: 300,
        gold: 80,
        stateChanges: [{ type: "variable", variableId: V.salt, op: "add", value: 1 }],
      },
      dialogues: {
        offer: "Trois vannes, prises dans le sel. Forcez-les et le marais reprendra son souffle.",
        accepted: "Dans n’importe quel ordre. La marée fera le reste.",
        reminder: "Levant, milieu, couchant. Il en manque encore.",
        ready: "L’eau court dans les trois canaux. Écoutez-la.",
      },
    }),

    quest({
      id: Q.glass,
      title: "Le verre de sel",
      description:
        "Le bassin blanchit, le four peut reprendre. Une plaque de sel passée au feu donne un verre épais et vert — le seul dont un miroir de phare veuille bien.",
      journalSummary: "Couler le verre de sel au four des salines.",
      recommendedLevel: 5,
      previousQuestId: Q.valves,
      objectives: [
        {
          ...base,
          id: "0001",
          type: "activity",
          activityId: "verre_coule",
          target: 1,
          label: "Verre de sel coulé",
        },
      ],
      rewards: {
        experience: 340,
        gold: 90,
        items: [{ itemId: "mana_potion", quantity: 2 }],
        stateChanges: [{ type: "switch", switchId: S.saltGlass, value: true }],
      },
      dialogues: {
        offer: "Le four est froid. Rallumez-le quand le bassin aura pris.",
        accepted: "Le sel d’abord, le feu ensuite. Jamais l’inverse.",
        reminder: "Le four est au centre des salines.",
        ready: "Vert, épais, sans bulle. Il tiendra la flamme.",
      },
    }),

    quest({
      id: Q.lighthouse,
      title: "La lumière de Malemer",
      description:
        "L’huile est là, le verre est coulé. Reste à monter au rocher, à passer ce que le gardien a mis devant sa porte, et à décider si la baie mérite qu’on la rende visible.",
      journalSummary:
        "Monter à Malemer, remonter le miroir, tenir la plage et trancher le sort du fanal.",
      recommendedLevel: 8,
      conditions: [
        { type: "switch", switchId: S.lampOil, value: true },
        { type: "switch", switchId: S.saltGlass, value: true },
      ],
      objectiveMode: "sequential",
      completion: "turn-in",
      objectives: [
        {
          ...base,
          id: "0001",
          type: "reach",
          destination: { kind: "area", mapId: MAP_IDS.lighthouse, areaId: "phare_malemer" },
          label: "Atteindre le pied du phare",
          target: 1,
          stage: 0,
        },
        {
          ...base,
          id: "0002",
          type: "defeat-target",
          targetRef: ref("lighthouse.warden"),
          label: "Le Veilleur de Malemer",
          credit: "contributors",
          target: 1,
          stage: 1,
        },
        {
          ...base,
          id: "0003",
          type: "activity",
          activityId: "miroir_repare",
          label: "Miroir du fanal remonté",
          target: 1,
          stage: 2,
        },
        {
          ...base,
          id: "0004",
          type: "activity",
          activityId: "varn_abattu",
          target: 1,
          label: "Varn abattu sur la plage",
          stage: 3,
        },
      ],
      rewards: {
        experience: 1600,
        gold: 500,
        items: [{ itemId: "resurrection_potion", quantity: 1 }],
        stateChanges: [{ type: "variable", variableId: V.beacons, op: "add", value: 1 }],
      },
      dialogues: {
        offer: "Le phare nous attend — et son gardien avec.",
        accepted: "Prenez le canot du nord-est. Je fais lever le guet et je vous suis.",
        reminder: "Le rocher monte en deux paliers. La lanterne est tout en haut.",
        ready: "La plage est tenue et le miroir est prêt. Il ne reste qu’à choisir.",
        turnIn: "Alors c’est fait. La baie saura ce que vous avez décidé pour elle.",
      },
    }),
  ];
}

/** Réexport utilitaire : le build lit la liste des cartes pour vérifier la couverture des quêtes. */
export type { AdventureBundleMap };
