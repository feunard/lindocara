import type { CSSProperties } from "react";
import { useEffect, useRef } from "react";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../shared/simulation.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

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
  // Same welcome message carries the zone's true terrain size. Falling back to Verdant Reach's
  // dimensions (the default zone) covers that same narrow pre-welcome race; every zone after
  // that reports its own shape, so a 4:3 zone stops being stretched to 16:9.
  const worldSize = useUiStore((s) => s.worldSize);
  const width = worldSize?.width ?? WORLD_WIDTH;
  const height = worldSize?.height ?? WORLD_HEIGHT;
  const aspectRatio = `${width} / ${height}`;
  // The CSS width formula (.world-map-canvas) needs the ratio as a plain number to multiply
  // against a viewport-derived height budget — aspect-ratio's "W / H" syntax isn't usable in a
  // calc(). Both describe the same ratio; keeping them derived from the same width/height here
  // is what keeps them from ever disagreeing.
  const mapRatio = width / height;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!game || !canvas || !mapOpen) return;
    game.attachWorldMap(canvas);
    return () => game.attachWorldMap(null);
  }, [game, mapOpen]);

  if (!mapOpen) return null;

  return (
    <div id="world-map">
      <div className="world-map-panel">
        <header className="world-map-header">
          <h2>{zoneNameKey ? t(zoneNameKey) : t("hud.map.title")}</h2>
          <button type="button" onClick={() => setMapOpen(false)}>
            {t("hud.map.close")}
          </button>
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
