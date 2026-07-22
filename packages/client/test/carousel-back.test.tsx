import { setLocale } from "@lindocara/client/i18n.js";
import { Carousel } from "@lindocara/client/ui/Carousel.js";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression: the JoinScreen carousel is usually empty (no other players' open parties), and back
 * used to be dead there — `MenuNav` (which owns Escape/B → onBack) was only mounted when there were
 * cards to focus. Back must work in every state.
 */
describe("Carousel back", () => {
  beforeEach(() => setLocale("en"));

  function renderCarousel(loading: boolean) {
    const onBack = vi.fn();
    render(
      <Carousel
        title="Join"
        cards={[]}
        loading={loading}
        emptyLabel="No open parties"
        onSelect={() => {}}
        onBack={onBack}
      />,
    );
    return onBack;
  }

  it("fires onBack on Escape when the carousel is empty", () => {
    const onBack = renderCarousel(false);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onBack on Escape while the carousel is loading", () => {
    const onBack = renderCarousel(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("fires onBack from the visible back button when empty", () => {
    const onBack = renderCarousel(false);
    fireEvent.click(screen.getByRole("button"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
