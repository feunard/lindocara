/**
 * La composition d'une carte de la Baie : une petite scène qu'on empile couche par couche.
 *
 * Le générateur d'îles (`scripts/lib/island-terrain.ts`) fournit les primitives — blob, lissage,
 * élévation, escaliers, semis. Ce fichier les assemble dans l'ordre qui donne une carte LISIBLE :
 *
 *   1. la terre (une ou plusieurs îles, puis les lagunes qu'on recreuse dedans)
 *   2. le relief (plateaux + falaises sur les quatre côtés, un escalier pour y monter)
 *   3. les passerelles de bois — la seule scenerie qui RECLAME l'eau (`terrainOverride: "walkable"`),
 *      donc le seul moyen de relier deux lobes d'une même carte sans barque
 *   4. les cellules réservées (spawn, événements, seuils) — rien ne doit tomber dessus
 *   5. le décor : ligne d'arbres sur la côte, semis à l'intérieur, récifs au large, nuages au ciel
 *
 * L'ordre compte : le décor est semé EN DERNIER, contre un masque qui connaît déjà tout ce qui doit
 * rester dégagé. C'est ce qui évite le sapin planté devant la porte du marchand.
 *
 * Tout est déterministe (PRNG semé par le nom de la carte) : deux builds produisent le même octet.
 */

import { elementCells, elementFitsMap, type MapElement } from "@lindocara/engine/map-data.js";
import { paintStairs, syncElevationWalls } from "@lindocara/engine/tile-brush.js";
import { encodeTileLayer, type TileLayer } from "@lindocara/engine/tile-layer-codec.js";
import { decodeTileId, EMPTY_TILE } from "@lindocara/engine/tileset.js";
import {
  GRASS_SLOTS,
  isRampFixedIndex,
  TINY_SWORDS_TILESET,
} from "@lindocara/engine/tilesets/tiny-swords.js";
import type { EditorAssetId } from "@lindocara/engine/tiny-swords-catalog.js";
import {
  BUSHES,
  blob,
  countCells,
  element,
  emptyMask,
  forEachCell,
  inland,
  type Mask,
  maskAt,
  offshoreRocks,
  paintGround,
  placeableMask,
  type Rng,
  ROCKS,
  raise,
  rectMask,
  reserve,
  STUMPS,
  scatter,
  shoreTreeLine,
  smooth,
  snapper,
  TREES,
} from "../lib/island-terrain.js";

export const CLOUDS: readonly EditorAssetId[] = [
  "decoration.terrain-decorations-clouds.clouds-01",
  "decoration.terrain-decorations-clouds.clouds-03",
  "decoration.terrain-decorations-clouds.clouds-05",
  "decoration.terrain-decorations-clouds.clouds-07",
] as EditorAssetId[];

/** Les petits décors « posés par une main » : cordages, tonneaux, paniers, piquets. */
export const PROPS: readonly EditorAssetId[] = [
  "decoration.deco.01",
  "decoration.deco.03",
  "decoration.deco.05",
  "decoration.deco.09",
  "decoration.deco.13",
  "decoration.deco.14",
] as EditorAssetId[];

export interface IslandSpec {
  col: number;
  row: number;
  radiusX: number;
  radiusY: number;
  wobble?: number;
}

/**
 * Une scène en construction. Chaque `add*` mute l'état interne ; `finish()` rend les trois couches
 * encodées et la liste d'éléments, prêtes pour `AdventureBundleMap`.
 */
export class Scene {
  readonly cols: number;
  readonly rows: number;
  readonly rng: Rng;
  land: Mask;
  /** Le relief cumulé : une cellule vraie ici porte une falaise sur ses voisins plus bas. */
  relief: Mask;
  layers: TileLayer[] = [];
  elements: MapElement[] = [];
  #reserved: { col: number; row: number }[] = [];
  #occupied = new Set<string>();
  #lastPlateau: Mask | null = null;

  constructor(cols: number, rows: number, rng: Rng) {
    this.cols = cols;
    this.rows = rows;
    this.rng = rng;
    this.land = emptyMask(cols, rows);
    this.relief = emptyMask(cols, rows);
  }

  /** Une île : une ellipse dont le rayon ondule avec l'angle. Plusieurs appels = un archipel. */
  addIsland(spec: IslandSpec): this {
    blob(this.land, this.rng, { ...spec, wobble: spec.wobble ?? 0.26 });
    return this;
  }

  /** Un banc rectangulaire — une jetée, une langue de terre, un quai. */
  addBank(c0: number, r0: number, c1: number, r1: number): this {
    rectMask(this.land, c0, r0, c1, r1, true);
    return this;
  }

