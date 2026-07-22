import { TINY_SWORDS_UI } from "@lindocara/engine/tiny-swords-catalog.js";
import { tinySwordsAssetUrl } from "@lindocara/renderer/tiny-swords-assets.js";

type TinySwordsMenuSceneProps = {
  variant: "gate" | "courtyard";
};

const SCENE = Object.fromEntries(
  Object.entries(TINY_SWORDS_UI.scene).map(([key, asset]) => [key, tinySwordsAssetUrl(asset)]),
) as Record<keyof typeof TINY_SWORDS_UI.scene, string>;
const FOAM_TILES = Array.from({ length: 72 }, (_, index) => `menu-foam-${index}`);

/** Decorative Tiny Swords diorama shared by the account and roster screens. */
export function TinySwordsMenuScene({ variant }: TinySwordsMenuSceneProps) {
  return (
    <div className={`menu-scene menu-scene--${variant}`} aria-hidden="true">
      <div className="menu-scene__sky">
        <img className="menu-scene__cloud menu-scene__cloud--one" src={SCENE.cloudOne} alt="" />
        <img className="menu-scene__cloud menu-scene__cloud--two" src={SCENE.cloudTwo} alt="" />
        <img className="menu-scene__cloud menu-scene__cloud--three" src={SCENE.cloudThree} alt="" />
      </div>
      <div className="menu-scene__ground" />
      <span className="menu-scene__bridge">
        <img src={SCENE.bridge} alt="" />
      </span>
      <div className="menu-scene__water" />
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

      <span className="menu-scene__vignette" />
    </div>
  );
}
