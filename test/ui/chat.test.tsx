import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "../../src/client/i18n.js";
import { useUiStore } from "../../src/client/store.js";
import { Chat } from "../../src/client/ui/Chat.js";

describe("Chat", () => {
  beforeEach(() => setLocale("en"));

  it("renders lines and sends trimmed input through the game handle", async () => {
    const sendChat = vi.fn();
    useUiStore.setState({
      chat: [{ id: 1, from: "alice", text: "hello", at: 1_700_000_000_000 }],
      game: {
        attack: vi.fn(),
        interact: vi.fn(),
        usePotion: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        sendChat,
        switchCharacter: vi.fn(),
        logout: vi.fn(),
        attachMinimap: vi.fn(),
        attachWorldMap: vi.fn(),
      },
    });
    render(<Chat />);
    expect(screen.getByText("hello")).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox"), "  hi there  {Enter}");
    expect(sendChat).toHaveBeenCalledWith("hi there");
    expect(screen.getByRole("textbox")).toHaveValue("");
  });

  it("focuses the input when the store requests it", () => {
    useUiStore.setState({ chat: [], chatFocusRequest: 0 });
    render(<Chat />);
    useUiStore.getState().requestChatFocus();
    expect(screen.getByRole("textbox")).toHaveFocus();
  });

  it("keeps older lines in the log and exposes a resize handle while open", async () => {
    useUiStore.setState({
      chat: Array.from({ length: 20 }, (_, index) => ({
        id: index,
        from: "alice",
        text: `line ${index}`,
        at: index,
      })),
      game: null,
    });
    render(<Chat />);
    expect(screen.getByText("line 0")).toBeInTheDocument();
    expect(screen.getByText("line 19")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Resize chat" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("textbox"));
    expect(screen.getByRole("button", { name: "Resize chat" })).toBeInTheDocument();
  });

  it("shows a jump control after scrolling up and receiving new lines", async () => {
    useUiStore.setState({
      chat: Array.from({ length: 7 }, (_, index) => ({
        id: index + 1,
        from: "alice",
        text: `line ${index}`,
        at: index,
      })),
      game: null,
    });
    render(<Chat />);
    const messages = document.getElementById("chat-messages");
    if (!messages) throw new Error("expected chat messages container");

    Object.defineProperty(messages, "scrollHeight", { value: 400, configurable: true });
    Object.defineProperty(messages, "clientHeight", { value: 80, configurable: true });
    messages.scrollTop = 0;
    fireEvent.scroll(messages);

    useUiStore.getState().addChat("bob", "fresh news");
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Jump to latest" })).toHaveTextContent("1 new");
    });
  });

  it("recalls previous submissions with the arrow keys", async () => {
    const sendChat = vi.fn();
    const partyCreate = vi.fn();
    useUiStore.setState({
      chat: [],
      game: {
        attack: vi.fn(),
        interact: vi.fn(),
        usePotion: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        sendChat,
        partyCreate,
        switchCharacter: vi.fn(),
        logout: vi.fn(),
        attachMinimap: vi.fn(),
        attachWorldMap: vi.fn(),
      },
    });
    render(<Chat />);
    const input = screen.getByRole("textbox");

    await userEvent.type(input, "/party{Enter}");
    expect(partyCreate).toHaveBeenCalled();
    await userEvent.type(input, "hello there{Enter}");
    expect(sendChat).toHaveBeenCalledWith("hello there");

    await userEvent.click(input);
    await userEvent.keyboard("{ArrowUp}");
    expect(input).toHaveValue("hello there");
    await userEvent.keyboard("{ArrowUp}");
    expect(input).toHaveValue("/party");
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveValue("hello there");
    await userEvent.keyboard("{ArrowDown}");
    expect(input).toHaveValue("");
  });

  it("filters visible lines by channel tabs", async () => {
    useUiStore.setState({
      chat: [
        { id: 1, from: "alice", text: "nearby", channel: "local", at: 1 },
        { id: 2, from: "bob", text: "group plan", channel: "party", at: 2 },
        { id: 3, from: "", text: "quest updated", channel: "system", tone: "good", at: 3 },
      ],
      party: {
        id: "party-1",
        leaderId: "hero",
        members: [{ id: "hero", nick: "Hero", hp: 100, maxHp: 100, life: "alive" }],
      },
      game: null,
    });
    render(<Chat />);
    await userEvent.click(screen.getByRole("textbox"));

    expect(screen.getByText("nearby")).toBeInTheDocument();
    expect(screen.queryByText("group plan")).not.toBeInTheDocument();
    expect(screen.queryByText("quest updated")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "Party" }));
    expect(screen.getByText("group plan")).toBeInTheDocument();
    expect(screen.queryByText("nearby")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "System" }));
    expect(screen.getByText("quest updated")).toBeInTheDocument();
    expect(screen.queryByText("nearby")).not.toBeInTheDocument();
  });

  it("hides the party filter until the player joins a group", async () => {
    useUiStore.setState({ chat: [], party: null, game: null });
    render(<Chat />);
    await userEvent.click(screen.getByRole("textbox"));
    expect(screen.queryByRole("tab", { name: "Party" })).not.toBeInTheDocument();

    useUiStore.setState({
      party: {
        id: "party-1",
        leaderId: "hero",
        members: [{ id: "hero", nick: "Hero", hp: 100, maxHp: 100, life: "alive" }],
      },
    });
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Party" })).toBeInTheDocument();
    });
  });

  it("shows optional timestamps and channel colors when enabled", async () => {
    useUiStore.setState({
      chat: [
        {
          id: 1,
          from: "alice",
          text: "nearby",
          channel: "local",
          at: Date.UTC(2026, 6, 13, 14, 5),
        },
      ],
      game: null,
    });
    render(<Chat />);
    await userEvent.click(screen.getByRole("textbox"));
    expect(screen.getByRole("time")).toHaveTextContent(/\d{2}:\d{2}/);
    expect(document.querySelector(".chat-line-local")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Show timestamps" }));
    expect(screen.queryByRole("time")).not.toBeInTheDocument();
  });
});
