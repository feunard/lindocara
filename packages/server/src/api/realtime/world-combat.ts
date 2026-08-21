/**
 * Authoritative damage, healing, monster defeat and projectiles. Nothing a client sends reaches
 * these functions unvalidated, and no outcome here is ever taken from the wire.
 *
 * Extracted from `worldTick.ts`, which had grown to 7100 lines and 136 declarations while its own
 * docblock still called it "the tick order". Same functions, same explicit-dependency shape; only
 * the file boundary is new.
 */

import { activePageIndex } from "@lindocara/engine/adventure-state.js";
import {
  actionForClassSlot,
  isMonsterRangedAction,
  MONSTER_SPECIAL_ACTIONS,
  monsterActionDefinition,
} from "@lindocara/engine/combat-actions.js";
import { CONSUMABLES } from "@lindocara/engine/consumables.js";
import {
  addThreat,
  isMeaningfulContribution,
  recordContribution,
  splitExperience,
  tauntThreat,
  usefulHealingThreat,
  withinRewardDistance,
} from "@lindocara/engine/cooperation.js";
import { canAct } from "@lindocara/engine/death.js";
import {
  circleIntersectsArc,
  circleIntersectsCapsule,
  frontalArc,
  normalizeGround,
  strikeCapsule,
} from "@lindocara/engine/directional-combat.js";
import {
  applyDamage,
  applyExperience,
  isMonsterSpecialTechnique,
  LOOT_EXPIRY_MS,
  MAX_MONSTER_BODY_REACH,
  type MonsterSpecialTechnique,
  type MonsterSpecies,
  maxHpForLevel,
  monsterBodyHitbox,
} from "@lindocara/engine/game.js";
import { type GroundVector, groundDistance, type WorldPosition } from "@lindocara/engine/ground.js";
import { authoredCellCentreGround } from "@lindocara/engine/map-events.js";
import type { QuestActor } from "@lindocara/engine/quest-runtime.js";
import { generateResource } from "@lindocara/engine/resources.js";
import { CLASS_SKILLS, type SkillDefinition } from "@lindocara/engine/skills.js";
import { talentEffect } from "@lindocara/engine/talents.js";
import {
  BODY_RADIUS,
  canStand,
  groundLineOfSight,
  groundUnder,
  nearestStandableCell,
} from "@lindocara/engine/terrain-access.js";
import { cancelCombatAction, startCombatAction } from "../../world/combat-action-system.js";
import {
  applyGuardDamage,
  guardedDamage,
  isPlayerInvulnerable,
} from "../../world/combat-system.js";
import { beginRewardAttribution, clearMonsterCombat } from "../../world/contribution-system.js";
import {
  removeDamageOverTimeByTarget,
  spreadDamageOverTime,
} from "../../world/damage-over-time-system.js";
import { startRun } from "../../world/event-run-system.js";
import { heroPartyState } from "../../world/party-system.js";
import { damageAfterPeasantCampProtection } from "../../world/peasant-support-system.js";
import {
  armLifeLink,
  cleanseNegativeEffect,
  emergencyMendPower,
  mirroredLifeLinkPower,
} from "../../world/priest-variant-system.js";
import {
  projectileOrigin,
  sameProjectileElevation,
  spawnProjectile,
} from "../../world/projectile-system.js";
import { questDefinition } from "../../world/quest-system.js";
import {
  applyCometExplosion,
  focusedVolleyPowerRatio,
  linePiercerPowerRatio,
} from "../../world/ranger-variant-system.js";
import {
  activeRogueOpening,
  armRogueExecution,
  consumeRogueOpening,
  exitRogueStealth,
  isRogueStealthed,
  resolveRogueExecutionKill,
} from "../../world/rogue-state-system.js";
import { movePlayerInDirection } from "../../world/skill-system.js";
import {
  activeRallyPowerMultiplier,
  chargeCounterOffensive,
  damageAfterWarriorProtection,
} from "../../world/warrior-variant-system.js";
import {
  type CombatActionRuntime,
  displacePlayer,
  type GroundLoot,
  type GuardRuntime,
  type MonsterRuntime,
  type PlayerRuntime,
  type ProjectileRuntime,
} from "../../world/world-runtime.js";
import type { MonsterDamageContext, WorldGlue } from "./world-glue.ts";
import {
  areCombatAllies,
  BODY_DIAMETER,
  configuredAttackDamage,
  configuredSkill,
  connectionOf,
  LOOT_DROP_OFFSET,
  playerById,
  questActor,
  zone,
} from "./world-glue.ts";
import { forgetPlayer, killPlayer } from "./world-move-life.ts";
import { sendSpatialEvent, sendStateTo } from "./world-send.ts";

/** Port of `#recordDamage` (`world.ts:3164`). */
export function recordDamage(
  player: PlayerRuntime,
  monster: MonsterRuntime,
  amount: number,
  now: number,
): void {
  if (amount <= 0 || monster.rewardsGranted) return;
  addThreat(monster.threat, player.id, amount, now);
  recordContribution(
    monster.contributions,
    player.id,
    { damage: amount, relevantThreat: amount },
    now,
  );
  generateResource(player.class, player.resource, "damage_dealt", amount);
}

/** Port of `#recordUsefulHeal` (`world.ts:3176`). */
export function recordUsefulHeal(
  w: WorldGlue,
  healer: PlayerRuntime,
  target: PlayerRuntime,
  amount: number,
  now: number,
): void {
  if (amount <= 0) return;
  generateResource(healer.class, healer.resource, "useful_healing", amount);
  const threat = usefulHealingThreat(amount);
  for (const monster of w.state.monsters) {
    if (
      monster.deadUntil > now ||
      (!monster.threat.has(target.id) && !monster.contributions.has(target.id))
    )
      continue;
    addThreat(monster.threat, healer.id, threat, now);
    recordContribution(
      monster.contributions,
      healer.id,
      { usefulHealing: amount, relevantThreat: threat },
      now,
    );
  }
}

