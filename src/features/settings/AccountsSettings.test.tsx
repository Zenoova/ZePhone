import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { useAccountsStore } from "@/stores/accounts-store";
import { makeAccount, makeStatus } from "@/test/fixtures";

import { AccountsSettings } from "./AccountsSettings";

beforeEach(() => {
  useAccountsStore.setState({ accounts: [], statuses: {} });
});

describe("AccountsSettings", () => {
  it("invites to add a first account", () => {
    render(<AccountsSettings />);
    expect(screen.getByText("Aucun compte SIP")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ajouter/ })).toBeInTheDocument();
  });

  it("lists the accounts, each with its own little face and state", () => {
    useAccountsStore.setState({
      accounts: [
        makeAccount({ id: "a1", label: "Bureau", username: "1001", domain: "example.com" }),
        makeAccount({ id: "a2", label: "Mobile", username: "0987", domain: "voip.fr", isDefault: false }),
      ],
      statuses: { a1: makeStatus({ accountId: "a1", state: "registered" }) },
    });
    render(<AccountsSettings />);
    const cards = screen.getAllByTestId("account-card");
    expect(cards).toHaveLength(2);
    expect(within(cards[0]!).getByText("Bureau")).toBeInTheDocument();
    expect(within(cards[0]!).getByTestId("account-avatar")).toBeInTheDocument();
    const faces = cards.map((c) => c.querySelector("svg")?.innerHTML);
    expect(faces[0]).toBeTruthy();
    expect(faces[0]).not.toBe(faces[1]);
  });
});
