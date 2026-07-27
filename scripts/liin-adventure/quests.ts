import type {
  AuthoredQuestDefinition,
  AuthoredQuestObjective,
  QuestDialogues,
  QuestPrerequisiteCondition,
} from "@lindocara/engine/quests.js";
import {
  createAuthoredQuestDefinition,
  emptyQuestDialogues,
  emptyQuestRewards,
} from "@lindocara/engine/quests.js";
import { MAP_IDS, type StoryRefs } from "./campaign.js";

function activityObjective(
  id: string,
  label: string,
  stage: number,
  activityId: string,
  target = 1,
  optional = false,
): AuthoredQuestObjective {
  return {
    id,
    type: "activity",
    label,
    target,
    optional,
    hidden: false,
    stage,
    activityId,
  };
}

function reachObjective(
  id: string,
  label: string,
  stage: number,
  mapId: string,
): AuthoredQuestObjective {
  return {
    id,
    type: "reach",
    label,
    target: 1,
    optional: false,
    hidden: false,
    stage,
    destination: { kind: "map", mapId },
  };
}

function dialogues(
  offer: string,
  accepted: string,
  reminder: string,
  ready: string,
  completed: string,
): QuestDialogues {
  return {
    ...emptyQuestDialogues(),
    offer,
    accepted,
    refused: "Cette tâche peut attendre, mais ses conséquences continueront sans vous.",
    reminder,
    ready,
    turnIn: ready,
    completed,
    unavailable: "Les faits nécessaires ne sont pas encore établis.",
  };
}

interface QuestOptions {
  description: string;
  summary: string;
  recommendedLevel: number;
  objectives: readonly AuthoredQuestObjective[];
  previousQuestId?: string | null;
  conditions?: readonly QuestPrerequisiteCondition[];
  objectiveMode?: "simultaneous" | "sequential";
  experience?: number;
  gold?: number;
  nextQuestId?: string | null;
  abandonable?: boolean;
  dialogue: QuestDialogues;
}

function quest(id: string, title: string, options: QuestOptions): AuthoredQuestDefinition {
  return {
    ...createAuthoredQuestDefinition(id, title),
    description: options.description,
    journalSummary: options.summary,
    recommendedLevel: options.recommendedLevel,
    scope: "party",
    repeatable: false,
    abandonable: options.abandonable ?? false,
    acceptance: "automatic",
    completion: "automatic",
    giver: null,
    turnInTarget: null,
    prerequisites: {
      minLevel: null,
      previousQuestId: options.previousQuestId ?? null,
      mode: "all",
      conditions: options.conditions ?? [],
    },
    objectiveMode: options.objectiveMode ?? "sequential",
    objectives: options.objectives,
    rewards: {
      ...emptyQuestRewards(),
      experience: options.experience ?? 250,
      gold: options.gold ?? 40,
      nextQuestId: options.nextQuestId ?? null,
    },
    dialogues: options.dialogue,
  };
}

