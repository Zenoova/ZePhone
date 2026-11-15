import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AccountAvatar } from "./AccountAvatar";

const face = (seed: string, state?: "registered" | "error") => {
  const { container, unmount } = render(<AccountAvatar seed={seed} state={state} />);
  const html = container.querySelector("svg")?.innerHTML ?? "";
  unmount();
  return html;
};

describe("AccountAvatar", () => {
  it("draws the same face for the same account and another for another account", () => {
    expect(face("1001@example.com")).not.toBe("");
    expect(face("1001@example.com")).toBe(face("1001@example.com"));
    expect(face("1001@example.com")).not.toBe(face("1002@example.com"));
  });

  it("is small and square", () => {
    render(<AccountAvatar seed="a@b" size={36} />);
    expect(screen.getByTestId("account-avatar")).toHaveStyle({ width: "36px", height: "36px" });
  });

  it("has a status dot only when it is given a state", () => {
    const { container, rerender } = render(<AccountAvatar seed="a@b" />);
    expect(container.querySelector(".rounded-full.ring-2")).toBeNull();
    rerender(<AccountAvatar seed="a@b" state="registered" />);
    expect(container.querySelector(".rounded-full.ring-2")).not.toBeNull();
  });
});
