/** Shared authored-map dimensions. The editor, server validator and layer codec must agree. */
export const MAP_MIN_COLS = 20;
export const MAP_MAX_COLS = 256;
export const MAP_MIN_ROWS = 15;
export const MAP_MAX_ROWS = 256;
export const MAX_MAP_CELLS = MAP_MAX_COLS * MAP_MAX_ROWS;

/** Ocean cells kept around the derived content rect when the editor crops a map for saving. */
export const MAP_OCEAN_MARGIN = 2;
