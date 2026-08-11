import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// jsdom ships no ResizeObserver; react-resizable-panels (the editor shell's three-pane body) reads
// it off the window and constructs one on mount. A no-op stub lets those components render under the
// css:false suite without a layout engine.
if (!("ResizeObserver" in globalThis)) {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    value: ResizeObserverStub,
    writable: true,
    configurable: true,
  });
}

// jsdom ships no working `window.matchMedia`; `@alepha/ui`'s `useIsMobile` (`.vendor/@alepha/ui/
// src/hooks/use-mobile.ts` — the responsive collapse behind `AppShell`'s sidebar) and `sonner`
// (the toast library `AppShell` also mounts) both call it unconditionally on mount. A
// never-matching stub with no-op listeners lets components using it (the admin shell, and any
// future `@alepha/ui` consumer) render under the css:false suite without a real layout engine —
// same reasoning as the `ResizeObserver` stub above. Checked with `typeof ... !== "function"`,
// not `"matchMedia" in window`: vitest's jsdom environment already defines the property (as
// `undefined`), so an `in` check sees it as "already there" and never installs the stub.
if (typeof window.matchMedia !== "function") {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
    writable: true,
    configurable: true,
  });
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
