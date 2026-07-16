type TinySwordsMenuSceneProps = {
  variant: "gate" | "courtyard";
};

const ROOT = "/assets/lindocara/tiny-swords";

/** Decorative Tiny Swords diorama shared by the account and roster screens. */
export function TinySwordsMenuScene({ variant }: TinySwordsMenuSceneProps) {
  return (
    <div className={`menu-scene menu-scene--${variant}`} aria-hidden="true">
      <div className="menu-scene__sky">
        <span className="menu-scene__cloud menu-scene__cloud--one" />
        <span className="menu-scene__cloud menu-scene__cloud--two" />
        <span className="menu-scene__sun" />
      </div>

      <div className="menu-scene__hills menu-scene__hills--far" />
      <div className="menu-scene__hills menu-scene__hills--near" />
      <div className="menu-scene__ground" />
      <div className="menu-scene__path" />
      <div className="menu-scene__water" />
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
