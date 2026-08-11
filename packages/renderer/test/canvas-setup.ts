/**
 * A 2D canvas context for the renderer's suite only.
 *
 * jsdom implements `<canvas>` but not its 2D context: `getContext("2d")` returns null unless the
 * native `canvas` package is installed. `@lindocara/hd2d` paints a handful of small procedural
 * textures that way — the contact shadow, the diffuse glow, the ripple ring — and throws outright
 * on a null context, which is correct in a browser and fatal in a suite that only wants to know the
 * mesh was created.
 *
 * **Deliberately NOT in `@lindocara/testing`'s shared setup.** Installed globally it doubled the
 * editor suite's runtime (16s to 30s) and made one of its tests time out: editor components that
 * previously took a cheap null-context bail-out started doing real canvas work for nobody's
 * benefit. A stub that makes other suites slower to fix this one is the wrong trade — this file is
 * loaded by `packages/renderer/vitest.config.ts` and nothing else.
 *
 * Nothing here asserts on PIXELS, only on the objects built around them, so every drawing call is
 * a no-op.
 */
if (typeof HTMLCanvasElement !== "undefined") {
  const nativeGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(
    this: HTMLCanvasElement,
    contextId: string,
    ...rest: unknown[]
  ) {
    if (contextId !== "2d") {
      return (nativeGetContext as unknown as (...args: unknown[]) => unknown).call(
        this,
        contextId,
        ...rest,
      );
    }
    const gradient = { addColorStop() {} };
    return {
      canvas: this,
      createRadialGradient: () => gradient,
      createLinearGradient: () => gradient,
      fillRect() {},
      clearRect() {},
      beginPath() {},
      arc() {},
      fill() {},
      stroke() {},
      moveTo() {},
      lineTo() {},
      closePath() {},
      save() {},
      restore() {},
      translate() {},
      rotate() {},
      scale() {},
      drawImage() {},
      putImageData() {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: w,
        height: h,
      }),
      createImageData: (w: number, h: number) => ({
        data: new Uint8ClampedArray(Math.max(1, w * h * 4)),
        width: w,
        height: h,
      }),
      set fillStyle(_v: unknown) {},
      get fillStyle() {
        return "#000";
      },
      set strokeStyle(_v: unknown) {},
      get strokeStyle() {
        return "#000";
      },
      set globalAlpha(_v: number) {},
      get globalAlpha() {
        return 1;
      },
      set lineWidth(_v: number) {},
      get lineWidth() {
        return 1;
      },
    };
  } as typeof HTMLCanvasElement.prototype.getContext;
}
