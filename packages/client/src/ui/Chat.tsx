import { useEffect, useRef, useState } from "react";

import { TinyInput } from "@/ui/tiny-swords/TinyInput.js";
import { TinyKbd } from "@/ui/tiny-swords/TinyKbd.js";

import { currentLocale, t, useLocale } from "../i18n.js";
import { type ChatLine, useUiStore } from "../store.js";

const CHAT_SIZE_STORAGE_KEY = "lindocara.chat.size.v2";
const LEGACY_CHAT_SIZE_STORAGE_KEY = "lindocara.chat.size.v1";
const CHAT_FILTER_STORAGE_KEY = "lindocara.chat.filter";
const CHAT_TIMESTAMPS_STORAGE_KEY = "lindocara.chat.timestamps";
const DEFAULT_CHAT_WIDTH_PX = 504;
const DEFAULT_CHAT_HEIGHT_PX = 210;
const MIN_CHAT_WIDTH_PX = 360;
const MIN_CHAT_HEIGHT_PX = 180;
const MAX_CHAT_WIDTH_PX = 1040;
const MAX_CHAT_HEIGHT_PX = 600;
const SCROLL_PIN_THRESHOLD_PX = 20;
const MAX_COMMAND_HISTORY = 30;
const CHAT_FILTERS = ["local", "party", "system"] as const;

type ChatFilter = (typeof CHAT_FILTERS)[number];

interface ChatSize {
  width: number;
  height: number;
}

function readStoredChatFilter(): ChatFilter {
  try {
    const raw = localStorage.getItem(CHAT_FILTER_STORAGE_KEY);
    if (raw === "local" || raw === "party" || raw === "system") return raw;
  } catch {
    // Ignore storage failures in private browsing or locked-down environments.
  }
  return "local";
}

function matchesChatFilter(line: ChatLine, filter: ChatFilter): boolean {
  const channel = line.channel ?? "local";
  if (filter === "system") return channel === "system";
  if (filter === "party") return channel === "party";
  return channel === "local";
}

function rememberCommand(history: string[], command: string): string[] {
  const trimmed = command.trim();
  if (trimmed === "") return history;
  if (history.at(-1) === trimmed) return history;
  return [...history, trimmed].slice(-MAX_COMMAND_HISTORY);
}

function clampChatSize(size: ChatSize): ChatSize {
  const viewportWidth = typeof window === "undefined" ? MAX_CHAT_WIDTH_PX : window.innerWidth - 24;
  const viewportHeight =
    typeof window === "undefined" ? MAX_CHAT_HEIGHT_PX : window.innerHeight - 160;
  const maxWidth = Math.min(MAX_CHAT_WIDTH_PX, Math.max(280, viewportWidth));
  const maxHeight = Math.min(MAX_CHAT_HEIGHT_PX, Math.max(160, viewportHeight));
  const minWidth = Math.min(MIN_CHAT_WIDTH_PX, maxWidth);
  const minHeight = Math.min(MIN_CHAT_HEIGHT_PX, maxHeight);
  return {
    width: Math.min(maxWidth, Math.max(minWidth, size.width)),
    height: Math.min(maxHeight, Math.max(minHeight, size.height)),
  };
}

function parseStoredChatSize(raw: string | null): ChatSize | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("width" in parsed) ||
    !("height" in parsed) ||
    typeof parsed.width !== "number" ||
    typeof parsed.height !== "number" ||
    !Number.isFinite(parsed.width) ||
    !Number.isFinite(parsed.height)
  ) {
    return null;
  }
  return { width: parsed.width, height: parsed.height };
}

