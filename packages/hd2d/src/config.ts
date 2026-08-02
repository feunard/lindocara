export interface RenderConfig {
  /** L'EffectComposer crée ses cibles internes SANS multiéchantillonnage, et le `antialias` du
   *  renderer ne concerne que le framebuffer par défaut — où l'on ne dessine qu'un quad plein
   *  écran. Sans ça, aucune arête de géométrie n'est lissée. */
  msaa: number;
  /** 1 = pleine résolution. En dessous, la scène est rendue plus petite puis remontée en nearest :
   *  grain de pixel parfaitement régulier, au prix du look « maquette ». */
  pixelScale: number;
}

export interface PostFxConfig {
  bloom: { strength: number; radius: number; threshold: number };
  tiltShift: {
    radius: number;
    focusY: number;
    focusRange: number;
    falloff: number;
    /** Dézoomer doit renforcer l'effet maquette, pas l'aplatir. */
    zoomBoost: number;
  };
  grade: { vignette: number; saturation: number; contrast: number };
}

export interface CloudShadowConfig {
  /** Fréquence spatiale, en 1/unité monde. */
  scale: number;
  /** Dérive, en UV/seconde. */
  drift: readonly [number, number];
  softness: number;
}

export interface Hd2dConfig {
  render: RenderConfig;
  postfx: PostFxConfig;
  cloudShadow: CloudShadowConfig;
  /** Une caméra qui plonge écrase un plan vertical d'un facteur cos(pitch). On compense en
   *  ÉTIRANT le sprite, pas en le penchant vers la caméra : pencher revient à le coucher en
   *  arrière, et son sommet entre alors dans ce qui se trouve derrière — un héros au pied d'une
   *  falaise disparaissait dedans. 0 = aucune compensation, 1 = totale. */
  spriteStretch: number;
}

export const DEFAULT_CONFIG: Hd2dConfig = {
  render: { msaa: 4, pixelScale: 1 },
  postfx: {
    bloom: { strength: 0.42, radius: 0.75, threshold: 0.72 },
    tiltShift: { radius: 5.5, focusY: 0.56, focusRange: 0.13, falloff: 0.34, zoomBoost: 0.7 },
    grade: { vignette: 0.85, saturation: 1.14, contrast: 1.06 },
  },
  cloudShadow: { scale: 0.011, drift: [0.0022, 0.0009], softness: 0.42 },
  spriteStretch: 0.85,
};
