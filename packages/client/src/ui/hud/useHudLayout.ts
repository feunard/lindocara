import { useSyncExternalStore } from "react";

import {
  getHudLayoutSnapshot,
  getServerHudLayoutSnapshot,
  subscribeHudLayout,
} from "../../state/hud-layout.js";

export function useHudLayout() {
  return useSyncExternalStore(subscribeHudLayout, getHudLayoutSnapshot, getServerHudLayoutSnapshot);
}