/** Port of `#heroPartyMembers` (`world.ts:3206`). */
export function heroPartyMembers(w: WorldGlue, partyId: string): PlayerRuntime[] {
  return [...w.state.players.values()].filter(
    (player) => player.identityKind === "hero" && player.partyId === partyId && player.authorized,
  );
}

/** Port of `#rewardPartyMemberIds` (`world.ts:3216`), hero branch only (see `areCombatAllies`). */
export function rewardPartyMemberIds(w: WorldGlue, playerId: string): Iterable<string> {
  const player = playerById(w.state, playerId);
  if (player?.identityKind !== "hero" || player.partyId === null) return [];
  return heroPartyMembers(w, player.partyId).map((other) => other.id);
}

/** Port of `#broadcastHeroPartyStates` (`world.ts:3235`), gated on the last payload sent. */
export function broadcastHeroPartyStates(w: WorldGlue): void {
  const membersByParty = new Map<string, PlayerRuntime[]>();
  for (const player of w.state.players.values()) {
    if (player.identityKind !== "hero" || !player.authorized) continue;
    const partyId = player.partyId;
    if (partyId === null) continue;
    const members = membersByParty.get(partyId);
    if (members) members.push(player);
    else membersByParty.set(partyId, [player]);
  }
  for (const partyId of w.state.heroPartyBroadcasts.keys()) {
    if (!membersByParty.has(partyId)) w.state.heroPartyBroadcasts.delete(partyId);
  }
  for (const [partyId, members] of membersByParty) {
    const state = heroPartyState(partyId, members);
    const encoded = JSON.stringify(state);
    if (w.state.heroPartyBroadcasts.get(partyId) === encoded) continue;
    w.state.heroPartyBroadcasts.set(partyId, encoded);
    for (const member of members) {
      const connectionId = connectionOf(w.state, member.id);
      if (connectionId !== undefined) w.deps.send(connectionId, { t: "party.state", party: state });
    }
  }
}

/** Port of `#markMonsterDead` (`world.ts:3385`). Guard kills route here DIRECTLY — never through
 *  `defeatMonster` — which is what keeps a guard kill from ever paying a player. */
export function markMonsterDead(w: WorldGlue, monster: MonsterRuntime, now: number): void {
  cancelCombatAction(monster);
  removeDamageOverTimeByTarget(w.state.damageOverTime, "monster", monster.id);
  monster.deadUntil =
    monster.respawnMode === "never" ? Number.POSITIVE_INFINITY : now + monster.respawnDelayMs;
  monster.vx = 0;
  monster.vz = 0;
  if (monster.respawnMode !== "never" || !monster.id.startsWith("mon-")) return;
  w.deps.markPermanentMonsterDefeated(monster.id.slice(4));
}

/** Port of `#creditUndeadQuest` (`world.ts:3437`). */
export function creditUndeadQuest(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  monster: MonsterRuntime,
): void {
  if (
    player.quest.chapter !== "bone_choir" ||
    player.quest.status !== "active" ||
    monster.kind !== "skull"
  )
    return;
  const target = questDefinition(zone(w.state), "bone_choir")?.target;
  if (target === undefined) return;
  player.quest.progress = Math.min(target, player.quest.progress + 1);
  if (player.quest.progress >= target) {
    player.quest.status = "ready";
    w.deps.send(connectionId, { t: "event", code: "quest.chapter_ready", tone: "good" });
  } else
    w.deps.send(connectionId, {
      t: "event",
      code: "quest.site_progress",
      params: { progress: player.quest.progress, target },
      tone: "good",
    });
}

