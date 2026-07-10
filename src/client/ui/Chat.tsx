import { useEffect, useRef, useState } from "react";
import { Input } from "@/ui/pixelact-ui/input.js";
import { Kbd } from "@/ui/pixelact-ui/kbd.js";
import { t, useLocale } from "../i18n.js";
import { useUiStore } from "../store.js";

export function Chat() {
  useLocale();
  const chat = useUiStore((s) => s.chat);
  const game = useUiStore((s) => s.game);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Zustand's raw `subscribe` (not the `useUiStore(selector)` hook) fires its listener
    // synchronously on `setState`, and never for the value already current at subscribe
    // time — which is exactly "skip the initial chatFocusRequest, only focus when it changes
    // after mount" for free, and keeps the focus in the same tick as requestChatFocus().
    return useUiStore.subscribe((state, prevState) => {
      if (state.chatFocusRequest !== prevState.chatFocusRequest) inputRef.current?.focus();
    });
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed) game?.sendChat(trimmed);
    setValue("");
    inputRef.current?.blur();
  }

  const className = `panel${chat.length > 0 ? " has-chat" : ""}${open ? " chat-open" : ""}`;

  return (
    <section id="chat" className={className}>
      <div className="chat-title">
        <span>{t("chat.title")}</span>
        <Kbd>Enter</Kbd>
      </div>
      <div id="chat-messages" aria-live="polite">
        {chat.map((line) => (
          <div key={line.id}>
            <span className="name">{line.from}: </span>
            {line.text}
          </div>
        ))}
      </div>
      <form id="chat-form" onSubmit={submit}>
        <Input
          id="chat-input"
          ref={inputRef}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          maxLength={160}
          autoComplete="off"
          placeholder={t("chat.placeholder")}
        />
      </form>
    </section>
  );
}
