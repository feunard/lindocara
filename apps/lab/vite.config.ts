import { defineConfig } from "vite";

// Le labo se sert directement des sources du package : pas d'étape de build entre une
// expérimentation et ce qu'on voit à l'écran, c'est tout l'intérêt d'un témoin.
export default defineConfig({
  server: { port: 5174 },
  // Tout ce qui traîne dans public/ part en production : Vite le recopie tel quel.
  publicDir: "public",
});