/** Port of `#defeatMonster` (`world.ts:3260`) minus the on-defeat event-run start (Task 7). */
export function defeatMonster(
  w: WorldGlue,
  player: PlayerRuntime,
  monster: MonsterRuntime,
  now: number,
  persistentOwnerCredit = false,
): void {
  if (!beginRewardAttribution(monster)) return;
  for (const [connectionId, candidate] of w.state.players) {
    const executor = talentEffect(candidate.class, candidate.talents, "rogue_executor", 2);
    if (
      executor &&
      candidate.authorized &&
      resolveRogueExecutionKill(candidate, monster.id, now, executor)
    )
      sendStateTo(w, connectionId, candidate);
  }
  for (const poison of [...w.state.damageOverTime].filter(
    (effect) =>
      effect.kind === "poison" && effect.targetKind === "monster" && effect.targetId === monster.id,
  )) {
    const source = playerById(w.state, poison.sourceId);
    const contagion = source
      ? talentEffect(source.class, source.talents, "rogue_contagion", 4)
      : undefined;
    if (!source?.authorized || !contagion) continue;
    const targets = w.state.monsters
      .filter(
        (candidate) =>
          candidate.id !== monster.id &&
          candidate.deadUntil <= now &&
          groundDistance(monster, candidate) <= contagion.range &&
          groundLineOfSight(zone(w.state).terrain, monster, candidate) &&
          !w.state.damageOverTime.some(
            (effect) =>
              effect.kind === "poison" &&
              effect.sourceId === source.id &&
              effect.targetKind === "monster" &&
              effect.targetId === candidate.id,
          ),
      )
      .sort(
        (left, right) =>
          groundDistance(monster, left) - groundDistance(monster, right) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(0, contagion.maximumTargets));
    const concentrated = talentEffect(source.class, source.talents, "rogue_concentrated_venom", 4);
    spreadDamageOverTime(
      w.state.damageOverTime,
      {
        kind: "poison",
        sourceId: source.id,
        sourceSkillId: "poisoned_shiv",
        targetKind: "monster",
        targetId: monster.id,
      },
      targets.map((target) => target.id),
      concentrated?.maxStacks ?? 1,
    );
  }
  markMonsterDead(w, monster, now);
  const directlyEligible = [...monster.contributions.values()]
    .filter((contribution) => {
      const candidate = playerById(w.state, contribution.playerId);
      return (
        candidate?.authorized === true &&
        candidate.life === "alive" &&
        withinRewardDistance(candidate, monster) &&
        isMeaningfulContribution(contribution)
      );
    })
    .map((entry) => entry.playerId);
  if (
    !directlyEligible.includes(player.id) &&
    player.authorized &&
    (persistentOwnerCredit || withinRewardDistance(player, monster))
  )
    directlyEligible.push(player.id);

  const eligible = new Set(directlyEligible);
  for (const contributorId of directlyEligible) {
    for (const memberId of rewardPartyMemberIds(w, contributorId)) {
      const member = playerById(w.state, memberId);
      if (member?.authorized && member.life === "alive" && withinRewardDistance(member, monster))
        eligible.add(memberId);
    }
  }

  // Experience is *split*, so sharing it with the party inflates nothing. Loot and quest credit
  // are minted per recipient — fight for your loot; stand near your friends for your XP.
  const contributors = new Set(directlyEligible);
  const killer = questActor(player);
  if (killer && player.partyId !== null && w.state.location !== null) {
    const actorsFor = (ids: Iterable<string>): QuestActor[] => {
      const actors: QuestActor[] = [];
      for (const id of ids) {
        const candidate = playerById(w.state, id);
        if (candidate?.partyId !== player.partyId) continue;
        const actor = questActor(candidate);
        if (actor) actors.push(actor);
      }
      return actors;
    };
    w.deps.recordQuestEvent(player.partyId, {
      id: crypto.randomUUID(),
      type: "monsterKilled",
      mapId: w.state.location.zoneId,
      monsterId: monster.id.startsWith("mon-") ? monster.id.slice(4) : monster.id,
      species: monster.species,
      killer,
      contributors: actorsFor(directlyEligible),
      nearbyParty: actorsFor(eligible),
    });
  }
  const shares = splitExperience(monster.xp, [...eligible]);
  for (const [playerId, xp] of shares) {
    const connectionId = connectionOf(w.state, playerId);
    const recipient = connectionId === undefined ? undefined : w.state.players.get(connectionId);
    if (connectionId === undefined || !recipient) continue;
    const result = applyExperience(recipient.level, recipient.xp, xp);
    recipient.level = result.level;
    recipient.xp = result.xp;
    if (result.levelsGained > 0) recipient.hp = maxHpForLevel(recipient.level);
    const earned = contributors.has(playerId);
    if (earned) creditUndeadQuest(w, connectionId, recipient, monster);

    if (earned) {
      const kind = w.state.tick % 4 === 0 ? "potion" : w.state.tick % 2 === 0 ? "crystal" : "gold";
      const droppedLoot: GroundLoot = {
        id: crypto.randomUUID(),
        kind,
        amount: kind === "gold" ? 4 : 1,
        x: monster.x + LOOT_DROP_OFFSET,
        y: monster.y,
        z: monster.z + LOOT_DROP_OFFSET,
        expiresAt: now + LOOT_EXPIRY_MS,
        ownerId: recipient.id,
      };
      w.state.loot.push(droppedLoot);
      w.state.lootGrid.insert(droppedLoot);
    }
    w.deps.send(
      connectionId,
      result.levelsGained > 0
        ? { t: "event", code: "level_up", params: { level: recipient.level }, tone: "good" }
        : {
            t: "event",
            code: "monster.defeated",
            params: { species: monster.species, xp },
            tone: "good",
          },
    );
    sendStateTo(w, connectionId, recipient);
    recipient.dirty = true;
  }
  triggerMonsterDefeatEvent(w, player, monster);
  clearMonsterCombat(monster);
}

/** Port of `#triggerMonsterDefeatEvent` (`world.ts:3417`): a defeated authored monster runs its
 *  active page's command program, triggered on behalf of the killing hero. */
export function triggerMonsterDefeatEvent(
  w: WorldGlue,
  player: PlayerRuntime,
  monster: MonsterRuntime,
): void {
  if (player.identityKind !== "hero" || !monster.id.startsWith("mon-")) return;
  const eventId = monster.id.slice(4);
  const event = w.state.location?.definition.events?.find(
    (candidate) => candidate.kind === "monster" && candidate.id === eventId,
  );
  if (!event) return;
  const pageIndex = activePageIndex(event, w.state.adventureState.state);
  if (pageIndex === null) return;
  const program = event.pages[pageIndex]?.commands;
  if (!program || program.length === 0) return;
  startRun(w.state.eventRuns, {
    event,
    pageIndex,
    program,
    heroId: player.id,
    runId: crypto.randomUUID(),
  });
}

// -------------------------------------------------------------------------------------------------
// Damage plumbing (players → monsters, monsters → players, projectiles)
// -------------------------------------------------------------------------------------------------

/** Port of `#tauntMonster` (`world.ts:2962`). */
export function tauntMonster(player: PlayerRuntime, target: MonsterRuntime, now: number): void {
  const previous = target.threat.get(player.id)?.amount ?? 0;
  const amount = tauntThreat(target.threat, player.id, now);
  recordContribution(
    target.contributions,
    player.id,
    { relevantThreat: Math.max(0, amount - previous) },
    now,
  );
}

