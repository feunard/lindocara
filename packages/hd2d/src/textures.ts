import * as THREE from "three";

import { fetchAll } from "./loader.js";

export interface TextureSpec {
  url: string;
  /** Atlas = échantillonné par sous-rectangles (tuiles, écume). Sprite sinon. */
  atlas?: boolean;
}

/**
 * Ce dont un CONSOMMATEUR de textures a besoin : la recherche, et rien sur la façon dont elles sont
 * arrivées là. Un `TextureRegistry` (le contenu d'un téléchargement) et une vue de `TextureCache`
 * (plusieurs, partagées et réutilisées d'une scène à l'autre) le satisfont tous les deux, ce qui
 * laisse au placement le droit d'ignorer laquelle il tient.
 */
export interface TextureSource {
  get(url: string, opts?: { repeat?: boolean }): THREE.Texture;
}

export interface TextureRegistry extends TextureSource {
  decode(blobs: Map<string, Blob>, onDecoded: (p: number) => void): Promise<void>;
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

export interface TextureCache {
  /** Les textures décodées de `specs` — ne télécharge et ne décode que ce qui manque. */
  load(specs: readonly TextureSpec[]): Promise<TextureSource>;
  /** Nombre de textures détenues. Pour les tests et le diagnostic. */
  size(): number;
  dispose(): void;
}

/** Une texture est identifiée par son url ET son filtrage : la même image échantillonnée en atlas
 *  et en sprite n'a pas les mêmes mipmaps, et une seule entrée servirait à l'un le réglage de
 *  l'autre — sans erreur, juste des bordures qui bavent. */
function cacheKey(spec: TextureSpec): string {
  return `${spec.url}#${spec.atlas ? "atlas" : "sprite"}`;
}

/** Des specs aux textures décodées. La frontière du cache : lui décide de ce qu'il GARDE, ceci sait
 *  comment des octets deviennent une texture. C'est aussi la couture par laquelle un test vérifie
 *  la politique sans avoir besoin d'un DOM pour décoder une image. */
export type TextureDecoder = (specs: readonly TextureSpec[]) => Promise<TextureRegistry>;

const downloadAndDecode: TextureDecoder = async (specs) => {
  const blobs = await fetchAll(
    specs.map((spec) => spec.url),
    () => {},
  );
  const registry = createTextureRegistry(specs);
  await registry.decode(blobs, () => {});
  return registry;
};

/**
 * Un cache de textures décodées qui SURVIT à la scène.
 *
 * Le registre ci-dessus a la durée de vie d'un téléchargement, et `Hd2dRenderer` en fabriquait un
 * par reconstruction de scène : chaque édition de terrain jetait les feuilles du décor puis les
 * retéléchargeait et les redécodait à l'identique — mesuré à ~90 ms de `fetch` (cache HTTP CHAUD)
 * plus ~10 ms de décodage par reconstruction, pendant lesquelles la carte n'avait plus de décor du
 * tout. C'est ce trou qui faisait clignoter les props sous le pinceau.
 *
 * Le cache appartient à l'instance qui le crée — jamais une `Map` de module, même raison que pour
 * le registre : un jeu et un éditeur ouverts côte à côte ne partagent pas leurs textures. Il est
 * borné par le catalogue réellement PLACÉ (une poignée de feuilles par carte), et libéré d'un coup
 * au `dispose()` du moteur.
 *
 * `decoder` est injectable pour les tests ; en production c'est `fetchAll` + `createTextureRegistry`.
 */
export function createTextureCache(decoder: TextureDecoder = downloadAndDecode): TextureCache {
  const cache = new Map<string, THREE.Texture>();
  // Deux chargements concurrents (le décor et les events partent ensemble) qui demandent la même
  // feuille ne doivent la télécharger qu'une fois : le second attend le premier au lieu d'ouvrir sa
  // propre requête et d'écraser l'entrée avec un doublon que plus personne ne disposera.
  const pending = new Map<string, Promise<void>>();

  return {
    async load(specs) {
      const keys = new Map(specs.map((spec) => [spec.url, cacheKey(spec)]));
      const missing = specs.filter(
        (spec) => !cache.has(cacheKey(spec)) && !pending.has(cacheKey(spec)),
      );
      if (missing.length > 0) {
        const job = (async () => {
          // Le registre rendu par le décodeur est JETABLE et n'est surtout pas disposé : ses
          // textures passent au cache, et les disposer les emporterait avec lui.
          const registry = await decoder(missing);
          for (const spec of missing) cache.set(cacheKey(spec), registry.get(spec.url));
        })();
        for (const spec of missing) pending.set(cacheKey(spec), job);
        try {
          await job;
        } finally {
          for (const spec of missing) pending.delete(cacheKey(spec));
        }
      }
      // Ce que ce chargement-ci n'a pas demandé peut être en vol pour un autre : l'attendre, sinon
      // la vue rendue promettrait une texture que `get` ne trouverait pas encore.
      await Promise.all(specs.map((spec) => pending.get(cacheKey(spec)) ?? Promise.resolve()));
      return {
        get(url, opts = {}) {
          const tex = cache.get(keys.get(url) ?? url);
          if (!tex) throw new Error(`Texture non chargée : ${url}`);
          if (opts.repeat) {
            tex.wrapS = THREE.RepeatWrapping;
            tex.wrapT = THREE.RepeatWrapping;
          }
          return tex;
        },
      };
    },

    size() {
      return cache.size;
    },

    dispose() {
      for (const tex of cache.values()) tex.dispose();
      cache.clear();
      pending.clear();
    },
  };
}