function mainQuests(): AuthoredQuestDefinition[] {
  return [
    quest("0001", "Les noms absents", {
      description:
        "Un convoi a été attaqué et plusieurs voyageurs ont disparu. Lyra demande trois faits avant de risquer l’entrée d’Aubeval.",
      summary:
        "Interroger Iven près du chariot, examiner le registre, puis rejoindre l’Éclat d’Aube.",
      recommendedLevel: 1,
      nextQuestId: "0002",
      experience: 350,
      gold: 55,
      objectives: [
        activityObjective("0001", "Recueillir le témoignage d’Iven", 0, "disparus_signales"),
        activityObjective("0002", "Examiner le registre fendu", 0, "registre_brise"),
        activityObjective("0003", "Faire face à l’Éclat d’Aube", 1, "source_reconnait"),
      ],
      dialogue: dialogues(
        "Lyra désigne Iven, le chariot et le poste du greffier.",
        "« Les blessés d’abord. Les papiers ne saignent pas. »",
        "Iven parle de disparus ; le registre compte le groupe sans inscrire ses noms.",
        "L’Éclat réagit pourtant à leur présence. Lyra obtient l’ouverture de la porte.",
        "Aubeval s’ouvre. Les cases du registre restent vides.",
      ),
    }),
    quest("0002", "La porte des traîtres", {
      description:
        "Lyra veut une copie des convois avant toute accusation publique. Varkesh détient l’autre moitié du dossier dans le faubourg.",
      summary:
        "Copier le livre des convois, rejoindre Varkesh par la Porte des Traîtres, puis statuer sur son sort.",
      recommendedLevel: 2,
      previousQuestId: "0001",
      nextQuestId: "0003",
      experience: 550,
      gold: 80,
      objectives: [
        reachObjective("0001", "Entrer dans Aubeval", 0, MAP_IDS.aubeval),
        activityObjective("0002", "Vérifier les registres des convois", 1, "preuve_convois"),
        activityObjective("0003", "Obtenir les preuves de Varkesh", 2, "preuve_varkesh"),
        activityObjective("0004", "Décider du sort de Varkesh", 3, "sort_varkesh"),
      ],
      dialogue: dialogues(
        "Lyra montre la terrasse des archives et la Porte des Traîtres.",
        "« Copiez d’abord. Si vous criez trop tôt, le Conseil fera disparaître l’encre. »",
        "Le livre confirme les convois. Les exécutions de Varkesh restent, elles aussi, confirmées.",
        "Le groupe a décidé du sort de Varkesh et conservé ses preuves.",
        "La place d’Aubeval réagit à des faits qu’aucun camp ne contrôle seul.",
      ),
    }),
    quest("0003", "Le Pacte mutilé", {
      description:
        "Sève protège les arbres nourriciers ; Écorce veut rouvrir les anciennes routes. Le passage dépend du clan soutenu et du rite conservé sous les racines.",
      summary:
        "Rencontrer les deux clans, choisir une route, accomplir le rite, puis confronter Morvane.",
      recommendedLevel: 4,
      previousQuestId: "0002",
      nextQuestId: "0004",
      experience: 750,
      gold: 105,
      objectives: [
        reachObjective("0001", "Gagner Clairécorce", 0, MAP_IDS.woods),
        activityObjective("0002", "Prendre parti dans la querelle des clans", 1, "choix_clan"),
        activityObjective("0003", "Reconstituer le rite des racines", 2, "rite_racines"),
        activityObjective("0004", "Décider du sort de Morvane", 3, "sort_morvane"),
      ],
      dialogue: dialogues(
        "Elyne promet des fragments, pas une vérité innocente.",
        "Écoutez les intérêts des clans avant leurs chants.",
        "Le rite exige un ordre logique et rend toute erreur réversible.",
        "Morvane n’est plus un obstacle sans histoire : son sort engage le Bois entier.",
        "La route du Marais s’ouvre avec une version plus complète du Pacte.",
      ),
    }),
    quest("0004", "Les morts qui se souviennent", {
      description:
        "Les îlots du Marais rejouent des souvenirs sans date. Talen demande de retrouver leur ordre avant de juger Nhalgor ou d’accuser les Archives.",
      summary:
        "Atteindre le clocher englouti, dater trois souvenirs, décider du sort de Nhalgor, puis faire parler Talen.",
      recommendedLevel: 6,
      previousQuestId: "0003",
      nextQuestId: "0005",
      experience: 950,
      gold: 135,
      objectives: [
        reachObjective("0001", "Atteindre les Saules", 0, MAP_IDS.marsh),
        activityObjective("0002", "Comprendre ce que Nhalgor protège", 1, "intentions_nhalgor"),
        activityObjective("0003", "Rétablir la chronologie des Archives", 2, "ordre_archives"),
        activityObjective("0004", "Décider du sort de Nhalgor", 3, "sort_nhalgor"),
        activityObjective("0005", "Obtenir l’aveu complet de Talen", 4, "verite_talen"),
      ],
      dialogue: dialogues(
        "Talen sait où les versions effacées ont été conservées.",
        "Une mémoire vraie peut rester trompeuse si sa date et son témoin manquent.",
        "Remettez d’abord fondation, convoi et ruines dans leur ordre.",
        "Les Archives ont un sort, et Talen a donné un aveu qui peut être jugé.",
        "La Citadelle recevra des preuves accompagnées de leur provenance.",
      ),
    }),
    quest("0005", "La guerre des serments", {
      description:
        "La Citadelle tient encore trois cours séparées. Serah doit parler aux conscrits avant que le groupe ne confie les portes et les réserves à un commandement.",
      summary:
        "Rejoindre Serah dans la cour des conscrits, libérer l’accès au commandement, puis choisir qui contrôle la Citadelle.",
      recommendedLevel: 8,
      previousQuestId: "0004",
      nextQuestId: "0006",
      experience: 1_150,
      gold: 165,
      objectives: [
        reachObjective("0001", "Entrer dans les Trois Cours", 0, MAP_IDS.citadel),
        activityObjective("0002", "Fixer la ligne de Serah", 1, "position_serah"),
        activityObjective("0003", "Choisir le contrôle de la Citadelle", 2, "controle_citadelle"),
      ],
      dialogue: dialogues(
        "La Citadelle ne tombera pas dans un vide politique.",
        "Serah parlera d’abord aux conscrits ; le commandement suivra.",
        "La force disponible, les ingénieurs et la légitimité n’appartiennent pas au même camp.",
        "Un commandement existe et devra répondre de ses décisions après la bataille.",
        "La route du Sanctuaire est ouverte par une autorité imparfaite mais identifiée.",
      ),
    }),
    quest("0006", "Le prix de l’Aube", {
      description:
        "Le Sanctuaire conserve le registre des soins et de leur prix. Varos attend une réponse ; trois fragments d’Eryndor indiquent où se trouve le mécanisme originel.",
      summary:
        "Lire le registre des prélèvements, répondre à Varos, puis retrouver les trois fragments d’Eryndor.",
      recommendedLevel: 10,
      previousQuestId: "0005",
      nextQuestId: "0007",
      experience: 1_400,
      gold: 200,
      objectives: [
        reachObjective("0001", "Atteindre le Sanctuaire", 0, MAP_IDS.sanctuary),
        activityObjective("0002", "Lire le registre des prélèvements", 1, "verite_couronne"),
        activityObjective("0003", "Répondre à l’offre de Varos", 2, "offre_varos"),
        activityObjective("0004", "Réunir les trois fragments d’Eryndor", 3, "memoire_eryndor"),
        activityObjective("0005", "Localiser le mécanisme originel", 4, "preparer_guerre"),
      ],
      dialogue: dialogues(
        "Le Sanctuaire doit être compris comme temple, réseau de soins et appareil politique.",
        "Commencez par les canaux et les deux bibliothèques avant de croire un récit royal.",
        "Varos propose une solution mesurable ; Eryndor en révèle la généalogie.",
        "La guerre peut être préparée sans confondre son objectif avec l’extermination de l’ennemi.",
        "Le passage sous la forteresse est connu. La bataille servira à l’atteindre.",
      ),
    }),
    quest("0007", "La guerre de l’Aube", {
      description:
        "La bataille ouvre une seule fenêtre vers le mécanisme. Les réserves ne peuvent tenir qu’un front pendant que le groupe descend dans les galeries.",
      summary:
        "Choisir le front soutenu, ouvrir le conduit des serviteurs, activer trois ancres, puis entrer dans le Cœur.",
      recommendedLevel: 12,
      previousQuestId: "0006",
      experience: 2_500,
      gold: 350,
      objectives: [
        reachObjective("0001", "Entrer dans la bataille", 0, MAP_IDS.war),
        activityObjective("0002", "Engager les réserves sur un secteur", 1, "tenir_front"),
        activityObjective("0003", "Ouvrir le passage des serviteurs", 2, "passage_serviteurs"),
        activityObjective("0004", "Activer les trois ancres", 3, "ouvrir_mecanisme"),
        activityObjective("0005", "Prononcer le choix de l’Aube", 4, "choisir_aube"),
      ],
      dialogue: dialogues(
        "Lyra ne demande pas de gagner chaque front, mais d’acheter le temps d’une mission décisive.",
        "Les réserves ne sauveront pas l’ouest, l’est et l’infirmerie à la fois.",
        "Le conduit, les trois ancres et le Cœur forment la route décisive.",
        "Le mécanisme a reçu une décision et le champ de bataille en subit déjà les effets.",
        "L’épilogue appartient désormais aux peuples qui vivront avec le prix choisi.",
      ),
    }),
  ];
}

