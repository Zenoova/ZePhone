import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PasswordInput } from "./PasswordInput";

describe("PasswordInput", () => {
  it("is masked by default and toggles between hidden and visible", () => {
    render(<PasswordInput aria-label="Mot de passe" defaultValue="s3cret" />);
    const input = screen.getByLabelText("Mot de passe");
    expect(input).toHaveAttribute("type", "password");

    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(input).toHaveAttribute("type", "text");
    expect(screen.getByRole("button", { name: "Masquer le mot de passe" })).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByRole("button", { name: "Masquer le mot de passe" }));
    expect(input).toHaveAttribute("type", "password");
  });

  it("keeps the typed value when toggling", () => {
    render(<PasswordInput aria-label="Mot de passe" />);
    const input = screen.getByLabelText("Mot de passe") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "abc;def" } });
    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(input.value).toBe("abc;def");
  });
});
