import { TINY_SWORDS_UI } from "@lindocara/engine/tiny-swords-catalog.js";
import { tinySwordsAssetUrl } from "@lindocara/renderer/tiny-swords-assets.js";
import { type CSSProperties, useEffect, useRef } from "react";

type TinySwordsMenuSceneProps = {
  variant: "gate" | "courtyard";
};

const SCENE = Object.fromEntries(
  Object.entries(TINY_SWORDS_UI.scene).map(([key, asset]) => [key, tinySwordsAssetUrl(asset)]),
) as Record<keyof typeof TINY_SWORDS_UI.scene, string>;
const FOAM_TILES = Array.from({ length: 72 }, (_, index) => `menu-foam-${index}`);

/** A swarm of drifting light motes. Timing is spread deterministically by index so it reads organic
 *  without any randomness (and stays stable across renders). */
const FIREFLIES = Array.from({ length: 18 }, (_, i) => ({
  id: `firefly-${i}`,
  style: {
    left: `${(i * 37 + 11) % 100}%`,
    top: `${(i * 53 + 5) % 60}%`,
    animationDelay: `${-((i * 1.7) % 11).toFixed(2)}s`,
    animationDuration: `${8 + (i % 6)}s`,
  } as CSSProperties,
}));

/** A loose flock crossing the sky, each bird on its own slow pass. */
const BIRDS = Array.from({ length: 6 }, (_, i) => ({
  id: `bird-${i}`,
  style: {
    top: `${6 + ((i * 9 + 3) % 26)}%`,
    animationDelay: `${-((i * 6.5) % 34).toFixed(2)}s`,
    animationDuration: `${26 + (i % 4) * 5}s`,
    scale: `${(0.65 + (i % 3) * 0.18).toFixed(2)}`,
  } as CSSProperties,
}));

/**
 * Decorative Tiny Swords diorama shared by the launch, account and roster screens.
 *
 * The scene is deliberately alive: a slow Ken-Burns pan and a subtle pointer parallax on the whole
 * world, a ~2-minute day→dusk→night tint cycle, drifting clouds and light motes, a crossing flock,
 * animated water shimmer, plus the per-sprite foam/fire/tree/dust loops. It is layered as
 * `pan` (Ken-Burns transform) → `world` (pointer drift via the `translate` property) → the sprites,
 * so the two motions never fight, with the day/night tint and vignette held still above the world.
 */
export function TinySwordsMenuScene({ variant }: TinySwordsMenuSceneProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Pointer parallax: nudge the world a few pixels against the cursor. The CSS transition on the
  // `translate` property smooths it, so this only has to set two custom properties — no rAF loop
  // (which keeps it safe under jsdom in tests too).
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onMove = (event: PointerEvent) => {
      const nx = event.clientX / window.innerWidth - 0.5;
      const ny = event.clientY / window.innerHeight - 0.5;
      root.style.setProperty("--drift-x", `${(-nx * 26).toFixed(1)}px`);
      root.style.setProperty("--drift-y", `${(-ny * 15).toFixed(1)}px`);
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, []);

  return (
    <div ref={rootRef} className={`menu-scene menu-scene--${variant}`} aria-hidden="true">
      <div className="menu-scene__pan">
        <div className="menu-scene__world">
          <div className="menu-scene__sky">
            <img className="menu-scene__cloud menu-scene__cloud--one" src={SCENE.cloudOne} alt="" />
            <img className="menu-scene__cloud menu-scene__cloud--two" src={SCENE.cloudTwo} alt="" />
            <img
              className="menu-scene__cloud menu-scene__cloud--three"
              src={SCENE.cloudThree}
              alt=""
            />
            <img className="menu-scene__cloud menu-scene__cloud--four" src={SCENE.cloudTwo} alt="" />
            <img
              className="menu-scene__cloud menu-scene__cloud--five"
              src={SCENE.cloudOne}
              alt=""
            />

            <div className="menu-scene__birds">
              {BIRDS.map((bird) => (
                <span key={bird.id} className="menu-scene__bird" style={bird.style} />
              ))}
            </div>
          </div>

          <div className="menu-scene__ground" />
          <span className="menu-scene__bridge">
            <img src={SCENE.bridge} alt="" />
          </span>
          <div className="menu-scene__water" />
          <div className="menu-scene__shimmer" />
          <div className="menu-scene__foam-bank">
            {FOAM_TILES.map((id) => (
              <span key={id} className="menu-scene__foam-tile">
                <img src={SCENE.foam} alt="" />
              </span>
            ))}
          </div>
          <div className="menu-scene__shore" />

          <img
            className="menu-scene__building menu-scene__building--house-left"
            src={SCENE.houseOne}
            alt=""
          />
          <img
            className="menu-scene__building menu-scene__building--house-right"
            src={SCENE.houseThree}
            alt=""
          />
          <img className="menu-scene__building menu-scene__building--tower" src={SCENE.tower} alt="" />
          <img
            className="menu-scene__building menu-scene__building--castle"
            src={SCENE.castle}
            alt=""
          />

          <span className="menu-scene__tree menu-scene__tree--left">
            <img src={SCENE.treeThree} alt="" />
          </span>
          <span className="menu-scene__tree menu-scene__tree--right">
            <img src={SCENE.treeFour} alt="" />
          </span>
          <span className="menu-scene__tree menu-scene__tree--far">
            <img src={SCENE.treeThree} alt="" />
          </span>

          <img className="menu-scene__deco menu-scene__deco--rock" src={SCENE.rockTwo} alt="" />
          <img className="menu-scene__deco menu-scene__deco--bush" src={SCENE.bush} alt="" />
          <img className="menu-scene__deco menu-scene__deco--sign" src={SCENE.sign} alt="" />

          <span className="menu-scene__effect menu-scene__fire menu-scene__fire--left">
            <img src={SCENE.fire} alt="" />
          </span>
          <span className="menu-scene__effect menu-scene__fire menu-scene__fire--right">
            <img src={SCENE.fire} alt="" />
          </span>
          <span className="menu-scene__effect menu-scene__dust">
            <img src={SCENE.dust} alt="" />
          </span>

          <div className="menu-scene__fireflies">
            {FIREFLIES.map((mote) => (
              <span key={mote.id} className="menu-scene__firefly" style={mote.style} />
            ))}
          </div>
        </div>
      </div>

      <div className="menu-scene__daynight" />
      <span className="menu-scene__vignette" />
    </div>
  );
}
