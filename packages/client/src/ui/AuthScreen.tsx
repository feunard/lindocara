import { useState } from "react";
import { TinyButton } from "@/ui/tiny-swords/TinyButton.js";
import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyLabel } from "@/ui/tiny-swords/TinyLabel.js";
import { api, authErrorText, errorCode, type Me } from "../api.js";
import { continueAsGuest } from "../guest.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { TinySwordsMenuScene } from "./TinySwordsMenuScene.js";

type Tab = "login" | "register";

export function AuthScreen() {
  useLocale();
  const setScreen = useUiStore((s) => s.setScreen);
  const [tab, setTab] = useState<Tab>("login");
  const [error, setError] = useState<string | null>(null); // machine code, not text
  const [busy, setBusy] = useState(false);

  async function guest() {
    setError(null);
    setBusy(true);
    try {
      await continueAsGuest();
      setScreen("parties");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const data = new FormData(event.currentTarget);
    if (tab === "register" && data.get("password") !== data.get("confirm")) {
      setError("password_mismatch");
      return;
    }
    setBusy(true);
    try {
      await api<Me>(tab === "login" ? "/api/session" : "/api/register", {
        method: "POST",
        body: JSON.stringify({ username: data.get("username"), password: data.get("password") }),
      });
      setScreen("parties");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell" data-busy={busy || undefined}>
      <TinySwordsMenuScene variant="gate" />
      <div className="auth-layout">
        <header className="auth-intro">
          <span className="eyebrow">{t("auth.eyebrow")}</span>
          <h1>lindocara</h1>
          <h2>{t("auth.subtitle")}</h2>
          <p>{t("auth.tagline")}</p>
          <span className="auth-intro__rule" aria-hidden="true" />
        </header>

        <section className="auth-panel">
          <h2 className="auth-panel__title">
            {t(tab === "login" ? "auth.tab.login" : "auth.tab.register")}
          </h2>
          <form key={tab} onSubmit={submit} className="auth-form flex flex-col gap-3">
            <div className="auth-field">
              <TinyLabel htmlFor="auth-username">{t("auth.username")}</TinyLabel>
              <TinyInput
                id="auth-username"
                name="username"
                type="text"
                minLength={2}
                maxLength={16}
                pattern="[A-Za-z0-9_\-]{2,16}"
                autoComplete="username"
                required
              />
            </div>
            <div className="auth-field">
              <TinyLabel htmlFor="auth-password">{t("auth.password")}</TinyLabel>
              <TinyInput
                id="auth-password"
                name="password"
                type="password"
                minLength={8}
                maxLength={128}
                autoComplete={tab === "login" ? "current-password" : "new-password"}
                required
              />
            </div>
            {tab === "register" && (
              <div className="auth-field">
                <TinyLabel htmlFor="auth-confirm">{t("auth.password_confirm")}</TinyLabel>
                <TinyInput
                  id="auth-confirm"
                  name="confirm"
                  type="password"
                  minLength={8}
                  maxLength={128}
                  autoComplete="new-password"
                  required
                />
              </div>
            )}
            <TinyButton type="submit" disabled={busy}>
              {t(tab === "login" ? "auth.submit.login" : "auth.submit.register")}
            </TinyButton>
            {error && <p role="alert">{authErrorText(error)}</p>}
          </form>

          <div className="auth-alternatives">
            <button type="button" className="auth-link" onClick={guest} disabled={busy}>
              {t("auth.guest")}
            </button>
            <p className="auth-hint">{t("auth.guest.hint")}</p>
            <button
              type="button"
              className="auth-link auth-link--switch"
              onClick={() => {
                setTab(tab === "login" ? "register" : "login");
                setError(null);
              }}
            >
              {t(tab === "login" ? "auth.switch.to_register" : "auth.switch.to_login")}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
