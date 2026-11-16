import type * as AnimatedIcons from "@animateicons/react/lucide";
import { fireEvent, render, screen } from "@testing-library/react";
import { forwardRef, useImperativeHandle } from "react";
import { describe, expect, it, vi } from "vitest";

const start = vi.fn();
const stop = vi.fn();

// Replace one animated icon by a stub exposing the same imperative handle, to observe it.
vi.mock("@animateicons/react/lucide", async (importOriginal) => {
  const actual = await importOriginal<typeof AnimatedIcons>();
  const Stub = forwardRef<{ startAnimation: () => void; stopAnimation: () => void }, { className?: string }>(
    ({ className, ...rest }, ref) => {
      useImperativeHandle(ref, () => ({ startAnimation: start, stopAnimation: stop }));
      return <div data-testid="stub" className={className} {...rest} />;
    },
  );
  return { ...actual, PhoneIcon: Stub };
});

import { Mic, Phone } from "@/components/icons";

describe("animated icons", () => {
  it("is 1rem and decorative by default", () => {
    const { container } = render(<Mic />);
    const icon = container.querySelector("[data-slot=icon] > div");
    expect(icon).toHaveClass("size-4");
    expect(icon).toHaveAttribute("aria-hidden", "true");
    expect(icon?.querySelector("svg")).toBeInTheDocument();
  });

  it("takes its size from a Tailwind class, replacing the default", () => {
    const { container } = render(<Mic className="size-6 text-primary" />);
    const icon = container.querySelector("[data-slot=icon] > div");
    expect(icon).toHaveClass("size-6", "text-primary");
    expect(icon).not.toHaveClass("size-4");
  });

  it("is exposed as an image when it has a label", () => {
    render(<Mic aria-label="Mic" />);
    expect(screen.getByRole("img", { name: "Mic" })).toBeInTheDocument();
  });

  it("animates when the button that contains it is hovered or focused", () => {
    start.mockClear();
    stop.mockClear();
    render(
      <button type="button">
        <Phone /> Call
      </button>,
    );
    const button = screen.getByRole("button");
    fireEvent.mouseEnter(button);
    expect(start).toHaveBeenCalledTimes(1);
    fireEvent.mouseLeave(button);
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.focusIn(button);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("animates on its own hover when it is not inside a control", () => {
    start.mockClear();
    render(<Phone />);
    fireEvent.mouseEnter(screen.getByTestId("stub"));
    expect(start).toHaveBeenCalledTimes(1);
  });
});
