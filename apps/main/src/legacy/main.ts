// The deployable app's entry. It lives inside the Vite root (apps/main) so the dev server serves it
// as a real module; it simply pulls in the client's self-mounting entry from @lindocara/client. Do
// not add app logic here — the app IS the client. See vite.config.ts for why the root is apps/main.
import "@lindocara/client/main.js";
