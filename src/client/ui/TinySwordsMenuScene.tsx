type TinySwordsMenuSceneProps = {
  variant: "gate" | "courtyard";
};

const ROOT = "/assets/lindocara/tiny-swords";
const CLOUD_ONE = new URL(
  "../../../assets/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_01.png",
  import.meta.url,
).href;
const CLOUD_TWO = new URL(
  "../../../assets/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_02.png",
  import.meta.url,
).href;
const CLOUD_THREE = new URL(
  "../../../assets/Tiny Swords (Free Pack)/Terrain/Decorations/Clouds/Clouds_05.png",
  import.meta.url,
).href;
const BRIDGE = new URL(
  "../../../assets/Tiny Swords (Update 010)/Terrain/Bridge/Bridge_All.png",
  import.meta.url,
).href;
const FOAM_TILES = Array.from({ length: 72 }, (_, index) => `menu-foam-${index}`);

/** Decorative Tiny Swords diorama shared by the account and roster screens. */
export function TinySwordsMenuScene({ variant }: TinySwordsMenuSceneProps) {
  return (
    <div className={`menu-scene menu-scene--${variant}`} aria-hidden="true">
      <div className="menu-scene__sky">
        <img className="menu-scene__cloud menu-scene__cloud--one" src={CLOUD_ONE} alt="" />
        <img className="menu-scene__cloud menu-scene__cloud--two" src={CLOUD_TWO} alt="" />
        <img className="menu-scene__cloud menu-scene__cloud--three" src={CLOUD_THREE} alt="" />
        <span className="menu-scene__sun" />
      </div>

      <div className="menu-scene__hills menu-scene__hills--far" />
      <div className="menu-scene__hills menu-scene__hills--near" />
      <div className="menu-scene__ground" />
      <span className="menu-scene__bridge">
        <img src={BRIDGE} alt="" />
      </span>
      <div className="menu-scene__water" />
      <div className="menu-scene__foam-bank">
        {FOAM_TILES.map((id) => (
          <span key={id} className="menu-scene__foam-tile">
            <img src={`${ROOT}/terrain/Foam.png`} alt="" />
          </span>
        ))}
      </div>
      <div className="menu-scene__shore" />

      <img
        className="menu-scene__building menu-scene__building--house-left"
        src={`${ROOT}/buildings/House1.png`}
        alt=""
      />
      <img
        className="menu-scene__building menu-scene__building--house-right"
        src={`${ROOT}/buildings/House3.png`}
        alt=""
      />
      <img
        className="menu-scene__building menu-scene__building--tower"
        src={`${ROOT}/buildings/Tower.png`}
        alt=""
      />
      <img
        className="menu-scene__building menu-scene__building--castle"
        src={`${ROOT}/buildings/Castle.png`}
        alt=""
      />

      <span className="menu-scene__tree menu-scene__tree--left">
        <img src={`${ROOT}/terrain/Tree3.png`} alt="" />
      </span>
      <span className="menu-scene__tree menu-scene__tree--right">
        <img src={`${ROOT}/terrain/Tree4.png`} alt="" />
      </span>
      <span className="menu-scene__tree menu-scene__tree--far">
        <img src={`${ROOT}/terrain/Tree3.png`} alt="" />
      </span>

      <img
        className="menu-scene__deco menu-scene__deco--rock"
        src={`${ROOT}/terrain/Rock2.png`}
        alt=""
      />
      <img className="menu-scene__deco menu-scene__deco--bush" src={`${ROOT}/deco/09.png`} alt="" />
      <img className="menu-scene__deco menu-scene__deco--sign" src={`${ROOT}/deco/17.png`} alt="" />

      <span className="menu-scene__effect menu-scene__fire menu-scene__fire--left">
        <img src={`${ROOT}/effects/Fire_01.png`} alt="" />
      </span>
      <span className="menu-scene__effect menu-scene__fire menu-scene__fire--right">
        <img src={`${ROOT}/effects/Fire_01.png`} alt="" />
      </span>
      <span className="menu-scene__effect menu-scene__dust">
        <img src={`${ROOT}/effects/Dust_01.png`} alt="" />
      </span>

      <span className="menu-scene__vignette" />
    </div>
  );
}