/** Port of `#damageMonster` (`world.ts:2759`). */
export function damageMonster(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  target: MonsterRuntime,
  skill: SkillDefinition,
  now: number,
  basic: boolean,
  frozenPower?: number,
  context: MonsterDamageContext = {},
): { actualDamage: number; killed: boolean } | null {
  if (target.deadUntil > now) return null;
  const opening =
    basic && player.class === "rogue" && skill.id === "dual_slash"
      ? activeRogueOpening(player, now)
      : null;
  const baseDamage =
    frozenPower ??
    (basic ? configuredAttackDamage(w, player) : skill.power + Math.max(0, player.level - 1) * 2);
  const damage = Math.max(
    1,
    Math.round(
      baseDamage *
        (opening ? 1 + opening.bonusRatio : 1) *
        (player.damageBoostUntil > now ? 1 + CONSUMABLES.damage_elixir.effectValue : 1) *
        (1 + activeRallyPowerMultiplier(player, now)) *
        (target.weakness === player.class ? target.weaknessPercent / 100 : 1),
    ),
  );
  const actualDamage = Math.min(target.hp, damage);
  const result = applyDamage(target.hp, damage);
  target.hp = result.hp;
  recordDamage(player, target, actualDamage, now);
  if (opening) {
    if (opening.source === "shadow_step") {
      const executor = talentEffect(player.class, player.talents, "rogue_executor", 2);
      if (executor) armRogueExecution(player, target.id, now, executor);
    }
    consumeRogueOpening(player, now);
    sendStateTo(w, connectionId, player);
  }
  if (player.class === "warrior" && skill.id === "shield_bash") tauntMonster(player, target, now);
  if (!context.suppressHitEvent) {
    sendSpatialEvent(
      w,
      {
        t: "event",
        code: "combat.hit",
        params: {
          species: target.species,
          damage: actualDamage,
          skill: skill.id,
          actorId: player.id,
          // Presentation identity: clients interpolate the target in the past, so the impact must
          // attach to the rendered actor rather than the server's newer coordinate below.
          targetId: target.id,
          ...(basic ? { basic: 1 } : {}),
          ...(context.damageOverTime ? { poisonTick: 1 } : {}),
          ...(context.poisonRupture ? { poisonRupture: 1 } : {}),
        },
        tone: "info",
        x: target.x,
        z: target.z,
      },
      target,
    );
  }
  if (result.killed) defeatMonster(w, player, target, now, context.persistentOwnerCredit === true);
  return { actualDamage, killed: result.killed };
}

/** Port of `#healPlayer` (`world.ts:3101`): useful healing means actual missing HP restored. */
export function healPlayer(
  w: WorldGlue,
  casterConnectionId: string,
  caster: PlayerRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  amount: number,
  skillId: string,
  now: number,
  selfCast: boolean,
  mirrored = false,
): number {
  if (target.life !== "alive" || !areCombatAllies(caster, target)) return 0;
  const maxHp = maxHpForLevel(target.level);
  const actualAmount = Math.min(Math.max(0, amount), Math.max(0, maxHp - target.hp));
  if (actualAmount <= 0) return 0;
  target.hp += actualAmount;
  target.dirty = true;
  recordUsefulHeal(w, caster, target, actualAmount, now);
  if (targetConnectionId !== casterConnectionId) {
    w.deps.send(casterConnectionId, {
      t: "event",
      code: "heal.cast",
      params: {
        name: target.nick,
        amount: actualAmount,
        color: caster.appearance.primaryColor,
        skill: skillId,
      },
      tone: "good",
      x: target.x,
      z: target.z,
    });
  }
  w.deps.send(targetConnectionId, {
    t: "event",
    code: selfCast && targetConnectionId === casterConnectionId ? "heal.cast" : "heal.received",
    params: {
      name: caster.nick,
      amount: actualAmount,
      color: caster.appearance.primaryColor,
      skill: skillId,
    },
    tone: "good",
    x: target.x,
    z: target.z,
  });
  sendStateTo(w, targetConnectionId, target);
  if (!mirrored) mirrorLifeLinks(w, target, actualAmount, now);
  return actualAmount;
}

export function mirrorLifeLinks(
  w: WorldGlue,
  healedTarget: PlayerRuntime,
  usefulHealing: number,
  now: number,
): void {
  for (const [ownerConnectionId, owner] of w.state.players) {
    owner.priestLifeLinks = owner.priestLifeLinks.filter((link) => link.expiresAt > now);
    for (const link of owner.priestLifeLinks) {
      const linkedConnectionId = connectionOf(w.state, link.targetId);
      if (linkedConnectionId === undefined) continue;
      const linked = w.state.players.get(linkedConnectionId);
      if (
        linked?.life !== "alive" ||
        owner.life !== "alive" ||
        groundDistance(owner, linked) > link.range ||
        !groundLineOfSight(zone(w.state).terrain, owner, linked)
      )
        continue;
      const counterpart =
        healedTarget.id === owner.id
          ? { connectionId: linkedConnectionId, player: linked }
          : healedTarget.id === linked.id
            ? { connectionId: ownerConnectionId, player: owner }
            : null;
      if (!counterpart) continue;
      const power = mirroredLifeLinkPower(usefulHealing, link);
      if (power <= 0) continue;
      healPlayer(
        w,
        ownerConnectionId,
        owner,
        counterpart.connectionId,
        counterpart.player,
        power,
        "mend",
        now,
        counterpart.player === owner,
        true,
      );
    }
  }
}

