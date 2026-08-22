import * as THREE from "three";
import { describe, expect, it } from "vitest";

import type { TextureRegistry, TextureSpec } from "../src/textures.js";
import { createTextureCache } from "../src/textures.js";

/** Un décodeur qui compte ce qu'on lui demande. La politique du cache est ce qui est testé ici —
 *  le décodage réel a besoin d'un DOM, ce projet tourne sous node, et c'est précisément pourquoi
 *  `createTextureCache` prend son décodeur en paramètre. */
function spyDecoder(): {
  decode: (specs: readonly TextureSpec[]) => Promise<TextureRegistry>;
  batches: TextureSpec[][];
  decoded: string[];
  release: () => void;
} {
  const batches: TextureSpec[][] = [];
  const decoded: string[] = [];
  let gate: (() => void) | null = null;
  return {
    batches,
    decoded,
    release: () => gate?.(),
    async decode(specs) {
      batches.push([...specs]);
      for (const spec of specs) decoded.push(spec.url);
      if (gate === null && batches.length === 1) {
        await new Promise<void>((resolve) => {
          gate = resolve;
        });
      }
      const map = new Map(specs.map((spec) => [spec.url, new THREE.Texture()]));
      return {
        get(url) {
          const tex = map.get(url);
          if (!tex) throw new Error(`absente : ${url}`);
          return tex;
        },
        decode: async () => {},
        urls: () => specs.map((spec) => spec.url),
        dispose: () => {},
      };
    },
  };
}

describe("createTextureCache", () => {
  it("ne redécode pas une feuille déjà tenue, quel que soit le chargement qui la redemande", async () => {
    // Le cœur du correctif : `Hd2dRenderer` reconstruisait sa scène à chaque édition de terrain et
    // rejetait les textures du décor avec elle, donc chaque coup de pinceau retéléchargeait des
    // feuilles identiques — ~90 ms de fetch sur cache HTTP CHAUD, décor absent de l'écran pendant
    // ce temps. Ce test est la garantie que ça ne revient pas.
    const spy = spyDecoder();
    const cache = createTextureCache(spy.decode);

    const first = cache.load([{ url: "a.png" }, { url: "b.png" }]);
    spy.release();
    await first;
    await cache.load([{ url: "a.png" }, { url: "b.png" }]);
    await cache.load([{ url: "b.png" }, { url: "c.png" }]);

    expect(spy.decoded).toEqual(["a.png", "b.png", "c.png"]);
    expect(cache.size()).toBe(3);
  });

  it("ne télécharge qu'une fois une feuille que deux chargements concurrents demandent", async () => {
    // Le décor et les events partent ensemble à l'arrivée d'une carte. Sans la table des vols en
    // cours, le second ouvrirait sa propre requête et écraserait l'entrée du premier par un
    // doublon que plus personne ne disposerait.
    const spy = spyDecoder();
    const cache = createTextureCache(spy.decode);

    const first = cache.load([{ url: "shared.png" }]);
    const second = cache.load([{ url: "shared.png" }]);
    spy.release();
    const [left, right] = await Promise.all([first, second]);

    expect(spy.decoded).toEqual(["shared.png"]);
    // Et les deux vues voient bien la texture : la seconde a attendu le vol en cours plutôt que de
    // rendre une vue dont le `get` aurait échoué.
    expect(left.get("shared.png")).toBe(right.get("shared.png"));
  });

  it("sépare la même image échantillonnée en atlas et en sprite", async () => {
    // Même url, filtrages incompatibles : une seule entrée servirait à l'un le réglage de l'autre,
    // sans erreur — juste des bordures qui bavent.
    const spy = spyDecoder();
    const cache = createTextureCache(spy.decode);

    const first = cache.load([{ url: "sheet.png", atlas: true }]);
    spy.release();
    await first;
    await cache.load([{ url: "sheet.png" }]);

    expect(spy.batches).toHaveLength(2);
    expect(cache.size()).toBe(2);
  });

  it("libère tout au dispose, et rien avant", async () => {
    const spy = spyDecoder();
    const cache = createTextureCache(spy.decode);
    const first = cache.load([{ url: "a.png" }]);
    spy.release();
    const view = await first;
    const texture = view.get("a.png");
    const disposed = new Promise<void>((resolve) => {
      texture.addEventListener("dispose", () => resolve());
    });

    expect(cache.size()).toBe(1);
    cache.dispose();
    await expect(disposed).resolves.toBeUndefined();
    expect(cache.size()).toBe(0);
  });
});
