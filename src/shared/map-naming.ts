/**
 * Default map names (UX wave #16): a new map is named `Map1`, `Map2`, `Map3`… — never the adventure
 * title. `nextMapName` returns the lowest-numbered `MapN` not already taken by an existing map name,
 * so the sequence skips names an author has already used (or renamed onto). Platform-free: the client
 * computes the next name from its loaded list and sends it, keeping the server dumb (it stores
 * whatever validated name it is handed). The atomic adventure-create's first map is always `Map1` —
 * a brand-new adventure has zero maps, so the next free number is trivially 1.
 */
export function nextMapName(existingNames: readonly string[]): string {
  const taken = new Set(existingNames);
  let n = 1;
  while (taken.has(`Map${n}`)) n += 1;
  return `Map${n}`;
}