interface SideQuestData {
  id: string;
  title: string;
  description: string;
  summary: string;
  previousQuestId: string;
  recommendedLevel: number;
  objectives: readonly AuthoredQuestObjective[];
  objectiveMode?: "simultaneous" | "sequential";
  reminder: string;
  completed: string;
}

function sideQuest(data: SideQuestData): AuthoredQuestDefinition {
  return quest(data.id, data.title, {
    description: data.description,
    summary: data.summary,
    recommendedLevel: data.recommendedLevel,
    previousQuestId: data.previousQuestId,
    objectiveMode: data.objectiveMode ?? "sequential",
    abandonable: true,
    experience: 300 + data.recommendedLevel * 40,
    gold: 35 + data.recommendedLevel * 8,
    objectives: data.objectives,
    dialogue: dialogues(
      data.description,
      data.summary,
      data.reminder,
      "Les faits demandés sont réunis ; leurs conséquences sont déjà visibles sur place.",
      data.completed,
    ),
  });
}

function sideQuests(refs: StoryRefs): AuthoredQuestDefinition[] {
  const avatar = refs["heart.varos-avatar"];
  if (!avatar) throw new Error("missing heart.varos-avatar quest reference");
  const data: SideQuestData[] = [
    {
      id: "0010",
      title: "Trois places vides",
      description:
        "Les maisons murées du faubourg permettent d’identifier des absents sans promettre qu’ils sont vivants. Ouvrir les lieux et consigner les objets rend aux familles des faits que les deux camps avaient transformés en slogans.",
      summary: "Ouvrir les trois maisons murées et consigner ce qui reste.",
      previousQuestId: "0001",
      recommendedLevel: 2,
      objectives: [
        activityObjective("0001", "Inspecter les trois maisons", 0, "trois_places_vides"),
      ],
      reminder: "La rue murée se trouve avant la position de Varkesh.",
      completed:
        "Les familles disposent d’un inventaire, de témoins et d’un lieu où poursuivre les recherches.",
    },
    {
      id: "0011",
      title: "La digue et la fièvre",
      description:
        "La vanne des Tisserands oppose une réparation lente à un miracle immédiat qui prendrait un nom. Le choix révèle comment les habitants évaluent un coût présent, une perte future et un prélèvement impossible à rendre.",
      summary: "Décider comment la vanne des Tisserands sera sauvée.",
      previousQuestId: "0001",
      recommendedLevel: 2,
      objectives: [activityObjective("0001", "Stabiliser la vanne", 0, "digue_sans_miracle")],
      reminder: "Maître Harel attend près du canal central d’Aubeval.",
      completed: "La digue tient, et son mode de réparation figure dans les comptes du quartier.",
    },
    {
      id: "0012",
      title: "Les maisons réquisitionnées",
      description:
        "Les reçus d’Aubeval et l’évacuation du faubourg relient les saisies civiles aux convois. Sauver les habitants ne suffit pas : il faut aussi conserver la trace de l’autorité qui les a déplacés.",
      summary: "Relier les reçus de réquisition à l’évacuation du faubourg.",
      previousQuestId: "0001",
      recommendedLevel: 3,
      objectiveMode: "simultaneous",
      objectives: [
        activityObjective(
          "0001",
          "Copier le plan des maisons saisies",
          0,
          "maisons_requisitionnees",
        ),
        activityObjective("0002", "Évacuer la rue du Four", 1, "evacuer_faubourg"),
      ],
      reminder: "Le plan est à Aubeval ; la rue du Four se trouve derrière la Porte des Traîtres.",
      completed: "Les survivants et les reçus décrivent désormais une même opération documentée.",
    },
    {
      id: "0013",
      title: "Le relais des quatre dettes",
      description:
        "Les quatre tables du relais conservent les engagements originels du grain, du passage, des noms et de la veille. Les rouvrir rend visibles les obligations que la Couronne avait réduites à un tribut.",
      summary: "Lire et ouvrir les quatre tables du vieux relais.",
      previousQuestId: "0002",
      recommendedLevel: 3,
      objectiveMode: "simultaneous",
      objectives: [
        activityObjective("0001", "Ouvrir la table du grain", 0, "dette_grain"),
        activityObjective("0002", "Ouvrir la table du passage", 1, "dette_passage"),
        activityObjective("0003", "Ouvrir la table des noms", 2, "dette_noms"),
        activityObjective("0004", "Ouvrir la table de la veille", 3, "dette_veille"),
      ],
      reminder: "Chaque table nomme à la fois un bienfait et la responsabilité qui lui répond.",
      completed:
        "Le relais redevient une route et un registre partagé plutôt qu’un poste de prélèvement.",
    },
    {
      id: "0014",
      title: "Les étrangers de l’hiver",
      description:
        "Une écorce de Clairécorce conserve le mot « étrangers » sous la correction « volontaires ». Publier les deux couches empêche les peuples des Bois d’utiliser les crimes royaux pour effacer les leurs.",
      summary: "Préserver la version originale de l’écorce de l’hiver.",
      previousQuestId: "0002",
      recommendedLevel: 4,
      objectives: [
        activityObjective("0001", "Copier les deux couches de l’écorce", 0, "etrangers_hiver"),
      ],
      reminder: "L’écorce se trouve dans la partie ancienne du Bois, au-delà du premier étang.",
      completed:
        "La tradition orale devra désormais nommer les étrangers livrés pendant la famine.",
    },
    {
      id: "0015",
      title: "Deux lois sous les feuilles",
      description:
        "Les marques de partage, de coupe royale et de maladie montrent que le Bois n’a jamais obéi à une seule coutume. Les lire avant de choisir un clan donne un sens politique au chemin ouvert.",
      summary: "Comparer les marques des arbres puis prendre parti dans le conflit des clans.",
      previousQuestId: "0002",
      recommendedLevel: 4,
      objectiveMode: "simultaneous",
      objectives: [
        activityObjective("0001", "Lire les trois systèmes de marques", 0, "deux_lois"),
        activityObjective("0002", "Choisir le clan aidé", 1, "choix_clan"),
      ],
      reminder: "Les arbres marqués se trouvent entre les deux zones d’habitation.",
      completed: "Le choix du clan est replacé dans l’histoire concrète des routes et des coupes.",
    },
    {
      id: "0016",
      title: "Ce que Morvane retient",
      description:
        "Morvane contient des souvenirs imposés par les anciens clans. Reconstituer le rite puis décider de son sort oblige à distinguer stabilité, liberté, réparation et appropriation de sa puissance.",
      summary: "Comprendre la charge de Morvane avant de décider de son sort.",
      previousQuestId: "0002",
      recommendedLevel: 5,
      objectives: [
        activityObjective("0001", "Accomplir le rite des racines", 0, "rite_racines"),
        activityObjective("0002", "Décider de la charge de Morvane", 1, "sort_morvane"),
      ],
      reminder:
        "La table du Pacte donne l’ordre exact et le bassin permet toujours de recommencer.",
      completed:
        "Le Bois doit vivre avec une décision dont aucun clan ne peut revendiquer seul la vertu.",
    },
    {
      id: "0017",
      title: "Les voix empruntées",
      description:
        "Le Marais prête aux reflets des voix appartenant encore aux vivants. Rendre celle de Mila et écouter plusieurs fragments montre pourquoi une mémoire vraie peut devenir dangereuse lorsqu’elle change de propriétaire.",
      summary: "Rendre la voix de Mila et consigner trois fragments du Marais.",
      previousQuestId: "0003",
      recommendedLevel: 6,
      objectiveMode: "simultaneous",
      objectives: [
        activityObjective("0001", "Rendre sa voix à Mila", 0, "voix_empruntee"),
        activityObjective("0002", "Consigner trois fragments", 1, "fragment_marais", 3),
      ],
      reminder: "Les fragments se trouvent sur des îlots distincts reliés par les pontons.",
      completed:
        "Les voix sont liées à des dates et à des personnes plutôt que classées comme ressources anonymes.",
    },
    {
      id: "0018",
      title: "Une digue sans miracle",
      description:
        "La digue des Saules peut être sauvée par un effort réparti ou par une vanne royale qui déplace la catastrophe. Le choix donne à Maëlys des données concrètes sur ce que la révolte pourra maintenir.",
      summary: "Choisir et documenter une réparation pour les deux rives.",
      previousQuestId: "0003",
      recommendedLevel: 6,
      objectives: [activityObjective("0001", "Réparer la digue des Saules", 0, "digue_marais")],
      reminder: "Maëlys attend sur la levée centrale avec les responsables des deux rives.",
      completed:
        "La réparation est inscrite avec ses bénéficiaires et ceux qui en supportent le risque.",
    },
    {
      id: "0019",
      title: "La faute de Talen",
      description:
        "Talen a d’abord obéi sous menace, puis continué volontairement pour conserver les soins de sa sœur. Son aveu doit conduire à un procès ou à une réparation surveillée, jamais à une innocence commode.",
      summary: "Obtenir l’aveu complet de Talen et décider de sa responsabilité.",
      previousQuestId: "0003",
      recommendedLevel: 7,
      objectives: [
        activityObjective("0001", "Entendre et qualifier la faute de Talen", 0, "faute_talen"),
      ],
      reminder: "Talen ne parlera complètement qu’une fois le sort des Archives décidé.",
      completed: "Sa responsabilité est publique et ne peut plus être noyée dans les ordres reçus.",
    },
    {
      id: "0020",
      title: "Les lettres des conscrits",
      description:
        "Les courriers saisis décrivent les récoltes, les naissances et la fatigue plutôt que les grands principes de la guerre. Les remettre aux villages maintient les soldats dans un tissu social que les serments cherchaient à remplacer.",
      summary: "Classer les lettres saisies et organiser leur acheminement.",
      previousQuestId: "0004",
      recommendedLevel: 8,
      objectives: [
        activityObjective("0001", "Faire partir les lettres des conscrits", 0, "lettres_conscrits"),
      ],
      reminder: "Un sac se trouve dans les Trois Cours et le bureau central dans le Fort.",
      completed: "Les courriers franchissent les lignes sous escorte volontaire.",
    },
    {
      id: "0021",
      title: "Les brasiers retournés",
      description:
        "Le dépôt inquisitorial contient les soins retirés aux conscrits et les ordres de brûler les archives. Le saisir modifie immédiatement l’équilibre militaire tout en sauvant des blessés.",
      summary: "Prendre le dépôt inquisitorial et distribuer les soins.",
      previousQuestId: "0004",
      recommendedLevel: 8,
      objectives: [
        activityObjective("0001", "Retourner le dépôt inquisitorial", 0, "retourner_brasiers"),
      ],
      reminder: "Le dépôt se trouve dans la cour médiane, près du poste de tri.",
      completed:
        "Les soins rejoignent l’infirmerie et les ordres de destruction deviennent des pièces à charge.",
    },
    {
      id: "0022",
      title: "Le procès de Sael",
      description:
        "Sael garde des morts liés à un serment sans terme. Rompre ce lien affaiblit la défense ; le reporter conserve une faute sous promesse de date. La décision doit rester écrite pour éviter un nouveau provisoire éternel.",
      summary: "Décider du sort des morts liés de la Citadelle.",
      previousQuestId: "0004",
      recommendedLevel: 9,
      objectives: [
        activityObjective("0001", "Statuer sur les morts du serment", 0, "delivrer_morts"),
      ],
      reminder: "Sael attend dans la cour ancienne du Fort des Serments.",
      completed: "La décision porte un auteur, un motif et, si nécessaire, une date de révision.",
    },
    {
      id: "0023",
      title: "Les jardins qui nourrissent",
      description:
        "Les jardins du Sanctuaire nourrissent des hospices tout en consommant des noms prélevés. Réduire ou maintenir le canal oblige à relier l’abolition future aux réserves présentes.",
      summary: "Assurer les récoltes des hospices sans cacher leur prix.",
      previousQuestId: "0005",
      recommendedLevel: 10,
      objectives: [
        activityObjective("0001", "Réorganiser les jardins nourriciers", 0, "jardins_nourriciers"),
      ],
      reminder: "Sœur Ysra tient les comptes à l’entrée des serres.",
      completed:
        "Les hospices disposent d’un calendrier et le prix du canal est affiché publiquement.",
    },
    {
      id: "0024",
      title: "Les bibliothèques jumelles",
      description:
        "La bibliothèque royale classe les miracles par rendement ; celle des serviteurs classe les mêmes opérations par victimes. Réunir les catalogues empêche de lire l’un sans l’autre.",
      summary: "Comparer les deux catalogues et le registre des prélèvements.",
      previousQuestId: "0005",
      recommendedLevel: 10,
      objectiveMode: "simultaneous",
      objectives: [
        activityObjective("0001", "Réunir les catalogues", 0, "bibliotheques_jumelles"),
        activityObjective("0002", "Lire le conduit des prélèvements", 1, "verite_couronne"),
      ],
      reminder:
        "Les bibliothèques encadrent le canal central ; le registre se trouve sous les conduites.",
      completed:
        "Chaque rendement peut désormais être confronté aux personnes qui en ont payé le prix.",
    },
    {
      id: "0025",
      title: "Le neuvième chariot",
      description:
        "Le chariot absent des rapports contient des bracelets marqués comme ceux des Sans-Sceau. Il relie leur origine commune aux expériences de prélèvement et confirme que leur immunité vient d’une perte antérieure.",
      summary: "Retrouver le chariot effacé et identifier les marques des Sans-Sceau.",
      previousQuestId: "0005",
      recommendedLevel: 11,
      objectives: [
        activityObjective("0001", "Examiner le neuvième chariot", 0, "neuvieme_chariot"),
      ],
      reminder: "Le chariot a été muré dans une salle latérale de la Crypte.",
      completed:
        "L’absence dans le passé des héros devient une preuve commune sans imposer leur personnalité.",
    },
    {
      id: "0026",
      title: "Ceux qui tiennent le front",
      description:
        "Les réserves ne peuvent sauver tous les secteurs. Soutenir un front rend visibles les forces recrutées et les pertes acceptées ; vaincre l’avatar de Varos reste facultatif et ne remplace pas la mission du mécanisme.",
      summary: "Soutenir un secteur ; l’avatar de la Couronne est un objectif facultatif.",
      previousQuestId: "0006",
      recommendedLevel: 12,
      objectives: [
        activityObjective("0001", "Engager les réserves", 0, "tenir_front"),
        {
          id: "0002",
          type: "defeat-target",
          label: "Vaincre l’avatar de Varos (facultatif)",
          target: 1,
          optional: true,
          hidden: false,
          stage: 1,
          targetRef: { mapId: MAP_IDS.heart, eventId: avatar.id },
          credit: "nearby-party",
        },
      ],
      reminder:
        "Le choix des réserves est irréversible ; l’avatar ne décide pas du sort de la Source.",
      completed: "Les lignes gagnent du temps, pas une solution. Le Cœur reste l’objectif décisif.",
    },
    {
      id: "0027",
      title: "Le chemin des serviteurs",
      description:
        "Le passage discret de Linn traverse la bataille puis les anciennes galeries. Les trois ancres doivent porter un bienfait, un prix et des témoins avant que le mécanisme originel reconnaisse un Pacte complet.",
      summary: "Ouvrir le conduit des serviteurs puis activer les trois ancres.",
      previousQuestId: "0006",
      recommendedLevel: 12,
      objectives: [
        activityObjective("0001", "Ouvrir le conduit", 0, "passage_serviteurs"),
        activityObjective("0002", "Activer les trois ancres", 1, "ouvrir_mecanisme"),
      ],
      reminder:
        "Les portes qui donnent tout à un souverain bouclent ; les ancres du grain, de la garde et du nom ouvrent la route.",
      completed: "Le mécanisme originel est accessible pendant que la guerre continue au-dessus.",
    },
  ];
  return data.map(sideQuest);
}

