import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { DockProviderForTests } from "@/test/dock";
import { useAccountsStore } from "@/stores/accounts-store";
import { makeAccount, makeStatus } from "@/test/fixtures";

import { AccountsDockItem } from "./AccountsPopover";

const accounts = () => [
  makeAccount({ id: "a1", label: "Bureau", username: "1001", domain: "example.com", isDefault: true }),
  makeAccount({ id: "a2", label: "Mobile", username: "0987", domain: "voip.fr", isDefault: false }),
  makeAccount({ id: "a3", label: "Ancien", username: "5555", domain: "old.net", isDefault: false, enabled: false }),
];

const open = async () => {
  fireEvent.click(screen.getByTestId("dock-accounts"));
  return await screen.findByTestId("accounts-popover");
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => (cmd === "list_accounts" ? accounts() : undefined));
  useAccountsStore.setState({
    accounts: accounts(),
    statuses: {
      a1: makeStatus({ accountId: "a1", state: "registered" }),
      a2: makeStatus({ accountId: "a2", state: "error", sipCode: 403 }),
    },
  });
});

describe("AccountsDockItem", () => {
  it("is the face of the account that is connected", () => {
    render(<AccountsDockItem />, { wrapper: DockProviderForTests });
    const face = () =>
      within(screen.getByTestId("dock-accounts")).getByTestId("account-avatar").querySelector("svg")?.innerHTML;
    // The connected account is Bureau, not the failing one: its face is in the dock icon.
    const bureau = face();
    expect(bureau).toBeTruthy();
    // When the other account becomes the connected one, its face takes the place.
    act(() =>
      useAccountsStore.setState({
        statuses: {
          a1: makeStatus({ accountId: "a1", state: "error", sipCode: 401 }),
          a2: makeStatus({ accountId: "a2", state: "registered" }),
        },
      }),
    );
    expect(face()).toBeTruthy();
    expect(face()).not.toBe(bureau);
  });

  it("falls back to an icon when there is no account", () => {
    useAccountsStore.setState({ accounts: [], statuses: {} });
    render(<AccountsDockItem />, { wrapper: DockProviderForTests });
    expect(within(screen.getByTestId("dock-accounts")).queryByTestId("account-avatar")).toBeNull();
  });

  it("lists every account with its availability, greying out the disabled ones", async () => {
    render(<AccountsDockItem />, { wrapper: DockProviderForTests });
    const popover = await open();
    const rows = within(popover).getAllByTestId("account-row");
    expect(rows.map((r) => r.querySelector("p")?.textContent)).toEqual(["Bureau", "Mobile", "Ancien"]);
    expect(within(rows[0]!).getByTestId("account-availability")).toHaveTextContent("Disponible");
    expect(within(rows[1]!).getByTestId("account-availability")).toHaveTextContent("Indisponible · SIP 403");
    expect(within(rows[2]!).getByTestId("account-availability")).toHaveTextContent("Désactivé");
    expect(rows[2]).toHaveAttribute("data-enabled", "false");
    expect(rows[2]!.firstElementChild).toHaveClass("opacity-45");
    expect(rows[0]!.firstElementChild).not.toHaveClass("opacity-45");
    for (const r of rows) expect(within(r).getByTestId("account-avatar")).toBeInTheDocument();
  });

  it("turns an account on or off from the list", async () => {
    render(<AccountsDockItem />, { wrapper: DockProviderForTests });
    const popover = await open();
    fireEvent.click(within(popover).getByRole("switch", { name: "Désactiver Mobile" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_account_enabled", { id: "a2", enabled: false }));
    fireEvent.click(within(popover).getByRole("switch", { name: "Activer Ancien" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("set_account_enabled", { id: "a3", enabled: true }));
  });

  it("ends with a button to add a SIP account, which opens the account form", async () => {
    render(<AccountsDockItem />, { wrapper: DockProviderForTests });
    const popover = await open();
    const items = within(popover).getAllByRole("listitem");
    const add = within(popover).getByRole("button", { name: /Ajouter un compte SIP/ });
    expect(items).toHaveLength(3);
    expect(add.compareDocumentPosition(items[2]!) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy(); // after the list
    fireEvent.click(add);
    expect(await screen.findByRole("dialog", { name: /Ajouter un compte SIP/ })).toBeInTheDocument();
  });
});
