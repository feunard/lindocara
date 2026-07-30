// The deployable app's BROWSER entry, on Alepha's `src/main.browser.ts` convention
// (`AppEntryProvider`). Exactly like the legacy Vite entry (`src/legacy/main.ts`), it only pulls
// in the client's self-mounting module — the app IS the client. The HTML shell it mounts into
// (`#stage` canvas beside `#root`) is served by the server's `SpaController`; the dev server
// serves this file at `/src/main.browser.ts` and `alepha build` bundles it as the client entry.
import "@lindocara/client/main.js";