/** Port of `#damagePlayer` (`world.ts:5583`). */
export function damagePlayer(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  damage: number,
  species: MonsterSpecies,
  monsterId: string,
  now: number,
  technique?: Exclude<MonsterSpecialTechnique, "none">,
  oneHitKill = false,
): void {
  if (isPlayerInvulnerable(player, now)) return;
  const hpBefore = player.hp;
  const stealthEnded = exitRogueStealth(player, now);
  if (oneHitKill) {
    player.hp = 0;
    generateResource(player.class, player.resource, "damage_taken", hpBefore);
    player.dirty = true;
    w.deps.send(connectionId, {
      t: "event",
      code: "combat.hurt",
      params: { species, damage: hpBefore, monsterId, ...(technique ? { technique } : {}) },
      tone: "bad",
      x: player.x,
      z: player.z,
    });
    killPlayer(w, connectionId, player);
    sendStateTo(w, connectionId, player);
    return;
  }
  const protectedDamage = damageAfterWarriorProtection(
    player,
    damage,
    w.state.players.values(),
    now,
    (source, target) => areCombatAllies(source, target),
    (source, target) => groundLineOfSight(zone(w.state).terrain, source, target),
    (protector, prevented) =>
      chargeCounterOffensive(
        protector,
        prevented,
        talentEffect(protector.class, protector.talents, "counter_offensive", 2),
        "ally",
      ),
  );
  const campProtectedDamage = damageAfterPeasantCampProtection(
    player,
    protectedDamage,
    w.state.peasantSupport.camps,
    zone(w.state).terrain,
    now,
  );
  const {
    amount: appliedDamage,
    result,
    parried,
    prevented,
    retaliationRatio,
  } = guardedDamage(player, campProtectedDamage, now);
  chargeCounterOffensive(
    player,
    prevented,
    talentEffect(player.class, player.talents, "counter_offensive", 2),
    parried ? "parry" : "guard",
  );
  if (parried) {
    w.deps.send(connectionId, {
      t: "event",
      code: "talent.perfect_parry",
      tone: "good",
      x: player.x,
      z: player.z,
    });
    const attacker = w.state.monsters.find(
      (monster) => monster.id === monsterId && monster.deadUntil <= now,
    );
    if (attacker && retaliationRatio > 0) {
      const guardSkill = configuredSkill(w, player, 2);
      damageMonster(
        w,
        connectionId,
        player,
        attacker,
        guardSkill,
        now,
        false,
        Math.max(1, Math.round(damage * retaliationRatio)),
      );
    }
    if (stealthEnded) sendStateTo(w, connectionId, player);
    return;
  }
  const soulAnchor = player.priestSoulAnchor;
  if (
    result.killed &&
    soulAnchor &&
    soulAnchor.expiresAt > now &&
    // Grounded on the anchor's OWN remembered elevation, exactly as `planShadowReturn` re-validates
    // a remembered landing: the anchor was placed where a body could stand, and the rescue may not
    // become a free climb onto ground the priest could never have reached.
    canStand(zone(w.state).terrain, soulAnchor.x, soulAnchor.z, BODY_RADIUS, soulAnchor.y)
  ) {
    const owner = playerById(w.state, soulAnchor.ownerId);
    if (owner?.authorized && owner.life === "alive" && areCombatAllies(owner, player)) {
      const terrain = zone(w.state).terrain;
      const previous = { x: player.x, y: player.y, z: player.z };
      player.hp = 1;
      displacePlayer(player, {
        x: soulAnchor.x,
        y: groundUnder(terrain, soulAnchor.x, soulAnchor.z, soulAnchor.y),
        z: soulAnchor.z,
      });
      player.priestSoulAnchor = null;
      if (soulAnchor.cleansePoison) {
        cleanseNegativeEffect(player, "poison");
        removeDamageOverTimeByTarget(w.state.damageOverTime, "player", player.id);
      }
      w.state.playerGrid.update(player, previous);
      const anchorDamage = Math.max(0, hpBefore - 1);
      generateResource(player.class, player.resource, "damage_taken", anchorDamage);
      player.dirty = true;
      w.deps.send(connectionId, {
        t: "event",
        code: "combat.hurt",
        params: {
          species,
          damage: anchorDamage,
          monsterId,
          ...(technique ? { technique } : {}),
        },
        tone: "bad",
        x: player.x,
        z: player.z,
      });
      sendStateTo(w, connectionId, player);
      return;
    }
  }
  player.hp = result.hp;
  generateResource(player.class, player.resource, "damage_taken", appliedDamage);
  player.dirty = true;
  w.deps.send(connectionId, {
    t: "event",
    code: "combat.hurt",
    // Keep the damage event tied to the same authoritative attacker as the spatial animation.
    params: { species, damage: appliedDamage, monsterId, ...(technique ? { technique } : {}) },
    tone: "bad",
    x: player.x,
    z: player.z,
  });
  if (result.killed) killPlayer(w, connectionId, player);
  sendStateTo(w, connectionId, player);
}

/** Server-authored environmental damage used by event traps. It has no fake monster identity. */
export function damagePlayerFromEvent(
  w: WorldGlue,
  connectionId: string,
  player: PlayerRuntime,
  amount: number,
  lethal: boolean,
  now: number,
): void {
  if (isPlayerInvulnerable(player, now) || player.life !== "alive") return;
  exitRogueStealth(player, now);
  const appliedDamage = lethal ? player.hp : Math.min(player.hp, Math.max(0, amount));
  if (appliedDamage <= 0) return;
  player.hp = Math.max(0, player.hp - appliedDamage);
  generateResource(player.class, player.resource, "damage_taken", appliedDamage);
  player.dirty = true;
  w.deps.send(connectionId, {
    t: "event",
    code: "hazard.hit",
    params: { damage: appliedDamage },
    tone: "bad",
    x: player.x,
    z: player.z,
  });
  if (player.hp <= 0) killPlayer(w, connectionId, player);
  sendStateTo(w, connectionId, player);
}

// -------------------------------------------------------------------------------------------------
// Monster combat
// -------------------------------------------------------------------------------------------------

/** Port of `#startMonsterAttack` (`world.ts:5475`): the strike direction freezes at wind-up. */
export function startMonsterAttack(
  w: WorldGlue,
  monster: MonsterRuntime,
  target: PlayerRuntime | GuardRuntime,
  now: number,
): void {
  if (monster.deadUntil > now || monster.action) return;
  const specialTechnique =
    monster.specialTechnique !== "none" && now >= monster.nextSpecialAt
      ? monster.specialTechnique
      : null;
  const basicDefinition = monsterActionDefinition(monster.species, monster.attackProfile);
  const definition = specialTechnique ? MONSTER_SPECIAL_ACTIONS[specialTechnique] : basicDefinition;
  const direction = normalizeGround(
    { x: target.x - monster.x, z: target.z - monster.z },
    monster.facing,
  );
  monster.facing = direction;
  const action = startCombatAction(monster, {
    kind: "monster_attack",
    ...(specialTechnique ? { skillId: specialTechnique } : {}),
    direction,
    now,
    anticipationMs: definition.anticipationMs,
    recoveryMs: definition.recoveryMs,
  });
  if (!action) return;
  if (specialTechnique) {
    monster.nextSpecialAt = now + MONSTER_SPECIAL_ACTIONS[specialTechnique].cooldownMs;
  }
  sendSpatialEvent(
    w,
    {
      t: "animation",
      actionId: action.id,
      actorKind: "monster",
      actorId: monster.id,
      action: specialTechnique ? "skill" : "attack",
      ...(specialTechnique ? { skillId: specialTechnique } : {}),
      direction: { x: action.direction.x, z: action.direction.z },
      startedAt: action.startedAt,
      impactAt: action.impactAt,
      recoveryEndsAt: action.recoveryEndsAt,
    },
    monster,
  );
  // Basic ranged attacks have no anticipation phase: accepting the attack and launching its
  // projectile are one authoritative operation. This also covers attacks selected during the
  // guard pass, which runs after the ordinary action-resolution pass for this tick. Marking the
  // action first keeps `advanceCombatActions` as the single-spawn backstop on later ticks.
  if (
    !specialTechnique &&
    action.impactAt <= now &&
    isMonsterRangedAction(basicDefinition) &&
    !action.resolved
  ) {
    action.resolved = true;
    resolveMonsterAction(w, monster, action, now);
  }
}

