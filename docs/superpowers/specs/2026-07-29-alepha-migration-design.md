# Migration Alepha (vendor mode) — design

Date : 2026-07-29
Statut : validé en brainstorming, prêt pour le plan d'implémentation

## Objectif

lindocara devient une application **Alepha pure** (framework de l'auteur, `../alepha`, vendoré dans
le repo), en dogfooding assumé : Alepha peut être adapté quand lindocara révèle un manque, le patch
se fait dans `.vendor/` puis remonte upstream. La prod actuelle est abandonnée — **zéro migration de
données**, base fraîche. La cible de déploiement reste **Cloudflare (Durable Objects)** dès
aujourd'hui ; le VPS Node est un objectif futur qui ne coûte rien à préserver (Alepha est
runtime-neutre : même code, autre adapter).

Références Alepha (main, ≥ 0.24.0) : plugin vendor (`docs/4-cli/3-plugins/2-vendor.md`),
`$room`/RoomEngine (`docs/1-guides/4-server/10-rooms.md` — écrit pour lindocara), adapter Cloudflare
(`docs/1-guides/8-deployment/3-cloudflare.md`, `apps/lore` comme app de référence).

## Décisions de cadrage

| Sujet | Décision |
| --- | --- |
| Forme du repo | On garde les workspaces npm (`packages/*`, `apps/main`). Alepha remplace le framing, pas la structure. |
| Runtime | Dev local = Node/Vite (fonctionnement natif d'`alepha dev`, SQLite auto-sync). Déploiement = Cloudflare via `alepha platform up` (wrangler.jsonc généré). VPS Node : plus tard. |
| Persistance | ORM Alepha (`$entity`/`$repository`, schéma zod). SQLite en dev, D1 en prod (même dialecte). Schéma re-créé, rien à préserver. |
| Auth | Modules Alepha : `$realm()` (users/sessions/identities) + `$authCredentials` (login username/password, cookies httpOnly) + `useAuth()` côté client. L'auth maison (PBKDF2/HMAC) est supprimée. |
| UI | Les deux arbres de composants (tiny-swords pour le jeu, `@lindocara/ui` shadcn pour l'éditeur) restent tels quels. Alepha prend le shell (router, client typé, atoms). |
| Prod actuelle | Détruite. Le deploy CF legacy est gelé dès la tranche 0 ; le nouveau deploy arrive en tranche 4. |
| Approche | Tranches verticales sur `main`, ordre vendor → api → react → websocket → cleanup. Jeu jouable à chaque tranche (voir la nuance workerd en tranche 1). |

## Architecture cible

### Qui vit où

- `.vendor/alepha` — le framework, vendoré (`alepha vendor sync`, remote local
  `file:///Users/nfo/git/alepha` pour le dogfooding, github en fallback). `vendor.json` pinne le
  commit. Le sync ne modifie pas `package.json` : nous déclarons `.vendor/alepha` dans les
  workspaces npm une fois, à la tranche 0.
- `apps/main` — l'app Alepha : `alepha.config.ts` (plugins `platform({ environments: { production:
  { adapter: "cloudflare" } } })`, vendor, i18n éventuel), l'entry qui assemble les services,
  scripts `alepha dev` / `alepha build` / `alepha platform up -e production`. Le
  `vite.config.ts`, le `wrangler.jsonc` manuel et `drizzle.config.ts` disparaissent.
- `packages/server` — reste le foyer de la logique serveur, converti en services Alepha :
  entités (`$entity`/`$repository`), contrôleurs (`$action`), rooms (`$room` + rooms headless).
  Les world-systems (`world/*.ts`) sont réutilisés quasi tels quels — ils reçoivent déjà leurs
  dépendances en arguments.
- `packages/engine` — **intouché**. `step()`, `protocol` (comme types), `prediction`, death,
  tile-brush, i18n data : zéro changement. C'est l'invariant central de la migration.
- `packages/renderer`, `ui`, `catalog`, `testing` — intouchés.
- `packages/client` / `editor` — touchés à la tranche 2 (shell, store, api) et 3 (`net.ts`).

### Les règles qui ne bougent pas

- **Le serveur décide des outcomes.** Le `schema.in` du channel reste de l'intent pur (move,
  attack, skill slot, interact, chat, resync) — jamais une position, un dégât, une cible.
- **Une commande par tick**, ack par sequence, `MAX_STARVED_TICKS` — inchangé.
- **`step()` partagé** client/serveur — inchangé (il vit dans `engine`).
- **Fencing par epoch D1** sur toute écriture hero — inchangé.
- **AOI par destinataire**, loot personnel omis des vues des autres — inchangé (`room.send(connectionId, msg)`).
- **Codes, pas de prose serveur** (sauf l'exception sanctionnée de la prose authorée des events).

## Tranches

### Tranche 0 — Vendor + bootstrap (petite)

1. `npm i -D alepha` (amorce le CLI — chicken-egg résolu par le registre, ou `npx alepha`).
2. `alepha.config.ts` racine avec `vendor({ packages: ["alepha"], remote: "file:///Users/nfo/git/alepha" })`.
3. `npx alepha vendor sync` → `.vendor/alepha` + `vendor.json`.
4. `.vendor/alepha` ajouté aux `workspaces` du package.json racine ; la dépendance `alepha` résout
   sur le vendored. Commit dédié (convention : chaque sync = un commit).
5. Geler le job de deploy CF legacy.

Sortie : `alepha` importable partout, l'ancien stack tourne encore tel quel.

### Tranche 1 — Serveur/API (la grosse)

- `apps/main` bascule sur `alepha dev`/`alepha build`, adapter cloudflare.
- **Portage route par route** : l'app Alepha sert les assets et les `/api/*` en `$action` ;
  l'ancien `index.ts` maigrit à chaque route portée et meurt en fin de tranche.
- ORM : schéma re-créé en `$entity` zod. `users`/`identities`/`sessions` viennent de `$realm()` ;
  nos entités (hero, party, party_member, map, adventure, map_event*, hero_* enfants, état
  d'aventure) référencent `users.id`. Dev = SQLite auto-sync ; les migrations sqlite sont générées
  au premier deploy (tranche 4), pas avant.
- Auth : `$authCredentials` remplace register/login maison. L'ancien client `api.ts` est adapté aux
  nouvelles routes (adaptation temporaire, remplacée en tranche 2 par le client typé).
- **Le websocket ne bouge pas** : `/api/ws` + les DOs `World`/`GameSession`/`HeroPresence` actuels
  survivent à la tranche, co-hébergés dans l'app Alepha (handler monté à côté des `$action`).
  **Risque n°1 à lever en début de tranche** : vérifier qu'Alepha sait co-héberger une route WS
  maison + des DOs déclarés manuellement dans son build cloudflare. Sinon, repli : réordonner pour
  que l'admission WS reste sur l'ancien entry jusqu'à la tranche 3.
- Validation : les DOs legacy n'existant qu'en workerd, la tranche 1 se valide avec `wrangler dev`
  sur le build généré (`dist/wrangler.jsonc`). Le dev Node pur n'arrive qu'à la tranche 3.

### Tranche 2 — React (moyenne)

- Routing : `$page`, `ssr: false` à la racine (SPA pure). title → login → parties → jeu ; l'éditeur
  reste une route lazy (pas de cycle client→editor déclaré).
- `api.ts` → client typé `useClient()` sur nos contrôleurs. Login/register → `useAuth()`.
- zustand → atoms Alepha pour l'état applicatif (session, écran, party). **Le pont game→React**
  (la boucle de jeu écrit, React lit) garde son seam actuel ; il ne passe aux atoms que si un atom
  s'écrit proprement hors React — sinon zustand survit pour ce pont précis et seul lui
  (risque n°3, à vérifier tôt dans la tranche).
- i18n des écrans : optionnellement `$dictionary`/`useI18n()` d'Alepha. Les codes de jeu
  (EventCode → prose) restent dans `engine`. Si le portage i18n gonfle la tranche, il glisse en
  tranche optionnelle post-migration.
- Les deux arbres UI intouchés.

### Tranche 3 — Temps réel `$room` (la raison d'être)

- Un `$channel` typé remplace le wire de `protocol.ts` : `schema.in` = intents actuels,
  `schema.out` = welcome/delta/events/resync. Zod fait le parsing défensif structurel ; les caps
  applicatifs (frame 2 KiB, fenêtres de rate, budgets, cooldowns) restent chez nous.
- `World` → `$room` channel `world`, roomId `partyId:mapId`, `tickHz: 20`.
  - `state()` = room runtime actuel (players, monsters, loot, runs d'events…).
  - `onJoin` = admission : membership, ownership, lecture D1 de la carte/position — jamais un
    paramètre client.
  - `onTick(room, dt)` = l'ordre de tick existant ; les world-systems passent quasi tels quels.
  - `room.send(connectionId, …)` = AOI par destinataire ; `broadcast` pour le reste.
  - `onLeave` = save fencé + release de lease ; `onEmpty` = arrêt propre (le tick ne tourne que
    socket connecté — la facturation DO suit, comme aujourd'hui).
- `GameSession` → room **headless** (roomId `partyId`, `methods` : état d'aventure single-writer
  avec version monotone, chat party, victoire, annuaire des rooms). `HeroPresence` → room headless
  (roomId `heroId`, `methods` : lease/epoch/handoff). Appels croisés via `room.call(roomId,
  method, …)` — DO RPC sur CF, appel direct sur Node.
- **Le fencing epoch D1 ne change pas d'un iota** ; `persistence-system` est réutilisé.
- Handoff de carte : même chorégraphie (freeze → save → `handoff()` conditionnel → close →
  reconnexion sur le room destination), nouveaux tuyaux.
- Client : `net.ts` (sans React) utilise le `WebSocketClient` typé d'Alepha
  (`ws(s)://…<path>?room=<partyId:mapId>`). Prediction/reconcile intouchés. `useRoom()` n'est pas
  utilisé — c'est un hook React, la boucle de jeu n'en est pas.
- Sur CF : 1 Durable Object par `channel:roomId` (`AlephaWebSocketDurableObject`), hibernation +
  watchdog `alarm()` (~10 s) qui réhydrate et relance le loop après un reset d'isolate.

### Tranche 4 — Cleanup + deploy

- Meurent : l'ancien entry Worker, `wrangler.jsonc` manuel, `drizzle.config.ts`, `migrations/`
  legacy, `session.ts`/`accounts.ts`/`password.ts`, les seams rollback `character_*` /
  `CharacterPresence` / `profile.ts` (une base fraîche n'a rien à rollback).
- `alepha db migrations create` (baseline sqlite) puis `alepha platform up -e production` :
  D1 provisionnée, DO déclaré, migrations appliquées avant le code (l'adapter fait les deux).
- Loadtest porté sur la nouvelle URL WS (même discipline : intent légal uniquement, localhost par
  défaut). Smoke test playwright sur la prod fraîche.

## Gestion d'erreurs

- Frame WS invalide → rejet par le schéma zod du channel, socket inchangé (équivalent du
  `parseClientMessage` → drop actuel). Les fermetures typées (`PRESENCE_LOST`,
  `ZONE_TRANSITION`) sont conservées.
- Erreurs API → codes machine (mappés aux dictionnaires côté client), comme aujourd'hui — les
  `$action` renvoient des erreurs typées, jamais de prose.
- Save stale (epoch dépassé) → zéro ligne modifiée, diagnostic loggé, socket fermé
  `PRESENCE_LOST` — inchangé.
- Room DO perdu (reset isolate) → hibernation + `alarm()` réhydrate ; le client garde son
  resync borné (1/s) comme filet.

## Tests

- `engine` : suite intouchée — elle continue de pinner prediction parity, les deux vitesses
  (vivant/fantôme), death, brushes, i18n parity.
- Serveur : les tests workerd (vrais DOs) sont remplacés par des tests **RoomEngine sur Node**
  (`Alepha.create()` + SQLite + service substitution, jamais `vi.mock`). Invariants à re-pinner en
  priorité : one-command-per-tick + ack, epoch fencing (save stale = zéro ligne), AOI/loot
  personnel, guard-kill-sans-reward, budget interpréteur (borné, jamais un hang), lock
  un-run-par-event (deux triggers même tick → un seul grant).
- CF-spécifique (hibernation, alarm, D1) : passe `wrangler dev` sur le build généré, manuelle puis
  CI si besoin.
- Client/editor : suites jsdom existantes, adaptées aux nouveaux seams (client typé, atoms).

## Risques et dérisquage

1. **Co-hébergement legacy WS en tranche 1** — à vérifier en tout début de tranche 1 ; repli :
   l'admission WS reste sur l'ancien entry jusqu'à la tranche 3.
2. **Hibernation DO + tick loop** — le watchdog `alarm()` d'Alepha est jeune ; lindocara est son
   premier vrai client. Dogfooding assumé : patch dans `.vendor/`, `alepha vendor diff` pour tracer,
   upstream dans `../alepha`, re-sync.
3. **Atoms hors React** pour le pont game→React — à vérifier tôt en tranche 2 ; repli : zustand
   survit pour ce pont uniquement.
4. **D1 sans transactions multi-statements** — déjà le cas aujourd'hui ; les batches fencés
   existants restent le modèle.

## Workflow vendor (dogfooding)

- Patch local dans `.vendor/alepha` quand lindocara est bloqué → `alepha vendor diff` liste les
  patches portés → PR/commit équivalent dans `../alepha` → `alepha vendor sync` (ou `--force` si le
  patch est upstreamé tel quel). Chaque sync est un commit dédié.
- `alepha` reste sur `main` upstream — pas de branche de framework dédiée à lindocara.
