import { describe, expect, it } from "vitest";

import { sheetUv } from "../src/sheet.js";

describe("sheetUv", () => {
  const uv = sheetUv({ cols: 6, rows: 8 });

  it("place la frame dans son rectangle d'atlas", () => {
    // Frame 7 sur une grille 6x8 : colonne 1, ligne 1. L'origine UV est en bas, la feuille se lit
    // du haut : la ligne r part donc de 1 - (r + 1) / rows.
    expect(uv.frame(7)).toEqual({
      offsetX: 1 / 6,
      offsetY: 1 - 2 / 8,
      repeatX: 1 / 6,
      repeatY: 1 / 8,
    });
  });

  it("miroite par un repeat négatif, en gardant les UV dans [0,1]", () => {
    // Le flip se fait par un repeat négatif et un offset décalé d'une colonne : les UV restent
    // dans [0,1], donc un wrap ClampToEdge suffit et rien ne bave sur la frame voisine.
    expect(uv.frame(7, { flipped: true })).toEqual({
      offsetX: 2 / 6,
      offsetY: 1 - 2 / 8,
      repeatX: -1 / 6,
      repeatY: 1 / 8,
    });
  });

  it("traite la première frame comme les autres", () => {
    expect(uv.frame(0)).toEqual({ offsetX: 0, offsetY: 1 - 1 / 8, repeatX: 1 / 6, repeatY: 1 / 8 });
  });
});
