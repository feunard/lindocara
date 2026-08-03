import * as THREE from "three";

/**
 * Tilt-shift : flou gaussien séparable dont le rayon dépend uniquement de la
 * position verticale à l'écran. Bande nette au milieu, flou en haut et en bas
 * -> l'oeil lit la scène comme une maquette. C'est LA signature du HD-2D.
 * S'utilise en deux passes : direction (1,0) puis (0,1).
 */
export const TiltShiftShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uDirection: { value: new THREE.Vector2(1, 0) },
    uFocusY: { value: 0.56 },
    uFocusRange: { value: 0.13 },
    uFalloff: { value: 0.34 },
    uRadius: { value: 5.5 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform vec2 uDirection;
    uniform float uFocusY, uFocusRange, uFalloff, uRadius;
    varying vec2 vUv;

    void main() {
      float d = abs(vUv.y - uFocusY);
      float amount = smoothstep(uFocusRange, uFocusRange + uFalloff, d);
      float r = uRadius * amount;

      if (r < 0.01) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 s = uDirection * r / uResolution;
      vec4 sum = texture2D(tDiffuse, vUv) * 0.2270270;
      sum += (texture2D(tDiffuse, vUv + s) + texture2D(tDiffuse, vUv - s)) * 0.1945946;
      sum += (texture2D(tDiffuse, vUv + s * 2.0) + texture2D(tDiffuse, vUv - s * 2.0)) * 0.1216216;
      sum += (texture2D(tDiffuse, vUv + s * 3.0) + texture2D(tDiffuse, vUv - s * 3.0)) * 0.0540540;
      sum += (texture2D(tDiffuse, vUv + s * 4.0) + texture2D(tDiffuse, vUv - s * 4.0)) * 0.0162162;
      gl_FragColor = sum;
    }
  `,
};

/**
 * Étalonnage final : saturation, contraste, léger lift, vignette, et un bruit
 * d'un LSB pour casser le banding — le dégradé de ciel se cerclerait sans lui.
 *
 * Cette passe tourne APRÈS OutputPass, donc sur des valeurs déjà tone-mappées
 * et encodées : le pivot du contraste à 0.5 désigne bien le gris moyen qu'on
 * voit à l'écran. Placée avant, elle pivotait autour d'un linéaire 0.5 — soit
 * 0.73 à l'affichage — et ne faisait pas du tout ce que ses réglages disaient.
 */
export const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSaturation: { value: 1.14 },
    uContrast: { value: 1.06 },
    uLift: { value: 0.0 },
    uVignette: { value: 0.85 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uResolution;
    uniform float uSaturation, uContrast, uLift, uVignette;
    varying vec2 vUv;

    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, uSaturation);
      c.rgb = (c.rgb - 0.5) * uContrast + 0.5 + uLift;

      vec2 p = (vUv - 0.5) * 2.0;
      float v = 1.0 - uVignette * 0.42 * dot(p, p);
      c.rgb *= clamp(v, 0.0, 1.0);

      float n = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) / 255.0;

      gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
    }
  `,
};

/**
 * Voûte céleste : dégradé horizon -> zénith, halo autour de l'astre, étoiles
 * procédurales, rubans d'aurore. Remplace le `scene.background` d'une couleur
 * unie, qui posait l'île sur un aplat et ne donnait aucune profondeur au ciel.
 *
 * Le brouillard prend la couleur d'horizon de ce dégradé : sans ça, la mer qui
 * s'estompe au loin et le ciel se rejoignent sur deux teintes différentes et
 * dessinent une ligne franche là où il ne devrait rien y avoir.
 *
 * `uAurora` (0..1) est un canal de plus, comme `uStars` : purement optique, à zéro il ne change
 * RIEN à l'image (garde `if (uAurora > 0.001)`), et rien ici ne sait ce qu'il représente — c'est
 * l'appelant (`sky.ts`) qui l'alimente et qui, seul, sait pourquoi.
 */
