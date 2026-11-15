import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { makeAccount } from "@/test/fixtures";

import { AccountFormDialog } from "./AccountForm";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(makeAccount());
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("AccountForm", () => {
  it("fills the optional fields while the main ones are typed, then saves them as defaults", async () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    fireEvent.change(field("Serveur SIP"), { target: { value: "sip.example.com" } });
    fireEvent.change(field("Identifiant"), { target: { value: "1001" } });
    fireEvent.change(field("Mot de passe"), { target: { value: "pw" } });

    expect(field("Domaine SIP").value).toBe("sip.example.com");
    expect(field("Identifiant d'authentification").value).toBe("1001");
    expect(field("Nom du compte").value).toBe("1001@sip.example.com");

    fireEvent.click(screen.getByRole("button", { name: /Ajouter et connecter/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    const [cmd, args] = invoke.mock.calls[0] as [string, { input: Record<string, unknown> }];
    expect(cmd).toBe("save_account");
    expect(args.input).toMatchObject({
      server: "sip.example.com",
      username: "1001",
      domain: null,
      authUsername: null,
      password: "pw",
    });
  });

  it("a domain typed by hand is no longer overwritten by the server", () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    fireEvent.change(field("Serveur SIP"), { target: { value: "sip.example.com" } });
    fireEvent.change(field("Domaine SIP"), { target: { value: "example.com" } });
    fireEvent.change(field("Serveur SIP"), { target: { value: "sip2.example.com" } });
    expect(field("Domaine SIP").value).toBe("example.com");
  });

  it("the password can be revealed", () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    expect(field("Mot de passe")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Afficher le mot de passe" }));
    expect(field("Mot de passe")).toHaveAttribute("type", "text");
  });
});
