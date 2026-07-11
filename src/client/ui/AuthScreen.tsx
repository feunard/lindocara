import { useState } from "react";
import { Button } from "@/ui/pixelact-ui/button/index.js";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Label } from "@/ui/pixelact-ui/label.js";
import { api, authErrorText, errorCode, type Me } from "../api.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";
import { Tabs } from "./Tabs.js";

type Tab = "login" | "register";

export function AuthScreen() {
  useLocale();
  const setScreen = useUiStore((s) => s.setScreen);
  const [tab, setTab] = useState<Tab>("login");
  const [error, setError] = useState<string | null>(null); // machine code, not text
  const [busy, setBusy] = useState(false);

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
      setScreen("characters");
    } catch (caught) {
      setError(errorCode(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-shell">
      <div className="auth-panel framed parchment flex flex-col gap-4 p-6">
        <span className="eyebrow">{t("auth.eyebrow")}</span>
        <h1>lindocara</h1>
        <h2>{t("auth.subtitle")}</h2>
        <p>{t("auth.tagline")}</p>
        <Tabs
          tabs={[
            { id: "login", label: t("auth.tab.login") },
            { id: "register", label: t("auth.tab.register") },
          ]}
          active={tab}
          onSelect={(id) => {
            setTab(id as Tab);
            setError(null);
          }}
        />
        <form key={tab} onSubmit={submit} className="flex flex-col gap-3">
          <div>
            <Label htmlFor="auth-username">{t("auth.username")}</Label>
            <Input
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
          <div>
            <Label htmlFor="auth-password">{t("auth.password")}</Label>
            <Input
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
            <div>
              <Label htmlFor="auth-confirm">{t("auth.password_confirm")}</Label>
              <Input
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
          <Button type="submit" disabled={busy}>
            {t(tab === "login" ? "auth.submit.login" : "auth.submit.register")}
          </Button>
          {error && <p role="alert">{authErrorText(error)}</p>}
        </form>
      </div>
    </main>
  );
}
