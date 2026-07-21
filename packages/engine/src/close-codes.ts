/** Application WebSocket close codes shared by the Worker, room and browser. */
export const WS_CLOSE = Object.freeze({
  CHARACTER_REPLACED: 4001,
  CHARACTER_DELETED: 4002,
  PRESENCE_LOST: 4003,
  SESSION_EXPIRED: 4004,
  PRESENCE_ERROR: 4005,
  ROOM_FULL: 4006,
  INVALID_LOCATION: 4007,
  ZONE_TRANSITION: 4008,
});
