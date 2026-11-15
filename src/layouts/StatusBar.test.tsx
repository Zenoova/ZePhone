import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { makeAccount, makeStatus } from "@/test/fixtures";
import { useAccountsStore } from "@/stores/accounts-store";
import { useEngineStore } from "@/stores/engine-store";

import { StatusBar } from "./StatusBar";

beforeEach(() => {
  useAccountsStore.setState({ accounts: [], statuses: {} });
  useEngineStore.setState({ info: { name: "baresip", version: "4.13.0", codecs: ["PCMU"], state: "running" } });
});

describe("StatusBar (always-visible SIP status)", () => {
  it("tells the user when no account is configured", () => {
    render(<StatusBar />);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-state", "none");
    expect(screen.getByText(/Aucun compte configuré/)).toBeInTheDocument();
  });

  it("shows the registration state for the account", () => {
    useAccountsStore.setState({ accounts: [makeAccount()], statuses: { acc1: makeStatus() } });
    render(<StatusBar />);
    expect(screen.getByTestId("connection-status")).toHaveAttribute("data-state", "registered");
    expect(screen.getByText(/Bureau — Enregistré/)).toBeInTheDocument();
    expect(screen.getByLabelText("Moteur SIP")).toHaveTextContent("baresip 4.13.0");
  });

  it("surfaces the SIP code of a registration error", () => {
    useAccountsStore.setState({
      accounts: [makeAccount()],
      statuses: { acc1: makeStatus({ state: "error", sipCode: 403, message: "Accès refusé (403)" }) },
    });
    render(<StatusBar />);
    expect(screen.getByTestId("connection-status")).toHaveTextContent("Erreur (SIP 403)");
    expect(screen.getByTestId("connection-status")).toHaveAttribute("title", "Accès refusé (403)");
  });
});
