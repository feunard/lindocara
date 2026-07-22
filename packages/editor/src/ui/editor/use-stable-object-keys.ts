import { useRef } from "react";

/** UI-only row identity for wire arrays whose schema intentionally has no row id. Immutable row
 * objects keep their key while siblings are edited or removed; replacing a row remounts only it. */
export function useStableObjectKeys<T extends object>(items: readonly T[], prefix: string) {
  const keys = useRef(new WeakMap<T, string>());
  const next = useRef(1);
  return items.map((item) => {
    const existing = keys.current.get(item);
    if (existing) return { item, key: existing };
    const key = `${prefix}-${next.current++}`;
    keys.current.set(item, key);
    return { item, key };
  });
}
