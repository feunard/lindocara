import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";

import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinyButton } from "./tiny-swords/TinyButton.js";

/**
 * The full world on M. Same baked texture as the minimap, blitted whole. Mounted only while
 * open, so the game loop skips the world-map draw entirely when it is closed.
 */
export function WorldMap() {
  useLocale();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useUiStore((s) => s.game);
  const mapOpen = useUiStore((s) => s.mapOpen);
  const setMapOpen = useUiStore((s) => s.setMapOpen);
  // The welcome message carries the real zone; falling back to the generic title covers only
  // the narrow race where M is pressed before the first welcome has landed.
  const zoneNameKey = useUiStore((s) => s.zoneNameKey);
  // The welcome carries the map's own grid side. A heightfield is SQUARE, so the panel is square
  // too and the old width/height pair — and the stretched-to-16:9 bug it existed to fix — is gone
  // with the pixel world. The value is only read for the pre-welcome frame's sake; the ratio is 1
  // either way.
  useUiStore((s) => s.worldSize);
  const aspectRatio = "1 / 1";
  // The CSS width formula (.world-map-canvas) needs the ratio as a plain number to multiply
  // against a viewport-derived height budget — aspect-ratio's "W / H" syntax isn't usable in a
  // calc().
  const mapRatio = 1;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!game || !canvas || !mapOpen) return;
    game.attachWorldMap(canvas);
    return () => game.attachWorldMap(null);
  }, [game, mapOpen]);

  if (!mapOpen) return null;

  return (
    <div id="world-map">
      <div className="world-map-panel" data-text-surface="information">
        <header className="world-map-header">
          <h2>{zoneNameKey ? t(zoneNameKey) : t("hud.map.title")}</h2>
          <TinyButton type="button" size="sm" onClick={() => setMapOpen(false)}>
            {t("hud.map.close")}
          </TinyButton>
        </header>
        <canvas
          ref={canvasRef}
          className="world-map-canvas"
          style={{ aspectRatio, "--map-ratio": mapRatio } as CSSProperties}
        />
        <footer className="world-map-legend">
          <span className="legend-self">{t("hud.map.you")}</span>
          <span className="legend-corpse">{t("hud.map.corpse")}</span>
        </footer>
      </div>
    </div>
  );
}