/** Port of `#resolveMonsterAction` (`world.ts:5518`): damages only actors still inside the frozen
 *  capsule/arc at the active frame — and only actors that are `alive` (the corpse-run guarantee). */
export function resolveMonsterAction(
  w: WorldGlue,
  monster: MonsterRuntime,
  action: CombatActionRuntime,
  now: number,
): void {
  if (monster.deadUntil > now) return;
  const specialTechnique =
    action.skillId && isMonsterSpecialTechnique(action.skillId) && action.skillId !== "none"
      ? action.skillId
      : null;
  const specialDefinition = specialTechnique ? MONSTER_SPECIAL_ACTIONS[specialTechnique] : null;
  const definition = monsterActionDefinition(monster.species, monster.attackProfile);
  if (!specialDefinition && isMonsterRangedAction(definition)) {
    const origin = projectileOrigin(monster, action.direction, definition.projectile.radius);
    spawnProjectile(w.state.projectiles, {
      actionId: action.id,
      owner: monster,
      roomKey: w.state.roomKey,
      origin,
      direction: action.direction,
      definition: definition.projectile,
      range: definition.range,
      power: monster.damage,
      targetFilter: "players_and_guards",
      sourceSkillId: "monster_ranged_attack",
      basic: true,
      now,
    });
    return;
  }
  // A tile-unit position is already the body's CENTRE, so the pixel path's `+ PLAYER_SIZE / 2`
  // recentring is gone; keeping it would have started every strike half a body off its own origin.
  const origin: GroundVector = { x: monster.x, z: monster.z };
  if (specialTechnique) {
    sendSpatialEvent(
      w,
      {
        t: "monster.special_impact",
        actionId: action.id,
        actorId: monster.id,
        technique: specialTechnique,
        x: origin.x,
        z: origin.z,
        direction: { x: action.direction.x, z: action.direction.z },
        impactAt: now,
      },
      origin,
    );
  }
  const hitbox = specialDefinition
    ? null
    : strikeCapsule(origin, action.direction, definition.range, definition.hitboxRadius);
  const arc =
    specialDefinition?.shape === "cone"
      ? frontalArc(
          origin,
          action.direction,
          specialDefinition.range,
          specialDefinition.halfAngleRadians ?? Math.PI / 3,
        )
      : null;
  const damage = Math.max(
    1,
    Math.round(monster.damage * (specialDefinition?.damageMultiplier ?? 1)),
  );
  let drainedDamage = 0;
  const hits = (target: GroundVector, radius: number): boolean => {
    if (!groundLineOfSight(zone(w.state).terrain, monster, target)) return false;
    const circle = { center: { x: target.x, z: target.z }, radius };
    if (hitbox) return circleIntersectsCapsule(circle, hitbox);
    if (arc) return circleIntersectsArc(circle, arc);
    return (
      specialDefinition !== null &&
      groundDistance(origin, circle.center) <= specialDefinition.range + radius
    );
  };
  for (const [connectionId, player] of w.state.players) {
    const silhouette = player.rogueSilhouette;
    if (
      !silhouette ||
      silhouette.expiresAt <= now ||
      !monster.threat.has(player.id) ||
      !hits(silhouette, BODY_RADIUS)
    )
      continue;
    silhouette.hp = Math.max(0, silhouette.hp - damage);
    monster.revealedUntil = Math.max(monster.revealedUntil, now + 900);
    if (silhouette.hp <= 0) {
      player.rogueSilhouette = null;
      forgetPlayer(w, player);
    }
    sendStateTo(w, connectionId, player);
  }
  for (const [connectionId, player] of w.state.players) {
    if (
      !player.authorized ||
      player.life !== "alive" ||
      player.forgottenUntil > now ||
      player.invisibleUntil > now ||
      isRogueStealthed(player, now) ||
      player.transitioning ||
      !hits(player, BODY_RADIUS)
    )
      continue;
    damagePlayer(
      w,
      connectionId,
      player,
      damage,
      monster.species,
      monster.id,
      now,
      specialTechnique ?? undefined,
      monster.oneHitKill,
    );
    drainedDamage += damage;
  }
  for (const guard of w.state.guards) {
    if (!hits(guard, BODY_RADIUS)) continue;
    applyGuardDamage(guard, damage);
    drainedDamage += damage;
  }
  const healRatio =
    specialDefinition && "healRatio" in specialDefinition ? specialDefinition.healRatio : 0;
  if (healRatio > 0) {
    monster.hp = Math.min(monster.maxHp, monster.hp + Math.round(drainedDamage * healRatio));
  }
}

// -------------------------------------------------------------------------------------------------
// Projectiles
// -------------------------------------------------------------------------------------------------

/** Port of `#projectileOwner` (`world.ts:5296`). */
export function projectileOwner(
  w: WorldGlue,
  projectile: ProjectileRuntime,
): { connectionId: string; player: PlayerRuntime } | null {
  const connectionId = connectionOf(w.state, projectile.ownerId);
  const player = connectionId === undefined ? undefined : w.state.players.get(connectionId);
  if (
    connectionId === undefined ||
    !player?.authorized ||
    player.transitioning ||
    player.roomKey !== projectile.roomKey ||
    player.partyId !== projectile.ownerPartyId
  )
    return null;
  return { connectionId, player };
}

