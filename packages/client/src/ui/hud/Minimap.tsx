import { useEffect, useRef } from "react";
import { t, useLocale } from "../../i18n.js";
import { useUiStore } from "../../store.js";

/**
 * React owns the canvas; the game loop draws into it (GameHandle.attachMinimap). Nothing here
 * re-renders per frame, which is the whole point: panning stays smooth and the store stays
 * free of world coordinates.
 */
export function Minimap() {
  useLocale();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const game = useUiStore((s) => s.game);
  const setMapOpen = useUiStore((s) => s.setMapOpen);
  const mapOpen = useUiStore((s) => s.mapOpen);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!game || !canvas) return;
    game.attachMinimap(canvas);
    return () => game.attachMinimap(null);
  }, [game]);

  return (
    <div id="minimap">
      <canvas ref={canvasRef} className="minimap-canvas" />
      <button
        type="button"
        className="minimap-expand"
        onClick={() => setMapOpen(!mapOpen)}
        aria-label={t("help.map")}
      >
        +
      </button>
    </div>
  );
}
