/**
 * The Warcraft-III-style main menu: a central ornate panel over full-screen art, driven by the
 * MenuNav focus model so it is fully playable on a controller (D-pad to move, A to select). The
 * editor is a deliberately discreet corner button, kept out of the controller path.
 */
import { useStore } from "alepha/react";
import { useAuth } from "alepha/react/auth";
import { useRouter } from "alepha/react/router";
import { useEffect, useState } from "react";
import { fetchParties } from "../api.js";
import {
  getAudioSettings,
  setAudioSettings,
  subscribeAudioSettings,
} from "../game/audio-settings.js";
import { t } from "../i18n.js";
import { adventureEditorSessionAtom } from "../state/atoms.js";
import { getGameNavigation } from "../state/navigation.js";
import { useUiStore } from "../store.js";
import type { AppRouter } from "./AppRouter.js";
import { Hint, MenuHints } from "./MenuHints.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";
import { MenuNav, useMenuItem } from "./tiny-swords/menu-nav.js";

function MenuItemButton({
  label,
  icon,
  order,
  onActivate,
}: {
  label: string;
  icon: string;
  order: number;
  onActivate: () => void;
}) {
  const { focused, ref, itemProps } = useMenuItem({ onActivate, order });
  return (
    <button
      ref={ref}
      type="button"
      className={`menu-button${focused ? " menu-button--focused" : ""}`}
      {...itemProps}
    >
      <span className="menu-button__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="menu-button__label">{label}</span>
    </button>
  );
}

export function MainMenu() {
  const router = useRouter<AppRouter>();
  const [, setEditorSession] = useStore(adventureEditorSessionAtom);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // UI affordance only, per the ruling in `.superpowers/sdd/2026-08-11-admin-console-and-logout/
  // task-3-brief.md`: hiding the button is not a fence — `/admin` stays reachable by URL and the
  // server's `$secure` guard is what actually refuses a non-admin session.
  const isAdmin = useAuth().has("admin:*");
  // "Continue" is hidden until we know the account has at least one save — no dead entry that
  // opens onto an empty carousel. Ordering leaves a gap at 0 when hidden; MenuNav sorts by order,
  // so the remaining items still focus correctly.
  const [hasSaves, setHasSaves] = useState(false);
  // Mirror the persisted music flag so the corner toggle stays in sync with the settings menu too.
  const [musicOn, setMusicOn] = useState(() => getAudioSettings().musicEnabled);

  useEffect(() => {
    void fetchParties()
      .then((all) => setHasSaves(all.some((p) => p.mine)))
      .catch(() => setHasSaves(false));
  }, []);

  useEffect(() => subscribeAudioSettings(() => setMusicOn(getAudioSettings().musicEnabled)), []);

  return (
    <main className="main-menu">
      {/* Reuse the login screen's illustrated backdrop, a courtyard variant for the settled menu. */}
      <TinySwordsMenuScene variant="courtyard" />
      <div className="main-menu__brand">
        <h1 className="main-menu__logo">Lindocara</h1>
      </div>

      <MenuNav
        orientation="vertical"
        className="main-menu__panel"
        aria-label={t("menu.title")}
        onBack={() => void router.push("title")}
      >
        {hasSaves && (
          <MenuItemButton
            order={0}
            icon="▶"
            label={t("menu.continue")}
            onActivate={() => void router.push("playContinue")}
          />
        )}
        <MenuItemButton
          order={1}
          icon="⚔"
          label={t("menu.new")}
          onActivate={() => void router.push("playNew")}
        />
        <MenuItemButton
          order={2}
          icon="⚑"
          label={t("menu.join")}
          onActivate={() => void router.push("playJoin")}
        />
        <MenuItemButton
          order={3}
          icon="⚙"
          label={t("menu.options")}
          onActivate={() => setSettingsOpen(true)}
        />
        <MenuItemButton
          order={4}
          icon="✎"
          label={t("menu.credits")}
          onActivate={() => void router.push("credits")}
        />
        <MenuItemButton
          order={5}
          icon="⎋"
          label={t("menu.quit")}
          // Goes through the navigation seam, not `useAuth().logout()` directly — see
          // `state/navigation.ts`'s docblock: it is the seam a test installs a plain fake into by
          // reassignment, which is what keeps this covered without `vi.mock`. `onBack` below stays
          // on `router.push("title")`: it shares a key (Escape / gamepad B) with this button, and a
          // stray Escape on the main menu must never sign the player out.
          onActivate={() => getGameNavigation()?.logout()}
        />
      </MenuNav>

      <div className="main-menu__corner main-menu__corner--left">
        <button
          type="button"
          className="main-menu__editor"
          onClick={() => {
            setEditorSession(null);
            void router.push("editor");
          }}
        >
          {t("menu.editor")}
        </button>

        {isAdmin && (
          <button
            type="button"
            className="main-menu__admin"
            onClick={() => void router.push("admin")}
          >
            {t("menu.admin")}
          </button>
        )}
      </div>

      <button
        type="button"
        className="main-menu__music"
        aria-pressed={musicOn}
        aria-label={t(musicOn ? "menu.music.on" : "menu.music.off")}
        title={t(musicOn ? "menu.music.on" : "menu.music.off")}
        data-off={musicOn ? undefined : ""}
        onClick={() => setAudioSettings({ musicEnabled: !musicOn })}
      >
        <span className="main-menu__music-icon" aria-hidden="true">
          ♪
        </span>
      </button>

      <MenuHints>
        <Hint keyLabel="↕ / D-Pad">{t("menu.hint.navigate")}</Hint>
        <Hint keyLabel="A / Enter">{t("menu.hint.select")}</Hint>
        {/* Labels the Escape/B key, which still just goes back to the title screen — it must not
            claim to quit now that the QUIT button itself logs out. */}
        <Hint keyLabel="B / Esc">{t("menu.hint.back")}</Hint>
      </MenuHints>
    </main>
  );
}
