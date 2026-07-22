/**
 * The Warcraft-III-style main menu: a central ornate panel over full-screen art, driven by the
 * MenuNav focus model so it is fully playable on a controller (D-pad to move, A to select). The
 * editor is a deliberately discreet corner button, kept out of the controller path.
 */
import { type ReactNode, useEffect, useState } from "react";
import { fetchParties } from "../api.js";
import { t } from "../i18n.js";
import { useUiStore } from "../store.js";
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
  const setScreen = useUiStore((s) => s.setScreen);
  const setSettingsOpen = useUiStore((s) => s.setSettingsOpen);
  // "Continue" is hidden until we know the account has at least one save — no dead entry that
  // opens onto an empty carousel. Ordering leaves a gap at 0 when hidden; MenuNav sorts by order,
  // so the remaining items still focus correctly.
  const [hasSaves, setHasSaves] = useState(false);

  useEffect(() => {
    void fetchParties()
      .then((all) => setHasSaves(all.some((p) => p.mine)))
      .catch(() => setHasSaves(false));
  }, []);

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
        onBack={() => setScreen("title")}
      >
        {hasSaves && (
          <MenuItemButton
            order={0}
            icon="▶"
            label={t("menu.continue")}
            onActivate={() => setScreen("continue")}
          />
        )}
        <MenuItemButton
          order={1}
          icon="⚔"
          label={t("menu.new")}
          onActivate={() => setScreen("new")}
        />
        <MenuItemButton
          order={2}
          icon="⚑"
          label={t("menu.join")}
          onActivate={() => setScreen("join")}
        />
        <MenuItemButton
          order={3}
          icon="⚙"
          label={t("menu.options")}
          onActivate={() => setSettingsOpen(true)}
        />
        <MenuItemButton
          order={4}
          icon="⎋"
          label={t("menu.quit")}
          onActivate={() => setScreen("title")}
        />
      </MenuNav>

      <button
        type="button"
        className="main-menu__editor"
        onClick={() => setScreen("adventure-editor")}
      >
        {t("menu.editor")}
      </button>

      <MenuHints>
        <Hint keyLabel="↕ / D-Pad">{t("menu.hint.navigate")}</Hint>
        <Hint keyLabel="A / Enter">{t("menu.hint.select")}</Hint>
        <Hint keyLabel="B / Esc">{t("menu.quit")}</Hint>
      </MenuHints>
    </main>
  );
}

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