export const SkyShader = {
  uniforms: {
    uTop: { value: new THREE.Color("#3d8fd0") },
    uHorizon: { value: new THREE.Color("#b6e3ef") },
    uGlow: { value: new THREE.Color("#fff4d2") },
    uGlowStrength: { value: 0.5 },
    uStars: { value: 0 },
    // Rubans d'aurore, 0..1 — un canal de plus, comme `uStars` : purement optique, sans savoir
    // pourquoi ni où on l'allume (voir `mood.ts`, `MoodConfig.aurora`). À 0 il ne contribue rien,
    // exactement comme `uStars` à 0.
    uAurora: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec3 vDir;
    void main() {
      // La voûte suit la caméra : sa direction depuis l'oeil suffit, on n'a
      // jamais besoin de sa position absolue.
      vDir = (modelMatrix * vec4(position, 1.0)).xyz - cameraPosition;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uTop, uHorizon, uGlow;
    uniform float uGlowStrength, uStars, uAurora, uTime;
    uniform vec3 uSunDir;
    varying vec3 vDir;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + vec3(0.71, 0.113, 0.419));
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    void main() {
      vec3 d = normalize(vDir);

      // Dégradé : concentré près de l'horizon, comme une vraie diffusion.
      float h = clamp(d.y, 0.0, 1.0);
      vec3 col = mix(uHorizon, uTop, pow(h, 0.55));

      // Halo de l'astre. Deux lobes : un petit et dur, un large et diffus.
      float s = max(dot(d, normalize(uSunDir)), 0.0);
      col += uGlow * uGlowStrength * (pow(s, 220.0) * 1.6 + pow(s, 5.0) * 0.16);

      // Étoiles : une grille de cellules dans la direction de visée, une sur
      // trois cents porte un point. Elles ne descendent pas sous l'horizon.
      if (uStars > 0.001) {
        vec3 sd = d * 190.0;
        vec3 cell = floor(sd);
        float r = hash(cell);
        if (r > 0.9965) {
          vec3 jitter = vec3(hash(cell + 11.0), hash(cell + 23.0), hash(cell + 37.0)) - 0.5;
          float dist = length(fract(sd) - 0.5 - jitter * 0.55);
          float twinkle = 0.55 + 0.45 * sin(uTime * 2.3 + r * 300.0);
          float b = smoothstep(0.34, 0.0, dist) * twinkle;
          col += vec3(0.85, 0.9, 1.0) * b * uStars * smoothstep(0.0, 0.18, d.y);
        }
      }

      // Rubans d'aurore : deux ondes lentes, de fréquences différentes, dont le produit casse le
      // motif en bandes irrégulières plutôt qu'un simple quadrillage. Concentrés près du zénith
      // et jamais sous l'horizon — même garde que les étoiles. Rappel du registre des pièges de
      // rendu : à la plongée et au champ de la caméra du jeu, le zénith n'entre jamais dans le
      // cadre — ce bloc reste donc surtout un contrôle en caméra redressée ; ce qu'on VOIT en jeu,
      // c'est uAurora qui a déjà teinté uHorizon avant d'arriver ici (voir sky.ts).
      if (uAurora > 0.001) {
        float ruban = sin(d.x * 3.1 + d.z * 1.7 + uTime * 0.15) * 0.5 + 0.5;
        ruban *= sin(d.z * 4.6 - d.x * 2.2 - uTime * 0.09) * 0.5 + 0.5;
        // Seuil relevé (0.35 au lieu d'un quart de voûte) : sinon les rubans se lisent comme un
        // simple lavis vert plein cadre dès qu'on redresse la caméra pour les contrôler, au lieu
        // de bandes concentrées près du zénith.
        float zenith = smoothstep(0.35, 0.85, d.y);
        vec3 teinte = mix(vec3(0.25, 0.95, 0.55), vec3(0.5, 0.35, 0.95), ruban);
        col += teinte * ruban * zenith * uAurora * 0.7;
      }

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
