import type { Db } from "../db/index.js";
import type { PlayerProfile, SaveableProfile } from "../profile.js";
import { type PlayerRuntime, toProfile } from "./world-runtime.js";

export interface PersistenceSystemContext {
  db: Db;
  pendingSaves: Map<string, Promise<boolean>>;
  rejectStaleSave(socket: WebSocket, player: PlayerRuntime): void;
  loadProfile(id: string): Promise<PlayerProfile | null>;
  saveProfile(profile: SaveableProfile): Promise<boolean>;
}

export function persistPlayer(
  context: PersistenceSystemContext,
  player: PlayerRuntime,
  socket: WebSocket,
  force = false,
): Promise<boolean> {
  if (!player.authorized && !force) return Promise.resolve(false);
  const profile = toProfile(player);
  const previous = context.pendingSaves.get(profile.id);
  const start = previous
    ? previous.then(
        () => undefined,
        () => undefined,
      )
    : Promise.resolve();
  const save = start.then(async () => {
    const current = toProfile(player);
    if (force) {
      const latest = await context.loadProfile(current.id);
      if (latest) {
        current.zoneId = latest.zoneId;
        current.instanceId = latest.instanceId;
      }
    }
    const accepted = await context.saveProfile(current);
    if (!accepted) context.rejectStaleSave(socket, player);
    return accepted;
  });
  context.pendingSaves.set(profile.id, save);
  void save.then(
    () => {
      if (context.pendingSaves.get(profile.id) === save) context.pendingSaves.delete(profile.id);
    },
    () => {
      if (context.pendingSaves.get(profile.id) === save) context.pendingSaves.delete(profile.id);
    },
  );
  return save;
}