interface QuestPresentation {
  category: "main" | "side" | "lore";
  region: string;
  landmark: string;
  giverName: string;
  giverKey: string | null;
  knownConsequence: string;
}

const QUEST_PRESENTATION: Readonly<Record<string, QuestPresentation>> = {
  "0001": {
    category: "main",
    region: "Route des Bornes arrachées",
    landmark: "Chariot renversé",
    giverName: "Lyra",
    giverKey: null,
    knownConsequence: "Lyra pourra faire ouvrir la porte d’Aubeval.",
  },
  "0002": {
    category: "main",
    region: "Aubeval et Faubourg",
    landmark: "Marché des Digues",
    giverName: "Lyra",
    giverKey: "aubeval.lyra",
    knownConsequence: "La preuve choisie modifiera la réaction de la ville.",
  },
  "0003": {
    category: "main",
    region: "Clairécorce",
    landmark: "Relais des Quatre Dettes",
    giverName: "Rime",
    giverKey: "relay.keeper",
    knownConsequence: "Le clan soutenu contrôlera une route et des réserves.",
  },
  "0004": {
    category: "main",
    region: "Marais de Verre",
    landmark: "Levée des Saules",
    giverName: "Talen",
    giverKey: "marsh.talen",
    knownConsequence: "Le sort des mémoires déterminera les preuves disponibles.",
  },
  "0005": {
    category: "main",
    region: "Citadelle",
    landmark: "Infirmerie de la première cour",
    giverName: "Sœur Ane",
    giverKey: "citadel.field-surgeon",
    knownConsequence: "Le commandement choisi contrôlera troupes et réserves.",
  },
  "0006": {
    category: "main",
    region: "Sanctuaire de l’Aube",
    landmark: "Canal des hospices",
    giverName: "Maëlys",
    giverKey: "sanctuary.maelys",
    knownConsequence: "Les soins et l’accès aux galeries dépendront de la décision.",
  },
  "0007": {
    category: "main",
    region: "Guerre de l’Aube",
    landmark: "Poste de commandement",
    giverName: "Lyra",
    giverKey: "war.lyra",
    knownConsequence: "Un seul front recevra toutes les réserves.",
  },
  "0010": {
    category: "side",
    region: "Faubourg de la Porte",
    landmark: "Rue du Four",
    giverName: "Serah",
    giverKey: "faubourg.serah",
    knownConsequence: "Les familles retrouveront une trace vérifiable des absents.",
  },
  "0011": {
    category: "side",
    region: "Aubeval",
    landmark: "Vanne des Tisserands",
    giverName: "Mara des digues",
    giverKey: "aubeval.farmer",
    knownConsequence: "Le quartier bas sera évacué ou paiera un nom à la Source.",
  },
  "0012": {
    category: "side",
    region: "Aubeval et Faubourg",
    landmark: "Mémorial des métiers",
    giverName: "Neria",
    giverKey: "aubeval.memorial",
    knownConsequence: "Les réquisitions seront reliées aux survivants déplacés.",
  },
  "0013": {
    category: "side",
    region: "Relais des Quatre Dettes",
    landmark: "Cour des quatre tables",
    giverName: "Rime",
    giverKey: "relay.keeper",
    knownConsequence: "Le relais rouvrira aux voyageurs.",
  },
  "0014": {
    category: "side",
    region: "Clairécorce",
    landmark: "Vieille route d’Écorce",
    giverName: "Doyenne Nolda",
    giverKey: "woods.bark-elder",
    knownConsequence: "Le crime de l’hiver sera reconnu par les deux clans.",
  },
  "0015": {
    category: "side",
    region: "Clairécorce",
    landmark: "Frontière des arbres marqués",
    giverName: "Haran d’Écorce",
    giverKey: "woods.reed-guide",
    knownConsequence: "Les marques rendront le choix de clan publiquement lisible.",
  },
  "0016": {
    category: "side",
    region: "Sanctuaire des Racines",
    landmark: "Table du premier Pacte",
    giverName: "Elyne",
    giverKey: "roots.oath-tablet",
    knownConsequence: "La décision sur Morvane changera l’équilibre du Bois.",
  },
  "0017": {
    category: "side",
    region: "Marais de Verre",
    landmark: "Premier ponton des Saules",
    giverName: "Talen",
    giverKey: "marsh.talen",
    knownConsequence: "Les voix seront rendues à des personnes plutôt qu’archivées.",
  },
  "0018": {
    category: "side",
    region: "Marais de Verre",
    landmark: "Levée centrale",
    giverName: "Maëlys",
    giverKey: "marsh.maelys",
    knownConsequence: "La circulation entre les deux rives changera.",
  },
  "0019": {
    category: "side",
    region: "Archives sous la Vase",
    landmark: "Table des marées",
    giverName: "Talen",
    giverKey: "marsh.talen",
    knownConsequence: "Talen sera jugé ou placé sous contrôle.",
  },
  "0020": {
    category: "side",
    region: "Citadelle",
    landmark: "Infirmerie de la première cour",
    giverName: "Sœur Ane",
    giverKey: "citadel.field-surgeon",
    knownConsequence: "Les villages recevront les lettres des conscrits.",
  },
  "0021": {
    category: "side",
    region: "Citadelle",
    landmark: "Dépôt inquisitorial",
    giverName: "Messagère de Lyra",
    giverKey: "citadel.lyra-message",
    knownConsequence: "Les soins saisis rejoindront immédiatement l’infirmerie.",
  },
  "0022": {
    category: "side",
    region: "Fort des Serments",
    landmark: "Cour des anciens morts",
    giverName: "Maëlys",
    giverKey: "fort.maelys",
    knownConsequence: "La garnison gagnera ou perdra ses gardes liés.",
  },
  "0023": {
    category: "side",
    region: "Sanctuaire de l’Aube",
    landmark: "Jardins nourriciers",
    giverName: "Maëlys",
    giverKey: "sanctuary.maelys",
    knownConsequence: "Les hospices verront leurs réserves et leurs coûts changer.",
  },
  "0024": {
    category: "side",
    region: "Sanctuaire de l’Aube",
    landmark: "Bibliothèques jumelles",
    giverName: "Linn",
    giverKey: "sanctuary.servant",
    knownConsequence: "Rendements et victimes seront consultables ensemble.",
  },
  "0025": {
    category: "lore",
    region: "Crypte d’Eryndor",
    landmark: "Salle du neuvième chariot",
    giverName: "Écho d’Eryndor",
    giverKey: "crypt.varos-answer",
    knownConsequence: "Les héros obtiendront une preuve de leur perte commune.",
  },
  "0026": {
    category: "side",
    region: "Guerre de l’Aube",
    landmark: "Ligne de triage",
    giverName: "Serah",
    giverKey: "war.serah",
    knownConsequence: "Le secteur choisi recevra les réserves disponibles.",
  },
  "0027": {
    category: "side",
    region: "Galeries de la Source",
    landmark: "Conduit acoustique",
    giverName: "Équipe de Linn",
    giverKey: "galleries.battle-echo",
    knownConsequence: "Le mécanisme originel deviendra accessible.",
  },
};