/** Port of `#projectileDamage` (`world.ts:5310`). */
export function projectileDamage(
  w: WorldGlue,
  projectile: ProjectileRuntime,
  monster: MonsterRuntime,
  now: number,
): void {
  const owner = projectileOwner(w, projectile);
  if (!owner || !canAct(owner.player.life)) return;
  const baseSkill = CLASS_SKILLS[owner.player.class].find(
    (candidate) => candidate.id === projectile.sourceSkillId,
  );
  if (!baseSkill) return;
  const skill = configuredSkill(w, owner.player, baseSkill.slot);
  const execute = talentEffect(owner.player.class, owner.player.talents, "execute", skill.slot);
  const linePiercer = talentEffect(
    owner.player.class,
    owner.player.talents,
    "line_piercer",
    skill.slot,
  );
  const focusedVolley = talentEffect(
    owner.player.class,
    owner.player.talents,
    "focused_volley",
    skill.slot,
  );
  const cometArrow = talentEffect(
    owner.player.class,
    owner.player.talents,
    "comet_arrow",
    skill.slot,
  );
  let power = projectile.power;
  if (linePiercer)
    power = Math.round(power * linePiercerPowerRatio(projectile.hitEntityIds.size, linePiercer));
  if (focusedVolley) {
    const hitCount = projectile.activationHitCounts?.get(monster.id) ?? 1;
    power = Math.round(power * focusedVolleyPowerRatio(hitCount, focusedVolley));
  }
  if (cometArrow) power = Math.round(power * Math.max(0, cometArrow.directPowerRatio));
  if (execute && monster.hp / Math.max(1, monster.maxHp) <= execute.threshold)
    power = Math.round(power * (1 + execute.multiplier));
  damageMonster(w, owner.connectionId, owner.player, monster, skill, now, projectile.basic, power);
  if (cometArrow) {
    const cometCenter = monsterBodyHitbox(monster.species, monster).center;
    applyCometExplosion(
      w.state.monsterGrid.queryRadius(
        cometCenter,
        cometArrow.radius + BODY_DIAMETER + MAX_MONSTER_BODY_REACH,
      ),
      monster.id,
      cometArrow,
      (candidate, radius) =>
        candidate.deadUntil <= now &&
        sameProjectileElevation(projectile.y, candidate.y, zone(w.state).terrain.levelHeight) &&
        monsterHitboxWithin(cometCenter, candidate, radius) &&
        groundLineOfSight(zone(w.state).terrain, monster, candidate),
      (candidate, powerRatio) =>
        damageMonster(
          w,
          owner.connectionId,
          owner.player,
          candidate,
          skill,
          now,
          false,
          Math.max(1, Math.round(projectile.power * powerRatio)),
        ),
    );
  }
  const ricochet = talentEffect(owner.player.class, owner.player.talents, "ricochet", skill.slot);
  if (!ricochet || projectile.ricochetRemaining <= 0) return;
  const target = w.state.monsterGrid
    .queryRadius(monster, ricochet.range)
    .filter(
      (candidate) =>
        candidate.id !== monster.id &&
        candidate.deadUntil <= now &&
        !projectile.hitEntityIds.has(candidate.id) &&
        groundLineOfSight(zone(w.state).terrain, monster, candidate),
    )
    .sort((a, b) => groundDistance(monster, a) - groundDistance(monster, b))[0];
  const definition = actionForClassSlot(owner.player.class, skill.slot).projectile;
  if (!target || !definition) return;
  const direction = normalizeGround({ x: target.x - monster.x, z: target.z - monster.z });
  // A ricochet leaves the BODY IT BOUNCED OFF, not a muzzle: the pixel path spawned it at the
  // struck monster's centre with no muzzle offset, and `projectileOrigin` would add one
  // (`BODY_RADIUS` + the shot's radius + 2 px of daylight). That is a balance change, not a units
  // conversion, so the centre is carried through verbatim — with the monster's elevation, which is
  // the bounce's flight height.
  const origin: WorldPosition = { x: monster.x, y: monster.y, z: monster.z };
  spawnProjectile(w.state.projectiles, {
    actionId: crypto.randomUUID(),
    owner: owner.player,
    roomKey: owner.player.roomKey,
    origin,
    direction,
    definition: { ...definition, pierce: 0 },
    range: ricochet.range,
    power: Math.max(1, Math.round(projectile.power * ricochet.ratio)),
    targetFilter: "monsters",
    sourceSkillId: skill.id,
    basic: false,
    now,
    ricochetRemaining: projectile.ricochetRemaining - 1,
  });
}

/** Port of `#projectileHeal` (`world.ts:5405`). */
export function projectileHeal(
  w: WorldGlue,
  projectile: ProjectileRuntime,
  targetConnectionId: string,
  target: PlayerRuntime,
  now: number,
): void {
  const owner = projectileOwner(w, projectile);
  if (!owner || !canAct(owner.player.life) || !areCombatAllies(owner.player, target)) return;
  const baseSkill = CLASS_SKILLS[owner.player.class].find(
    (candidate) => candidate.id === projectile.sourceSkillId,
  );
  const emergency = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "emergency_mend", baseSkill.slot)
    : undefined;
  const targetWasCritical =
    target.hp / Math.max(1, maxHpForLevel(target.level)) <= (emergency?.threshold ?? 0);
  const healingPower = emergency
    ? emergencyMendPower(projectile.power, target.hp, maxHpForLevel(target.level), emergency)
    : projectile.power;
  const restored = healPlayer(
    w,
    owner.connectionId,
    owner.player,
    targetConnectionId,
    target,
    healingPower,
    projectile.sourceSkillId,
    now,
    false,
  );
  const lifeLink = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "life_link", baseSkill.slot)
    : undefined;
  const chain = baseSkill
    ? talentEffect(owner.player.class, owner.player.talents, "chain_heal", baseSkill.slot)
    : undefined;
  if (lifeLink && restored > 0) {
    armLifeLink(
      owner.player,
      target.id,
      lifeLink,
      now,
      emergency && targetWasCritical ? "emergency" : chain ? "chain" : "base",
    );
  }
  if (!chain || restored <= 0) return;
  const chained = [...w.state.players]
    .filter(
      ([, candidate]) =>
        candidate.id !== target.id &&
        candidate.id !== owner.player.id &&
        candidate.life === "alive" &&
        candidate.hp < maxHpForLevel(candidate.level) &&
        areCombatAllies(owner.player, candidate) &&
        groundDistance(target, candidate) <= chain.range &&
        groundLineOfSight(zone(w.state).terrain, target, candidate),
    )
    .sort(([, a], [, b]) => groundDistance(target, a) - groundDistance(target, b))[0];
  if (chained) {
    const chainedHealing = healPlayer(
      w,
      owner.connectionId,
      owner.player,
      chained[0],
      chained[1],
      Math.max(1, Math.round(projectile.power * chain.ratio)),
      projectile.sourceSkillId,
      now,
      false,
    );
    if (lifeLink && chainedHealing > 0)
      armLifeLink(owner.player, chained[1].id, lifeLink, now, "chain");
  }
}

