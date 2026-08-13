/**
 * The launch-gate "living backdrop" (v2): the painted dawn landscape cut into four parallax
 * layers — sky, far mountains, mid hills, foreground — each drifting autonomously on a ~90 s
 * loop, slowest at the back, plus two cloud passes, sun rays/bloom and a vignette. Everything
 * is CSS animation over transform/opacity: no rAF loop, no React re-render, frozen under
 * `prefers-reduced-motion` (see `launch.css`'s launch-backdrop section).
 *
 * Layer sources are cut from `apps/lab/assets/generated/launch-menu-backdrop.png` by
 * `scripts/cut-launch-backdrop.py`; the design is the backdrop half of the launch-gate spec
 * (`docs/superpowers/specs/2026-08-11-launch-gate-design.md`, feat-launch-gate branch).
 * `TinySwordsMenuScene` remains the v1 backdrop — `state/atoms.ts`'s `backdropVersionAtom`
 * decides which one the title/menu screens mount.
 */
import { useEffect, useRef } from "react";

export function LaunchBackdrop() {
  const rootRef = useRef<HTMLDivElement>(null);

  // Pause every drift while the tab is hidden, matching what `menu-audio.ts` does for sound.
  // CSS animations keep advancing their clock in a hidden tab; play-state actually holds them.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const sync = () => root.toggleAttribute("data-paused", document.hidden);
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);

  return (
    <div ref={rootRef} className="launch-backdrop" aria-hidden="true">
      <div className="launch-backdrop__canvas">
        <div className="launch-backdrop__layer launch-backdrop__layer--sky" />
        {/* Two passes of the same tileable strip, different speeds and opacities; they sit
            between the sky and the far mountains so the clouds cross behind the peaks. */}
        <div className="launch-backdrop__clouds launch-backdrop__clouds--slow" />
        <div className="launch-backdrop__clouds launch-backdrop__clouds--fast" />
        <div className="launch-backdrop__layer launch-backdrop__layer--far" />
        <div className="launch-backdrop__layer launch-backdrop__layer--mid" />
        <div className="launch-backdrop__layer launch-backdrop__layer--fore" />
        <div className="launch-backdrop__rays" />
        <div className="launch-backdrop__bloom" />
      </div>
      <div className="launch-backdrop__vignette" />
    </div>
  );
}
