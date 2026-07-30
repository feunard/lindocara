import type { ReactNode } from "react";

/**
 * The bottom-of-screen control-hint strip (`↕ navigate`, `A select`, …) shared by `MainMenu` and
 * the launch carousels (`Carousel.tsx`/`HeroCreate.tsx`). Split out of `MainMenu.tsx` in Task 6:
 * once that file started importing `alepha/react*` (its editor button now reads/writes
 * `adventureEditorSessionAtom` directly), anything importing FROM it — including these two purely
 * presentational helpers, which have no `alepha` dependency of their own — would have pulled the
 * whole framework source tree into whichever `tsc` program compiled the importer. `Carousel.tsx`/
 * `HeroCreate.tsx` stay in the client package's plain, non-`alepha` `tsconfig.json` program; this
 * module has zero reason to force them into `tsconfig.api.json` too.
 */
export function MenuHints({ children }: { children: ReactNode }) {
  return <footer className="menu-hints">{children}</footer>;
}

export function Hint({ keyLabel, children }: { keyLabel: string; children: ReactNode }) {
  return (
    <span className="menu-hint">
      <kbd className="menu-hint__key">{keyLabel}</kbd>
      {children}
    </span>
  );
}
