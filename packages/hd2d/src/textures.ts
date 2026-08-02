import * as THREE from "three";

export interface TextureSpec {
  url: string;
  /** Atlas = échantillonné par sous-rectangles (tuiles, écume). Sprite sinon. */
  atlas?: boolean;
}

export interface TextureRegistry {
  decode(blobs: Map<string, Blob>, onDecoded: (p: number) => void): Promise<void>;
  get(url: string, opts?: { repeat?: boolean }): THREE.Texture;
  urls(): readonly string[];
  dispose(): void;
}

/**
 * Les atlas de tuiles sont échantillonnés par sous-rectangles : leurs mipmaps mélangeraient les
 * tuiles voisines et feraient baver les bordures. On s'en passe pour eux — le tilt-shift floute de
 * toute façon l'arrière-plan.
 *
 * L'écume relève du même cas, et personne ne l'avait vue : c'est une bande de huit frames de
 * 192 px, échantillonnée frame par frame comme un atlas. Avec des mipmaps, les niveaux inférieurs
 * moyennaient les huit frames ENTRE ELLES — la tache perdait son dessin et devenait un aplat gris,
 * et l'alpha moyenné rongeait la découpe de l'`alphaTest`, d'où des bavures verticales le long du
 * rivage. C'est un décalque posé à plat, vu en fuyante : il est presque toujours en minification,
 * donc les mipmaps y étaient actives en permanence.
 *
 * Pixel art en 3D : nearest en magnification (pixels francs), mipmaps en minification pour les
 * sprites (sinon le sprite grésille dès qu'il s'éloigne).
 */
export function textureFiltering(atlas: boolean): {
  magFilter: THREE.MagnificationTextureFilter;
  minFilter: THREE.MinificationTextureFilter;
  generateMipmaps: boolean;
  anisotropy: number;
} {
  if (atlas) {
    return {
      magFilter: THREE.NearestFilter,
      minFilter: THREE.LinearFilter,
      generateMipmaps: false,
      anisotropy: 1,
    };
  }
  return {
    magFilter: THREE.NearestFilter,
    minFilter: THREE.NearestMipmapLinearFilter,
    generateMipmaps: true,
    anisotropy: 8,
  };
}

function configure(tex: THREE.Texture, atlas: boolean): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  const filtering = textureFiltering(atlas);
  tex.magFilter = filtering.magFilter;
  tex.minFilter = filtering.minFilter;
  tex.generateMipmaps = filtering.generateMipmaps;
  tex.anisotropy = filtering.anisotropy;
  return tex;
}

function blobToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((ok, ko) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      ok(img);
    };
    img.onerror = ko;
    img.src = url;
  });
}

/**
 * Le catalogue vient de l'appelant (le labo) : `hd2d` ne connaît aucune URL de contenu, seulement
 * la politique de filtrage. Le cache appartient à ce registre — pas de `Map` de module — pour
 * qu'un jeu et un éditeur ouverts côte à côte ne partagent pas leurs textures.
 */
export function createTextureRegistry(specs: readonly TextureSpec[]): TextureRegistry {
  const cache = new Map<string, THREE.Texture>();
  const urls = specs.map((s) => s.url);

  return {
    /**
     * Tout est décodé avant de construire la scène : premier rendu correct, et surtout pas de
     * clone de texture vide (three râle une fois par frame sinon).
     *
     * Les octets ont déjà été téléchargés par `fetchAll` — on ne repasse pas par `TextureLoader`,
     * qui refetcherait tout sans rien dire du pourcentage. On reconstruit un `HTMLImageElement`
     * depuis le blob : c'est exactement ce que `TextureLoader` fournit à `THREE.Texture`, donc
     * `flipY` et compagnie se comportent à l'identique. (Un `ImageBitmap` irait plus vite mais
     * retourne l'image, et il faudrait alors reprendre toutes les UV.)
     */
    async decode(blobs, onDecoded) {
      let faits = 0;
      await Promise.all(
        specs.map(async (spec) => {
          const blob = blobs.get(spec.url);
          if (!blob) throw new Error(`Blob manquant pour ${spec.url}`);
          const img = await blobToImage(blob);
          const tex = new THREE.Texture(img);
          tex.needsUpdate = true;
          cache.set(spec.url, configure(tex, spec.atlas ?? false));
          onDecoded(++faits / specs.length);
        }),
      );
    },

    get(url, opts = {}) {
      const tex = cache.get(url);
      if (!tex) throw new Error(`Texture non préchargée : ${url} (à ajouter au catalogue du labo)`);
      if (opts.repeat) {
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
      }
      return tex;
    },

    urls() {
      return urls;
    },

    dispose() {
      for (const tex of cache.values()) tex.dispose();
      cache.clear();
    },
  };
}