  /** Une lagune : de l'eau recreusée DANS la terre. C'est ce qui donne les baies fermées. */
  addLagoon(spec: IslandSpec): this {
    const hole = emptyMask(this.cols, this.rows);
    blob(hole, this.rng, { ...spec, wobble: spec.wobble ?? 0.3 });
    forEachCell(hole, (col, row) => {
      const line = this.land[row];
      if (line && col >= 0 && col < line.length) line[col] = false;
    });
    return this;
  }

  /** Un chenal droit taillé dans la terre — le détroit qu'une passerelle viendra franchir. */
  addChannel(c0: number, r0: number, c1: number, r1: number): this {
    rectMask(this.land, c0, r0, c1, r1, false);
    return this;
  }

  /** Ferme la côte : on supprime les langues d'une case et on rebouche les mares d'une case. */
  settleCoast(passes = 2): this {
    smooth(this.land, passes);
    return this;
  }

  /** Peint le sol une fois la côte arrêtée. À appeler avant tout relief. */
  paint(): this {
    this.layers = paintGround(this.cols, this.rows, this.land);
    return this;
  }

  /**
   * Élève un plateau. `paintElevation` entretient lui-même la falaise sur les voisins plus bas, donc
   * un plateau est une vraie barrière sur ses quatre côtés — au caller de laisser un escalier ou un
   * contournement, sinon le validateur de bundle refusera la carte pour cause d'événement enfermé.
   */
  addPlateau(spec: IslandSpec, level: 1 | 2): this {
    const plateau = emptyMask(this.cols, this.rows);
    blob(plateau, this.rng, { ...spec, wobble: spec.wobble ?? 0.2 });
    // Un plateau ne déborde jamais en mer : une falaise posée sur de l'eau ne se lit pas.
    const solid = inland(this.land, 1);
    forEachCell(plateau, (col, row) => {
      if (!maskAt(solid, col, row)) {
        const line = plateau[row];
        if (line) line[col] = false;
      }
    });
    this.layers = raise(this.layers, plateau, level);
    forEachCell(plateau, (col, row) => {
      const line = this.relief[row];
      if (line) line[col] = true;
    });
    this.#lastPlateau = plateau;
    return this;
  }

  /**
   * Cherche une marche praticable sur le flanc gauche ou droit du dernier plateau posé.
   *
   * Le pack ne fournit que les deux rampes latérales (colonne 0 monte vers la droite, colonne 3 vers
   * la gauche) : un escalier se colle donc au bord EST ou OUEST d'un plateau, jamais au nord ni au
   * sud. `paintStairs` rend ses entrées inchangées quand la géométrie ne convient pas — c'est ce
   * silence qu'on transforme ici en essai suivant, puis en erreur franche si aucun flanc ne marche.
   */
  addStairsToPlateau(from: 0 | 1): this {
    const plateau = this.#lastPlateau;
    if (!plateau) throw new Error("addStairsToPlateau sans plateau posé");
    let minCol = Number.POSITIVE_INFINITY;
    let maxCol = Number.NEGATIVE_INFINITY;
    let minRow = Number.POSITIVE_INFINITY;
    let maxRow = Number.NEGATIVE_INFINITY;
    forEachCell(plateau, (col, row) => {
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
    });
    if (!Number.isFinite(minCol)) throw new Error("plateau vide");

    // On part du milieu du plateau : une marche au centre du flanc se voit mieux qu'au ras du coin.
    const middle = Math.round((minRow + maxRow) / 2);
    const rowsByDistance = [...Array(maxRow - minRow + 1).keys()]
      .map((offset) => minRow + offset)
      .sort((a, b) => Math.abs(a - middle) - Math.abs(b - middle));
    const before = JSON.stringify(this.layers[1]?.ids);
    for (const row of rowsByDistance) {
      // Le flanc se mesure LIGNE PAR LIGNE. La boîte englobante d'un plateau ondulé désigne, sur la
      // plupart des lignes, une case qui est encore de la falaise ou déjà de la mer : la marche s'y
      // pose sans rien relier, et l'événement posé sur la terrasse devient injoignable en silence.
      let rowMin = Number.POSITIVE_INFINITY;
      let rowMax = Number.NEGATIVE_INFINITY;
      for (let col = minCol; col <= maxCol; col += 1) {
        if (!maskAt(plateau, col, row)) continue;
        rowMin = Math.min(rowMin, col);
        rowMax = Math.max(rowMax, col);
      }
      if (!Number.isFinite(rowMin)) continue;
      for (const candidate of [
        { col: rowMin - 1, direction: "east" as const },
        { col: rowMax + 1, direction: "west" as const },
      ]) {
        if (!maskAt(this.land, candidate.col, row)) continue;
        if (maskAt(plateau, candidate.col, row)) continue;
        const next = paintStairs(
          this.layers,
          TINY_SWORDS_TILESET,
          candidate.col,
          row,
          candidate.direction,
          from,
        );
        if (JSON.stringify(next[1]?.ids) === before) continue;
        this.layers = next;
        this.reserve([{ col: candidate.col, row }], 1);
        return this;
      }
    }
    throw new Error(`aucun escalier praticable sur le plateau (niveau ${from}→${from + 1})`);
  }

