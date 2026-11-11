import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { playDtmfTone } = vi.hoisted(() => ({ playDtmfTone: vi.fn() }));
vi.mock("@/lib/dtmf-tones", () => ({ playDtmfTone: (...a: unknown[]) => playDtmfTone(...a) }));

import { Dialpad } from "./Dialpad";

describe("Dialpad", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    playDtmfTone.mockReset();
  });
  afterEach(() => vi.useRealTimers());

  it("renders the 12 keys and reports each press", () => {
    const onKey = vi.fn();
    render(<Dialpad onKey={onKey} />);
    expect(screen.getAllByRole("button")).toHaveLength(12);
    fireEvent.click(screen.getByRole("button", { name: "5" }));
    fireEvent.click(screen.getByRole("button", { name: "Étoile" }));
    fireEvent.click(screen.getByRole("button", { name: "Dièse" }));
    expect(onKey.mock.calls.map((c) => c[0])).toEqual(["5", "*", "#"]);
  });

  it("a long press on 0 types + (and not an extra 0)", () => {
    const onKey = vi.fn();
    const onLongZero = vi.fn();
    render(<Dialpad onKey={onKey} onLongZero={onLongZero} />);
    const zero = screen.getByRole("button", { name: "0" });
    fireEvent.pointerDown(zero);
    vi.advanceTimersByTime(700);
    fireEvent.pointerUp(zero);
    fireEvent.click(zero);
    expect(onLongZero).toHaveBeenCalledTimes(1);
    expect(onKey).not.toHaveBeenCalled();

    // A short press is a plain 0.
    fireEvent.pointerDown(zero);
    vi.advanceTimersByTime(100);
    fireEvent.pointerUp(zero);
    fireEvent.click(zero);
    expect(onKey).toHaveBeenCalledWith("0");
    expect(onLongZero).toHaveBeenCalledTimes(1);
  });

  it("is inert when disabled", () => {
    const onKey = vi.fn();
    render(<Dialpad onKey={onKey} disabled />);
    fireEvent.click(screen.getByRole("button", { name: "1" }));
    expect(onKey).not.toHaveBeenCalled();
  });

  it("plays the key's tone on every press, unless muted", () => {
    const { rerender } = render(<Dialpad onKey={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "8" }));
    expect(playDtmfTone).toHaveBeenCalledWith("8");
    rerender(<Dialpad onKey={vi.fn()} sound={false} />);
    fireEvent.click(screen.getByRole("button", { name: "9" }));
    expect(playDtmfTone).toHaveBeenCalledTimes(1);
  });

  it("only listens to the physical keyboard when asked to", () => {
    const onKey = vi.fn();
    const { rerender } = render(<Dialpad onKey={onKey} />);
    fireEvent.keyDown(window, { key: "2" });
    expect(onKey).not.toHaveBeenCalled();
    rerender(<Dialpad onKey={onKey} captureKeyboard />);
    fireEvent.keyDown(window, { key: "2" });
    expect(onKey).toHaveBeenCalledWith("2");
    expect(playDtmfTone).toHaveBeenCalledWith("2");
  });

  it("stops listening when unmounted or disabled", () => {
    const onKey = vi.fn();
    const { rerender, unmount } = render(<Dialpad onKey={onKey} captureKeyboard disabled />);
    fireEvent.keyDown(window, { key: "3" });
    expect(onKey).not.toHaveBeenCalled();
    rerender(<Dialpad onKey={onKey} captureKeyboard />);
    unmount();
    fireEvent.keyDown(window, { key: "3" });
    expect(onKey).not.toHaveBeenCalled();
  });

  it("highlights the key pressed on the keyboard for a short moment", () => {
    render(<Dialpad onKey={vi.fn()} captureKeyboard />);
    fireEvent.keyDown(window, { key: "6" });
    expect(screen.getByRole("button", { name: "6" })).toHaveAttribute("data-pressed", "true");
    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(screen.getByRole("button", { name: "6" })).toHaveAttribute("data-pressed", "false");
  });
});
