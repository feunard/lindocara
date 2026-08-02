export interface SheetRect {
  offsetX: number;
  offsetY: number;
  repeatX: number;
  repeatY: number;
}

/**
 * Découpe d'une feuille de sprites en frames.
 *
 * Le flip se fait par un repeat NÉGATIF et un offset décalé d'une colonne : les UV restent dans
 * [0,1], donc un wrap ClampToEdge suffit et le miroir ne va jamais chercher un pixel de la frame
 * voisine.
 */
export function sheetUv({ cols, rows }: { cols: number; rows: number }) {
  return {
    frame(i: number, { flipped = false }: { flipped?: boolean } = {}): SheetRect {
      const c = i % cols;
      const r = Math.floor(i / cols);
      return {
        offsetX: flipped ? (c + 1) / cols : c / cols,
        offsetY: 1 - (r + 1) / rows,
        repeatX: flipped ? -1 / cols : 1 / cols,
        repeatY: 1 / rows,
      };
    },
  };
}
