import { render, screen } from "@testing-library/react";
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
      chat: [{ id: 1, from: "alice", text: "hello" }],
      game: {
        attack: vi.fn(),
        interact: vi.fn(),
        usePotion: vi.fn(),
        heal: vi.fn(),
        release: vi.fn(),
        castSkill: vi.fn(),
        sendChat,
        switchCharacter: vi.fn(),
        logout: vi.fn(),
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
});
