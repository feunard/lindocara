export interface MapRenderIdentity {
  mapId: string;
  revision: number;
}

/** Dimensions are intentionally absent: authored content can change without resizing the map. */
export function sameRenderedMap(a: MapRenderIdentity, b: MapRenderIdentity): boolean {
  return a.mapId === b.mapId && a.revision === b.revision;
}