/** Port of `#projectileBlocked` (`world.ts:5462`). */
export function projectileBlocked(
  w: WorldGlue,
  projectile: ProjectileRuntime,
  point: GroundVector,
): void {
  const owner = projectileOwner(w, projectile);
  if (!owner) return;
  w.deps.send(owner.connectionId, {
    t: "event",
    code: "skill.blocked",
    params: { skill: projectile.sourceSkillId },
    tone: "info",
    x: point.x,
    z: point.z,
  });
}

// -------------------------------------------------------------------------------------------------
// Player actions: start, resolve, variants
// -------------------------------------------------------------------------------------------------

/** Port of `#movePlayerInDirection` (`world.ts:2749`). */
export function movePlayer(
  w: WorldGlue,
  player: PlayerRuntime,
  direction: GroundVector,
  distance: number,
): boolean {
  return movePlayerInDirection(
    player,
    direction,
    distance,
    zone(w.state).terrain,
    w.state.playerGrid,
  );
}

// `bodyCenter` is gone rather than converted: it existed only to turn a pixel position — a 32 px
// box's TOP-LEFT corner — into the body's centre, and a tile-unit position already is that centre.
// Kept as an identity helper it would read as meaningful and invite a second recentring.

export function monsterHitboxWithin(
  center: GroundVector,
  monster: MonsterRuntime,
  range: number,
): boolean {
  const hitbox = monsterBodyHitbox(monster.species, monster);
  return groundDistance(center, hitbox.center) <= range + hitbox.radius;
}

/**
 * Live bodies are deliberately checked only when Lumen rematerialises, never while it phases.
 *
 * TILE UNITS, and every position is a body CENTRE — so the pixel version's `+ PLAYER_SIZE / 2`
 * recentring is gone and `PLAYER_SIZE` (a diameter) is `2 * BODY_RADIUS`.
 */
export function lumenLandingClear(
  w: WorldGlue,
  player: PlayerRuntime,
  candidate: GroundVector,
  now: number,
  /** The map's grid side, which is what turns an authored cell index into a world coordinate. */
  gridSize: number,
): boolean {
  const center = { x: candidate.x, z: candidate.z };
  for (const other of w.state.players.values()) {
    if (
      other !== player &&
      other.authorized &&
      other.life !== "ghost" &&
      groundDistance(candidate, other) < 2 * BODY_RADIUS
    )
      return false;
  }
  for (const monster of w.state.monsters) {
    if (monster.deadUntil <= now && monsterHitboxWithin(center, monster, BODY_RADIUS)) return false;
  }
  for (const guard of w.state.guards) {
    if (guard.hp > 0 && groundDistance(candidate, guard) < 2 * BODY_RADIUS) return false;
  }
  for (const event of w.state.activeEvents) {
    const movement = w.state.npcMovement.get(event.id);
    if (!movement || movement.through || event.graphicAssetId === null) continue;
    // `authoredCellCentreGround`, not `eventCellCentre`: the latter answers in the editor's PIXEL,
    // top-left-origin space, so measuring it against a tile-unit centre gives hundreds against a
    // half-tile threshold and the clause can never reject. A dead authority check that reads as
    // live is worse than no check at all.
    const npcCentre = authoredCellCentreGround(event, gridSize);
    if (groundDistance(center, npcCentre) < 2 * BODY_RADIUS) return false;
  }
  return true;
}

/**
 * Where a held Pas de Lumen actually comes back to the world.
 *
 * All THREE axes travel out of here. The previous version returned a two-axis value whose `y` was a
 * GROUND coordinate, and the caller wrote it straight into `player.y` — the ELEVATION field — so a
 * priest's rematerialisation buried or launched them by the width of the map. The landing's `y` is
 * now the ground under it, read from the terrain, and its ground pair is `x`/`z`.
 *
 * `groundY` is the priest's own level: `MAX_STEP` is 0, so phasing crosses relief without climbing
 * it, and a landing on top of a plateau the priest could not have walked onto is refused.
 */
export function safeLumenLanding(
  w: WorldGlue,
  player: PlayerRuntime,
  desired: GroundVector,
  now: number,
): WorldPosition | null {
  const terrain = zone(w.state).terrain;
  const groundY = groundUnder(terrain, player.x, player.z, player.y);
  if (
    canStand(terrain, desired.x, desired.z, BODY_RADIUS, groundY) &&
    lumenLandingClear(w, player, desired, now, terrain.size)
  ) {
    return {
      x: desired.x,
      y: groundUnder(terrain, desired.x, desired.z, groundY),
      z: desired.z,
    };
  }
  return nearestStandableCell(terrain, desired, BODY_RADIUS, groundY, (candidate) =>
    lumenLandingClear(w, player, candidate, now, terrain.size),
  );
}
