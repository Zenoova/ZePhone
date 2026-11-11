import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Dialpad } from "./Dialpad";

describe("Dialpad", () => {
  beforeEach(() => vi.useFakeTimers());
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
});