function readStoredChatSize(): ChatSize {
  const fallback = clampChatSize({ width: DEFAULT_CHAT_WIDTH_PX, height: DEFAULT_CHAT_HEIGHT_PX });
  try {
    const current = parseStoredChatSize(localStorage.getItem(CHAT_SIZE_STORAGE_KEY));
    if (current) return clampChatSize(current);
    const legacy = parseStoredChatSize(localStorage.getItem(LEGACY_CHAT_SIZE_STORAGE_KEY));
    if (legacy) {
      return clampChatSize({ width: legacy.width * 0.7, height: legacy.height * 0.7 });
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function isNearBottom(element: HTMLElement): boolean {
  return element.scrollHeight - element.scrollTop - element.clientHeight <= SCROLL_PIN_THRESHOLD_PX;
}

function readShowTimestamps(): boolean {
  try {
    const raw = localStorage.getItem(CHAT_TIMESTAMPS_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    // Ignore storage failures in private browsing or locked-down environments.
  }
  return true;
}

function formatChatTime(at: number): string {
  const locale = currentLocale() === "fr" ? "fr-FR" : "en-GB";
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(
    new Date(at),
  );
}

function lineClassName(line: ChatLine): string {
  const channel = line.channel ?? "local";
  if (channel === "system") {
    return `chat-line chat-line-system chat-tone-${line.tone ?? "info"}`;
  }
  return `chat-line chat-line-${channel}`;
}

export function Chat() {
  useLocale();
  const chat = useUiStore((s) => s.chat);
  const party = useUiStore((s) => s.party);
  const game = useUiStore((s) => s.game);
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);
  const [chatSize, setChatSize] = useState(readStoredChatSize);
  const [jumpToBottom, setJumpToBottom] = useState(false);
  const [pendingBelow, setPendingBelow] = useState(0);
  const [filter, setFilter] = useState<ChatFilter>(readStoredChatFilter);
  const [showTimestamps, setShowTimestamps] = useState(readShowTimestamps);
  const inputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const chatSizeRef = useRef(chatSize);
  const resizeRef = useRef<{
    startX: number;
    startY: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);
  const commandHistoryRef = useRef<string[]>([]);
  const commandHistoryIndexRef = useRef<number | null>(null);
  const commandDraftRef = useRef("");
  const filterRef = useRef(filter);

  chatSizeRef.current = chatSize;
  filterRef.current = filter;

  const visibleChat = chat.filter((line) => matchesChatFilter(line, filter));
  const availableFilters = party ? CHAT_FILTERS : CHAT_FILTERS.filter((entry) => entry !== "party");

  useEffect(() => {
    // Zustand's raw `subscribe` (not the `useUiStore(selector)` hook) fires its listener
    // synchronously on `setState`, and never for the value already current at subscribe
    // time — which is exactly "skip the initial chatFocusRequest, only focus when it changes
    // after mount" for free, and keeps the focus in the same tick as requestChatFocus().
    return useUiStore.subscribe((state, prevState) => {
      if (state.chatFocusRequest !== prevState.chatFocusRequest) inputRef.current?.focus();
    });
  }, []);

  useEffect(() => {
    return useUiStore.subscribe((state, prevState) => {
      if (state.chat === prevState.chat) return;
      const element = messagesRef.current;
      if (!element) return;
      const latest = state.chat.at(-1);
      const previous = prevState.chat.at(-1);
      const isNewLine = latest !== undefined && latest.id !== previous?.id;
      const visible =
        isNewLine && latest !== undefined && matchesChatFilter(latest, filterRef.current);
      if (stickToBottomRef.current) {
        element.scrollTop = element.scrollHeight;
        setJumpToBottom(false);
        setPendingBelow(0);
        return;
      }
      if (visible) setPendingBelow((count) => count + 1);
      if (visible || state.chat.length > 0) setJumpToBottom(true);
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const element = messagesRef.current;
    if (!element) return;
    stickToBottomRef.current = true;
    element.scrollTop = element.scrollHeight;
    setJumpToBottom(false);
    setPendingBelow(0);
  }, [open]);

  useEffect(() => {
    if (party !== null || filter !== "party") return;
    setFilter("local");
    try {
      localStorage.setItem(CHAT_FILTER_STORAGE_KEY, "local");
    } catch {
      // Ignore storage failures in private browsing or locked-down environments.
    }
    queueMicrotask(() => {
      requestAnimationFrame(() => {
        const element = messagesRef.current;
        if (!element) return;
        stickToBottomRef.current = true;
        element.scrollTop = element.scrollHeight;
        setJumpToBottom(false);
        setPendingBelow(0);
      });
    });
  }, [party, filter]);

  useEffect(() => {
    const fitToViewport = () => setChatSize((current) => clampChatSize(current));
    window.addEventListener("resize", fitToViewport);
    return () => window.removeEventListener("resize", fitToViewport);
  }, []);

  function handleMessagesScroll(): void {
    const element = messagesRef.current;
    if (!element) return;
    const pinned = isNearBottom(element);
    stickToBottomRef.current = pinned;
    if (pinned) {
      setJumpToBottom(false);
      setPendingBelow(0);
      return;
    }
    if (visibleChat.length > 0) setJumpToBottom(true);
  }

  function selectFilter(next: ChatFilter): void {
    setFilter(next);
    try {
      localStorage.setItem(CHAT_FILTER_STORAGE_KEY, next);
    } catch {
      // Ignore storage failures in private browsing or locked-down environments.
    }
    queueMicrotask(() => {
      requestAnimationFrame(() => scrollToLatest());
    });
  }

  function scrollToLatest(): void {
    const element = messagesRef.current;
    if (!element) return;
    stickToBottomRef.current = true;
    element.scrollTop = element.scrollHeight;
    setJumpToBottom(false);
    setPendingBelow(0);
  }

  function persistChatSize(size: ChatSize): void {
    try {
      localStorage.setItem(CHAT_SIZE_STORAGE_KEY, JSON.stringify(size));
    } catch {
      // Ignore storage failures in private browsing or locked-down environments.
    }
  }

  function startResize(event: React.PointerEvent<HTMLButtonElement>): void {
    event.preventDefault();
    resizeRef.current = {
      startX: event.clientX,
      startY: event.clientY,
      startWidth: chatSize.width,
      startHeight: chatSize.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!resizeRef.current) return;
    const width = resizeRef.current.startWidth + event.clientX - resizeRef.current.startX;
    const height = resizeRef.current.startHeight + resizeRef.current.startY - event.clientY;
    setChatSize(clampChatSize({ width, height }));
  }

  function endResize(event: React.PointerEvent<HTMLButtonElement>): void {
    if (!resizeRef.current) return;
    resizeRef.current = null;
    persistChatSize(chatSizeRef.current);
    event.currentTarget.releasePointerCapture(event.pointerId);
    scrollToLatest();
  }

  function resetCommandNavigation(): void {
    commandHistoryIndexRef.current = null;
    commandDraftRef.current = "";
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const history = commandHistoryRef.current;
      if (history.length === 0) return;
      if (commandHistoryIndexRef.current === null) {
        commandDraftRef.current = value;
        commandHistoryIndexRef.current = history.length - 1;
      } else if (commandHistoryIndexRef.current > 0) {
        commandHistoryIndexRef.current -= 1;
      }
      const index = commandHistoryIndexRef.current;
      if (index === null) return;
      setValue(history[index] ?? "");
      return;
    }
    if (event.key !== "ArrowDown") return;
    event.preventDefault();
    const history = commandHistoryRef.current;
    if (commandHistoryIndexRef.current === null) return;
    if (commandHistoryIndexRef.current < history.length - 1) {
      commandHistoryIndexRef.current += 1;
      setValue(history[commandHistoryIndexRef.current] ?? "");
      return;
    }
    resetCommandNavigation();
    setValue(commandDraftRef.current);
  }

  function handleInputChange(event: React.ChangeEvent<HTMLInputElement>): void {
    const next = event.target.value;
    if (commandHistoryIndexRef.current !== null) resetCommandNavigation();
    setValue(next);
  }

  function toggleTimestamps(): void {
    setShowTimestamps((current) => {
      const next = !current;
      try {
        localStorage.setItem(CHAT_TIMESTAMPS_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // Ignore storage failures in private browsing or locked-down environments.
      }
      return next;
    });
  }

  function submit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const trimmed = value.trim();
    if (trimmed === "/party") game?.partyCreate?.();
    else if (trimmed === "/leave") game?.partyLeave?.();
    else if (trimmed === "/disband") game?.partyDissolve?.();
    else if (trimmed.startsWith("/invite ")) game?.partyInvite?.(trimmed.slice(8).trim());
    else if (trimmed.startsWith("/kick ")) game?.partyKick?.(trimmed.slice(6).trim());
    else if (trimmed.startsWith("/p ")) game?.sendChat(trimmed.slice(3).trim(), "party");
    else if (trimmed) game?.sendChat(trimmed);
    if (trimmed) {
      commandHistoryRef.current = rememberCommand(commandHistoryRef.current, trimmed);
    }
    resetCommandNavigation();
    setValue("");
    inputRef.current?.blur();
  }

  const className = `panel${visibleChat.length > 0 ? " has-chat" : ""}${open ? " chat-open" : ""}`;
  const chatStyle = {
    "--chat-width": `${chatSize.width}px`,
    "--chat-messages-height": `${chatSize.height}px`,
  } as React.CSSProperties;

  const jumpLabel =
    pendingBelow > 0 ? t("chat.newMessages", { count: pendingBelow }) : t("chat.jumpToBottom");

  return (
    <section id="chat" className={className} style={chatStyle}>
      {open && (
        <button
          type="button"
          className="chat-resize-handle"
          aria-label={t("chat.resize")}
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={endResize}
          onPointerCancel={endResize}
        />
      )}
      <div className="chat-title">
        <span>{t("chat.title")}</span>
        {open && (
          <div className="chat-title-actions">
            <button
              type="button"
              className={`chat-time-toggle${showTimestamps ? " chat-time-toggle-active" : ""}`}
              aria-label={t("chat.toggleTimestamps")}
              aria-pressed={showTimestamps}
              onMouseDown={(event) => event.preventDefault()}
              onClick={toggleTimestamps}
            >
              {t("chat.timestamps")}
            </button>
            <TinyKbd>Enter</TinyKbd>
          </div>
        )}
      </div>
      {open && (
        <div className="chat-filters" role="tablist" aria-label={t("chat.title")}>
          {availableFilters.map((entry) => (
            <button
              key={entry}
              type="button"
              role="tab"
              aria-selected={filter === entry}
              className={`chat-filter${filter === entry ? " chat-filter-active" : ""}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => selectFilter(entry)}
            >
              {t(`chat.filter.${entry}`)}
            </button>
          ))}
        </div>
      )}
      <div className="chat-messages-shell">
        <div
          id="chat-messages"
          ref={messagesRef}
          onScroll={handleMessagesScroll}
          aria-live="polite"
        >
          <div className="chat-messages-log">
            {visibleChat.map((line) => (
              <div key={line.id} className={lineClassName(line)}>
                {showTimestamps && (
                  <time className="chat-time" dateTime={new Date(line.at).toISOString()}>
                    {formatChatTime(line.at)}
                  </time>
                )}
                {line.channel === "party" && (
                  <span className="chat-channel">[{t("chat.party")}]</span>
                )}
                {line.channel === "system" && (
                  <span className="chat-channel">[{t("chat.system")}]</span>
                )}
                {line.channel !== "system" && <span className="name">{line.from}:</span>}
                <span className="chat-text">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
        {jumpToBottom && open && (
          <button
            type="button"
            className="chat-jump-bottom"
            aria-label={t("chat.jumpToBottom")}
            onClick={scrollToLatest}
          >
            {jumpLabel}
          </button>
        )}
      </div>
      <form id="chat-form" onSubmit={submit}>
        <TinyInput
          id="chat-input"
          ref={inputRef}
          value={value}
          onChange={handleInputChange}
          onKeyDown={handleInputKeyDown}
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
