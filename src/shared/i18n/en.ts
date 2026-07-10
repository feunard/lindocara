/**
 * Every player-facing string, EN. Keys are stable identifiers; fr.ts must cover exactly
 * this set (enforced by its Record type). Platform-free: data only.
 */

export const en = {
  // Auth screen
  "auth.eyebrow": "A tiny online world",
  "auth.subtitle": "Everwild Hollow",
  "auth.tagline":
    "Wake beneath the Heartroot. Swear Elowen's oath. Face the strange life of the Gloamwood.",
  "auth.tab.login": "Log in",
  "auth.tab.register": "Create account",
  "auth.username": "Username",
  "auth.password": "Password",
  "auth.password_confirm": "Confirm password",
  "auth.submit.login": "Enter the Hollow",
  "auth.submit.register": "Create account",
  "auth.error.username_taken": "That username is already taken.",
  "auth.error.invalid_credentials": "Wrong username or password.",
  "auth.error.invalid_username":
    "Username must be 2-16 characters: letters, digits, underscore or hyphen.",
  "auth.error.invalid_password": "Password must be 8-128 characters.",
  "auth.error.password_mismatch": "Passwords do not match.",
  "auth.error.generic": "Something went wrong. Try again.",

  // Character select
  "chars.title": "Choose your wayfarer",
  "chars.new": "New character",
  "chars.play": "Play",
  "chars.delete": "Delete",
  "chars.delete_confirm": "Delete forever?",
  "chars.create.title": "New wayfarer",
  "chars.create.name": "Name",
  "chars.create.appearance": "Appearance",
  "chars.create.submit": "Create",
  "chars.create.cancel": "Cancel",
  "chars.error.limit_reached": "This account already has 3 characters.",
  "chars.error.invalid_name":
    "Name must be 2-16 characters: letters, digits, underscore or hyphen.",
  "chars.logout": "Log out",
  "appearance.azure": "Azure",
  "appearance.ember": "Ember",
  "appearance.moss": "Moss",
  "appearance.violet": "Violet",

  // HUD
  "hud.level": "Level {level}",
  "hud.lv": "Lv {level}",
  "hud.vit": "VIT",
  "hud.spark": "SPARK",
  "hud.oath": "Active Oath",
  "hud.strike": "Strike",
  "hud.pack": "Wayfarer's Pack",
  "hud.switch_character": "Switch character",
  "hud.logout": "Log out",

  // Items
  "item.potion": "Heartroot tonic",
  "item.gold": "Sunmarks",
  "item.crystal": "Gloam shards",
  "item.sword": "Weathered blade",
  "item.sword_on": "On",

  // Quest panel
  "quest.available": "Keeper Elowen waits beside the Heartroot.",
  "quest.active": "Quiet gloam creatures in the woods ({progress}/{target})",
  "quest.ready": "Return to Elowen at the Heartroot.",
  "quest.completed": "The Gloamcap Oath is fulfilled.",

  // Prompts
  "prompt.close_interior": "[E] Close threshold view",
  "prompt.look_inside": "[E] Look inside {name}",
  "prompt.swear": "[E] Swear the Gloamcap Oath",
  "prompt.claim": "[E] Claim your reward",
  "prompt.speak": "[E] Speak with Elowen",
  "prompt.hunt": "Follow the Old Road - hunt gloam creatures [Space]",
  "prompt.approach": "Approach the golden marker - Keeper Elowen [E]",

  // Chat, help, status
  "chat.title": "Campfire voices",
  "chat.placeholder": "Enter: chat...",
  "help.move": "move",
  "help.strike": "strike",
  "help.commune": "commune",
  "help.tonic": "tonic",
  "status.connecting": "connecting as {name}...",
  "status.connected": "connected - Everwild Hollow",
  "status.disconnected": "disconnected - {reason}",
  "status.welcome_hint": "Elowen stands beside the golden marker. Press [E] to begin.",
  "status.connection_lost": "Connection lost. Reload to rejoin.",

  // NPC
  "npc.warden.name": "Keeper Elowen",
  "npc.warden.role": "The Gloamcap Oath",

  // Monsters (keys match MonsterSpecies, Task 9)
  "monster.gloamcap": "Gloamcap",
  "monster.murkbud": "Murkbud",
  "monster.briar_ooze": "Briar Ooze",
  "monster.relic_ooze": "Relic Ooze",
  "monster.mire_murkbud": "Mire Murkbud",
  "monster.vault_gloamcap": "Vault Gloamcap",

  // Zones
  "zone.heartroot_crossing": "Heartroot Crossing",
  "zone.old_road": "The Old Road",
  "zone.sunwake_clearing": "Sunwake Clearing",
  "zone.gloamwood": "Gloamwood",
  "zone.old_root_farm": "Old Root Farm",
  "zone.moonmere_reach": "Moonmere Reach",
  "zone.wayfarer_camp": "Wayfarer Camp",
  "zone.elderfall_ruins": "Elderfall Ruins",
  "zone.duskmire": "Duskmire",
  "zone.sealed_gate": "The Sealed Gate",

  // Points of interest
  "poi.heartroot": "The Heartroot",
  "poi.crossing_square": "Crossing Square",
  "poi.three_way_stone": "Three-Way Stone",
  "poi.sunwake_ring": "Sunwake Ring",
  "poi.old_root_farm": "Old Root Farm",
  "poi.old_bridge": "The Old Bridge",
  "poi.moonmere_reach": "Moonmere Reach",
  "poi.reedwater_ford": "Reedwater Ford",
  "poi.elderfall_court": "Elderfall Court",
  "poi.wayfarer_camp": "Wayfarer Camp",
  "poi.mireheart": "Mireheart",
  "poi.sealed_gate": "The Sealed Gate",

  // Interiors
  "interior.crossing-hall.name": "Crossing Hall",
  "interior.crossing-hall.copy":
    "A low fire, drying herbs, a cedar chest, and a quiet keeper sorting charms.",
  "interior.lantern-house.name": "Lantern House",
  "interior.lantern-house.copy":
    "Weathered tools, sacks of seed, a workbench, and a map of paths swallowed by moss.",
  "interior.wayfarer-rest.name": "Wayfarer Rest",
  "interior.wayfarer-rest.copy":
    "Warm coals, patched shutters, and a chest marked with the old village seal.",
  "interior.bramblewick-farm.name": "Bramblewick Farm",
  "interior.bramblewick-farm.copy":
    "Dusty tools, empty seed racks, and a route map pinned beneath a cracked window.",
  "interior.close": "Close threshold view",

  // Server events (wired in Task 9; declared now so the dictionaries are written once)
  "event.wake": "You wake beneath the Heartroot. Elowen, marked in gold, awaits your oath [E].",
  "event.combat.too_far": "Too far — step closer to strike.",
  "event.combat.hit": "You hit {species} for {damage}.",
  "event.combat.hurt": "{species} hits you for {damage}.",
  "event.monster.defeated": "Defeated {species}: +{xp} XP.",
  "event.level_up": "Level up! You are now level {level}.",
  "event.interact.nothing": "There is nothing close enough to interact with.",
  "event.quest.accepted": "Oath sworn — quiet {target} gloam creatures beyond the Heartroot.",
  "event.quest.progress": "{progress}/{target} quieted. The woods still stir.",
  "event.quest.fulfilled": "The Gloamcap Oath is fulfilled: +100 XP, +20 gold, +2 tonics.",
  "event.quest.blessing": "Elowen: the Heartroot remembers your courage.",
  "event.potion.used": "Heartroot tonic: +{heal} HP.",
  "event.player.down": "{name} was knocked out.",
  "event.respawn": "The Heartroot calls you home.",
  "event.loot.picked": "Picked up {amount} {kind}.",
} as const satisfies Record<string, string>;
