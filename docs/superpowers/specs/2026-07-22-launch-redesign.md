# Launch / title redesign — design

- **Date** : 2026-07-22
- **Statut** : approuvé (brainstorming)
- **But** : refondre l'accueil (title → menu → jouer) en **feeling Warcraft 3**, **manette-first**
  (on doit pouvoir lancer une partie entièrement à la manette), en supprimant les frictions débiles :
  pas de nom de partie/aventure, pas de select HTML, pas de choix de couleur, éditeur discret.

## Contraintes conservées

- Post-login n'est **jamais** un CharacterSelect (règle AGENTS.md). C'est le **menu principal**.
- Player/game UI = arbre **`ui/tiny-swords/`** (jamais shadcn). L'éditeur reste shadcn et devient un
  **bouton discret**.
- Le serveur décide : aucun message client ne choisit couleur, map ou position.

## Flux cible

```
TitleScreen (art plein écran, "Appuie sur A / clic pour commencer")
  └─▶ (si non loggé) AuthScreen  ─▶  MainMenu
  └─▶ (si loggé)                     MainMenu
MainMenu (menu central WC3, focusable manette/clavier/souris)
  ├─ CONTINUER ─▶ SaveCarousel  (mes parties = aventure + MON héros) ─▶ [A] entre en jeu direct
  ├─ NOUVELLE  ─▶ AdventureCarousel ─▶ [A] ─▶ HeroCreate ─▶ (party auto) ─▶ jeu
  ├─ REJOINDRE ─▶ PartyCarousel (parties ouvertes des autres) ─▶ [A] ─▶ HeroCreate ─▶ jeu
  ├─ OPTIONS   ─▶ SettingsMenu (existant)
  └─ [Éditeur] ─▶ bouton discret coin bas-gauche (souris/clavier — hors flux manette)
```

**Save = 1 héros.** Une entrée « Continuer » est (partie + le héros que J'y ai) ; la reprendre entre
**directement** en jeu, sans écran héros. La création de héros n'arrive que sur Nouvelle/Rejoindre.

## Écrans & composants (arbre `ui/tiny-swords/`)

Nouveaux :
- `TitleScreen.tsx` — press-start (A / Entrée / clic). Fond art. Entrée du flux manette.
- `MainMenu.tsx` — panneau central bois/pierre, pile de gros boutons ornementés (Continuer /
  Nouvelle / Rejoindre / Options), titre en haut, **hints manette** en bas, bouton **Éditeur discret**.
- `Carousel.tsx` — carrousel de cartes générique (cover art + titre), carte focus agrandie, navigable
  horizontalement. Réutilisé par SaveCarousel / AdventureCarousel / PartyCarousel via des props.
- `HeroCreate.tsx` — création d'un héros (classe + apparence), appelée sur Nouvelle/Rejoindre.

Retirés / vidés :
- `PartiesScreen.tsx` (le select d'aventure + le nom + les couleurs) → remplacé par MainMenu + carrousels.
- `ColorPicker.tsx` → supprimé (couleur auto serveur).
- L'usage `TinyFieldSelect` pour l'aventure → supprimé.

## Navigation manette / clavier / souris (le cœur technique)

Un **système de focus unique** pour tous les écrans d'accueil :
- `useMenuNav()` (client, React) : un provider de focus + un hook. Les items s'enregistrent dans un
  ordre ; un `focusedId` ; **D-pad/stick** déplace le focus (vertical menu, horizontal carrousel),
  **A** (bouton 0) valide, **B** (bouton 1) retour.
- **Trois entrées, un modèle** : clavier (flèches + Entrée/Échap) et souris (hover pose le focus, clic
  = A) miroir de la manette. Tout marche aux trois.
- Polling manette via `requestAnimationFrame` + `navigator.getGamepads()`, avec anti-répétition
  (une pression = un pas ; deadzone stick). Réutilise les conventions de `renderer/input.ts`
  (déjà du gamepad in-game) sans importer de code jeu dans React.
- Anneau de focus visible + **hints manette contextuels** en bas de chaque écran.

## Visuel (frontend-design à l'implémentation)

Fond plein écran (scène douce / parallaxe légère). Panneau central texturé Tiny Swords, gros boutons
ornementés avec état focus marqué. Carrousels : cartes cover-art, la focus agrandie + surbrillance.
La skill `frontend-design` cadre typo / hiérarchie / accents pour éviter le rendu “template”.

## Back-end (minimal, serveur)

- `createParty` : **nom absent/optionnel** ; le serveur assigne la **couleur** (prochaine libre via la
  logique `PARTY_COLORS` existante) — le client n'envoie jamais de couleur.
- « Mes parties » expose déjà party + héros ; on renvoie **mon héros par save** pour l'entrée directe.
- Rejoindre une partie : le serveur assigne la couleur à l'admission.

## i18n

Nouvelles clés FR + EN : `menu.continue`, `menu.new`, `menu.join`, `menu.options`, `menu.editor`,
`title.press_start`, `menu.hint.*`, libellés carrousels. (Le test i18n impose la parité FR/EN.)

## Tests

- UI (jsdom) : rendu MainMenu / carrousels / HeroCreate ; `useMenuNav` (focus move au clavier, wrap,
  A active, B back) ; simulation manette via un stub `navigator.getGamepads`.
- Serveur : `createParty` sans nom + couleur auto ; admission assigne une couleur libre.
- CSS non couvert par les tests → vérif navigateur via `npm run preview` (le build), pas le dev.

## Hors périmètre

- Pas de changement au gameplay, protocole, ou schéma D1 au-delà de la couleur/nom auto.
- L'éditeur (shadcn) n'est pas retouché sauf son point d'entrée (bouton discret).
- Multi-manettes / hot-plug avancé : une manette suffit pour ce lot.