function applyQuestPresentation(
  definitions: readonly AuthoredQuestDefinition[],
  refs: StoryRefs,
): AuthoredQuestDefinition[] {
  return definitions.map((definition) => {
    const presentation = QUEST_PRESENTATION[definition.id];
    if (!presentation) throw new Error(`missing quest presentation for ${definition.id}`);
    const giver = presentation.giverKey === null ? null : (refs[presentation.giverKey] ?? null);
    if (presentation.giverKey !== null && giver === null) {
      throw new Error(`missing quest giver ${presentation.giverKey}`);
    }
    const giverRef = giver
      ? {
          mapId: MAP_IDS[presentation.giverKey?.split(".")[0] as keyof typeof MAP_IDS],
          eventId: giver.id,
        }
      : null;
    const main = presentation.category === "main";
    return {
      ...definition,
      category: presentation.category,
      region: presentation.region,
      landmark: presentation.landmark,
      giverName: presentation.giverName,
      knownConsequence: presentation.knownConsequence,
      acceptance: definition.id === "0001" ? "automatic" : "manual",
      completion: main ? "automatic" : "turn-in",
      giver: giverRef,
      turnInTarget: main ? null : giverRef,
    };
  });
}

export function buildQuests(refs: StoryRefs): AuthoredQuestDefinition[] {
  return applyQuestPresentation([...mainQuests(), ...sideQuests(refs)], refs);
}