  /**
   * Taille un escalier à une position choisie. `paintStairs` rend ses entrées inchangées quand la
   * géométrie ne convient pas ; on compare donc la couche 1 avant/après pour savoir si la marche a
   * bien été posée, et on le signale au lieu de laisser une terrasse inaccessible passer sans bruit.
   */
  addStairs(col: number, row: number, direction: "east" | "west", from: 0 | 1): this {
    const before = JSON.stringify(this.layers[1]?.ids);
    const next = paintStairs(this.layers, TINY_SWORDS_TILESET, col, row, direction, from);
    if (JSON.stringify(next[1]?.ids) === before) {
      throw new Error(
        `escalier refusé en ${col},${row} (${direction}, niveau ${from}→${from + 1})`,
      );
    }
    this.layers = next;
    // Les deux cellules de la rampe cessent d'être des falaises : on resynchronise leur voisinage.
    for (const [dc, dr] of [
      [0, 0],
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      this.layers = syncElevationWalls(this.layers, TINY_SWORDS_TILESET, col + dc, row + dr);
    }
    this.reserve([{ col, row }], 0);
    return this;
  }

  /**
   * Une passerelle de bois sur l'eau. C'est la seule scenerie qui RÉCLAME sa cellule : son
   * `terrainOverride: "walkable"` retourne l'eau en sol praticable au moment du bake. Une planche
   * horizontale couvre trois colonnes, une verticale trois lignes.
   */
  addBridge(col: number, row: number, orientation: "horizontal" | "vertical"): this {
    this.elements.push(
      element(
        orientation === "horizontal"
          ? ("terrain.bridge.wood.horizontal" as EditorAssetId)
          : ("terrain.bridge.wood.vertical" as EditorAssetId),
        col,
        row,
      ),
    );
    const cells =
      orientation === "horizontal"
        ? [
            { col: col - 1, row },
            { col, row },
            { col: col + 1, row },
          ]
        : [
            { col, row: row - 2 },
            { col, row: row - 1 },
            { col, row },
          ];
    this.reserve(cells, 0);
    return this;
  }

  /** Une travée continue de passerelles entre deux rives. */
  addBridgeSpan(from: { col: number; row: number }, to: { col: number; row: number }): this {
    if (from.row === to.row) {
      for (let col = Math.min(from.col, to.col) + 1; col <= Math.max(from.col, to.col); col += 3) {
        this.addBridge(col, from.row, "horizontal");
      }
      return this;
    }
    for (let row = Math.min(from.row, to.row) + 2; row <= Math.max(from.row, to.row); row += 3) {
      this.addBridge(from.col, row, "vertical");
    }
    return this;
  }

  /**
   * Interdit le décor sur ces cellules. Deux périmètres, volontairement différents :
   * - `#reserved` (la cellule ET son voisinage) écarte le SEMIS, qui doit laisser de l'air autour
   *   d'un PNJ ;
   * - `#occupied` (la cellule seule) protège ce qui ne doit jamais être RECOUVERT — une case
   *   d'événement, un quai. Un bâtiment peut jouxter un PNJ, jamais l'ensevelir.
   */
  reserve(cells: readonly { col: number; row: number }[], radius = 1): this {
    for (const candidate of cells) {
      this.#occupied.add(`${candidate.col}:${candidate.row}`);
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          this.#reserved.push({ col: candidate.col + dc, row: candidate.row + dr });
        }
      }
    }
    return this;
  }

  /** Le masque des cellules où l'on peut légitimement poser un événement : à l'intérieur des
   *  terres, loin de la rive et hors du bord des falaises. */
  placeable(): Mask {
    return placeableMask(this.land, this.relief);
  }

  /**
   * Pose un décor écrit à la main. Contrairement au semis, il ÉCHOUE plutôt que d'être écarté : un
   * bâtiment a une emprise de neuf à vingt cases et se pose relativement à un PNJ, donc il finit
   * tôt ou tard sur la case d'un autre événement. Silencieusement écarté, le village perdrait une
   * maison sans qu'on le sache ; silencieusement gardé, il enterrerait un PNJ et le rendrait
   * injoignable — ce que le validateur ne signalerait qu'à l'autre bout du build.
   */
  place(assetId: EditorAssetId, col: number, row: number, offsetX = 0, offsetY = 0): this {
    const candidate = element(assetId, col, row, offsetX, offsetY);
    const clash = elementCells(candidate).find((item) =>
      this.#occupied.has(`${item.col}:${item.row}`),
    );
    if (clash) {
      throw new Error(
        `décor ${assetId} posé en ${col},${row} recouvre la case réservée ${clash.col},${clash.row}`,
      );
    }
    this.elements.push(candidate);
    return this;
  }

  /**
   * Pose un décor authored au plus près de l'endroit voulu.
   *
   * Un bâtiment couvre de neuf à vingt cases et on l'écrit relativement à un PNJ (« la maison
   * derrière le marchand ») : sur du terrain généré, l'emprise finit régulièrement sur la case d'un
   * autre événement ou à cheval sur la mer. Plutôt que de refuser — ce qui obligerait à réaccorder
   * quarante coordonnées à chaque retouche de côte — on applique la règle déjà établie par le
   * `snapper` : la coordonnée est un SOUHAIT, et on prend le premier ancrage légal en s'éloignant en
   * anneaux. Déterministe, et l'échec reste franc quand rien ne convient à portée.
   */
  placeNear(assetId: EditorAssetId, col: number, row: number, reach = 6): this {
    for (let radius = 0; radius <= reach; radius += 1) {
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== radius) continue;
          const candidate = element(assetId, col + dc, row + dr, 0, 0);
          if (!elementFitsMap(candidate, this.cols, this.rows)) continue;
          const cells = elementCells(candidate);
          if (cells.some((item) => this.#occupied.has(`${item.col}:${item.row}`))) continue;
          // Un bâtiment se tient sur la terre ferme : son ancrage (sa base) doit être du sol.
          if (!maskAt(this.land, candidate.col, candidate.row)) continue;
          this.elements.push(candidate);
          // Sa propre emprise devient occupée : deux maisons ne se chevauchent pas, et le semis
          // n'ira pas planter un chêne au milieu du toit.
          for (const item of cells) this.#occupied.add(`${item.col}:${item.row}`);
          this.reserve(cells, 0);
          return this;
        }
      }
    }
    throw new Error(
      `aucun ancrage libre pour ${assetId} à moins de ${reach} cases de ${col},${row}`,
    );
  }

  /**
   * Le semis final. Arbres serrés sur le trait de côte (c'est ce qui encadre l'île comme dans l'art
   * du pack), décor épars à l'intérieur, récifs au large, nuages au-dessus de la mer.
   */
  dress(options: {
    shoreTrees?: number;
    inlandProps?: readonly EditorAssetId[];
    inlandDensity?: number;
    undergrowth?: number;
    /** Nombre de touffes d'arbres denses semées à l'intérieur des terres. */
    groves?: number;
    reefs?: number;
    clouds?: number;
  }): this {
    const reserved = reserve(this.#reserved, 0);
    const interior = inland(this.land, 2);
    // Un semis est une PROPOSITION : un arbre a une couronne de 3x4 cases, donc celui qui pousse au
    // ras du bord déborde de la carte. On le laisse tomber ici plutôt que de le faire refuser par le
    // validateur — contrairement à un décor posé à la main, qui lui doit échouer bruyamment.
    // …et un semis se juge sur son EMPRISE, pas sur son ancre : un arbre planté deux cases plus
    // loin couvre quand même le quai avec sa couronne. `reserve()` filtre par ancre, ce qui suffit
    // au générateur mais pas ici, donc on repasse chaque candidat cellule par cellule.
    const protectedCells = new Set(this.#reserved.map((item) => `${item.col}:${item.row}`));
    const sow = (candidates: readonly MapElement[]): void => {
      for (const candidate of candidates) {
        if (!elementFitsMap(candidate, this.cols, this.rows)) continue;
        if (elementCells(candidate).some((item) => protectedCells.has(`${item.col}:${item.row}`))) {
          continue;
        }
        this.elements.push(candidate);
      }
    };

    if (options.shoreTrees !== undefined && options.shoreTrees > 0) {
      sow(shoreTreeLine(this.land, this.rng, reserved, options.shoreTrees));
    }
    if (options.undergrowth !== undefined && options.undergrowth > 0) {
      sow(scatter(interior, this.rng, reserved, [...BUSHES, ...ROCKS], options.undergrowth));
    }
    if (options.inlandProps && (options.inlandDensity ?? 0) > 0) {
      sow(scatter(interior, this.rng, reserved, options.inlandProps, options.inlandDensity ?? 0));
    }
    // Des BOSQUETS avant les récifs : un semis uniforme donne un gazon poivré d'arbres, jamais un
    // paysage. L'art du pack groupe ses arbres en touffes et laisse de vraies clairières entre
    // elles ; on tire donc quelques centres et on plante dense autour, sans toucher au reste.
    for (let index = 0; index < (options.groves ?? 0); index += 1) {
      const centreCol = 3 + this.rng.int(Math.max(1, this.cols - 6));
      const centreRow = 3 + this.rng.int(Math.max(1, this.rows - 6));
      if (!maskAt(interior, centreCol, centreRow)) continue;
      const radius = 2 + this.rng.int(3);
      for (let dr = -radius; dr <= radius; dr += 1) {
        for (let dc = -radius; dc <= radius; dc += 1) {
          if (dc * dc + dr * dr > radius * radius) continue;
          const col = centreCol + dc;
          const row = centreRow + dr;
          if (!maskAt(interior, col, row)) continue;
          if (!this.rng.chance(0.45)) continue;
          sow([element(this.rng.pick(TREES), col, row, this.rng.int(4), this.rng.int(4))]);
        }
      }
    }
    if (options.reefs !== undefined && options.reefs > 0) {
      sow(offshoreRocks(this.cols, this.rows, this.land, this.rng, options.reefs));
    }
    for (let index = 0; index < (options.clouds ?? 0); index += 1) {
      // Les nuages vivent sur la couche « sky » : ils passent au-dessus de tout et n'ont pas de
      // collider. On les ancre au large pour qu'ils survolent la mer plutôt que le village.
      const col = 5 + this.rng.int(Math.max(1, this.cols - 10));
      const row = 4 + this.rng.int(Math.max(1, this.rows - 8));
      if (maskAt(interior, col, row)) continue;
      sow([element(this.rng.pick(CLOUDS), col, row)]);
    }
    return this;
  }

  /** Déduplique les slots (une cellule + un quart de case n'accueille qu'un élément) et encode. */
  finish(): { layers: string[]; elements: MapElement[] } {
    const seen = new Set<string>();
    const elements = this.elements.filter((candidate) => {
      const slot = `${candidate.col}:${candidate.row}:${candidate.offsetX}:${candidate.offsetY}`;
      if (seen.has(slot)) return false;
      seen.add(slot);
      return true;
    });
    return { layers: this.layers.map(encodeTileLayer), elements };
  }

  /** Combien de cases de terre — un garde-fou contre l'île qui a fondu au lissage. */
  landArea(): number {
    return countCells(this.land);
  }
}

export function stumpsAndProps(): readonly EditorAssetId[] {
  return [...STUMPS, ...PROPS];
}

export function treeLine(): readonly EditorAssetId[] {
  return TREES;
}

/** Le snapper de la scène : une coordonnée écrite à la main est un SOUHAIT, snappé sur la case
 *  légale la plus proche et réservée au passage. */
export function snapperFor(scene: Scene) {
  return snapper(scene.placeable());
}

/**
 * Un rendu ASCII de la couche sol, pour juger une carte sans ouvrir le navigateur.
 * `~` mer · `.` niveau 0 · `:` niveau 1 · `#` niveau 2 · `=` falaise · `/` rampe · `+` élément.
 */
export function previewScene(
  layers: readonly TileLayer[],
  cols: number,
  rows: number,
  elements: readonly MapElement[] = [],
): string {
  const marks = new Set(elements.map((item) => `${item.col}:${item.row}`));
  const lines: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    let line = "";
    for (let col = 0; col < cols; col += 1) {
      const index = row * cols + col;
      let glyph = "~";
      for (const layer of layers) {
        const id = layer.ids[index] ?? EMPTY_TILE;
        if (id === EMPTY_TILE) continue;
        const ref = decodeTileId(id);
        if (ref.kind === "fixed") {
          glyph = isRampFixedIndex(ref.index) ? "/" : "=";
          continue;
        }
        if (ref.kind !== "autotile") continue;
        const level = GRASS_SLOTS.indexOf(ref.slot);
        glyph = level === 2 ? "#" : level === 1 ? ":" : level === 0 ? "." : "=";
      }
      if (glyph !== "~" && marks.has(`${col}:${row}`)) glyph = "+";
      line += glyph;
    }
    lines.push(line);
  }
  return lines.join("\n");
}
