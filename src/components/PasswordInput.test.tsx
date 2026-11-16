import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("is masked by default and toggles between hidden and visible", () => {
    render(<PasswordInput aria-label="Password" defaultValue="s3cret" />);
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Show the password" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Hide the password" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Hide the password" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps the typed value when toggling", () => {
    render(<PasswordInput aria-label="Password" />);
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc;def" } });
    fireEvent.click(screen.getByRole("button", { name: "Show the password" }));
    expect(input.value).toBe("abc;def");
  });
});
