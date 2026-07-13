import type { ZoneDefinition, ZoneLocation } from "../../shared/zones.js";
import { createGuards, createMonsters, type RoomContext } from "./world-runtime.js";

export function configureRoom(room: RoomContext, location: ZoneLocation): void {
  if (room.location && room.location.roomKey !== location.roomKey) {
    throw new Error("world room key mismatch");
  }
  if (room.location) return;
  room.location = location;
  room.monsters = createMonsters(location.definition.monsters);
  room.guards = createGuards(location.definition.guards);
  room.monsterGrid.clear();
  for (const monster of room.monsters) room.monsterGrid.insert(monster);
}

export function roomZone(room: RoomContext): ZoneDefinition {
  if (!room.location) throw new Error("world was not initialized with a zone");
  return room.location.definition;
}
