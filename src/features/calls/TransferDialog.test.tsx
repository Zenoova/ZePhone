import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useCallsStore } from "@/stores/calls-store";
import { makeBackend } from "@/test/backend";
import { makeEntry } from "@/test/fixtures";
import type { DirectoryQuery } from "@/types/directory";

import { TransferDialog } from "./TransferDialog";

let backend: ReturnType<typeof makeBackend>;

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  useCallsStore.setState({ calls: {}, dialing: false });
  backend = makeBackend(invoke, {
    directory_search: (a) => {
      const q = a?.query as DirectoryQuery;
      const bob = makeEntry({
        id: "s/2",
        displayName: "Bob Martin",
        favorite: true,
        phones: [{ kind: "work", number: "01.98.76.54.32" }],
      });
      const elodie = makeEntry();
      const fold = (t: string) => t.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
      const all = q.favoritesOnly ? [bob] : [elodie, bob].filter((e) => fold(e.displayName).includes(fold(q.text)));
      return { items: all, total: all.length, offset: 0 };
    },
    directory_dialable: (a) => String(a?.number ?? "").replace(/[^\d+]/g, "") || null,
    transfer_call: () => undefined,
  });
});

const open = () => render(<TransferDialog callId="call1" open onOpenChange={vi.fn()} />);

/** Types in the directory search and waits for the answer to that text (the favourites show until then). */
async function searchFor(text: string, who: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "Chercher dans l'annuaire" }), { target: { value: text } });
  await waitFor(() => expect(screen.getAllByTestId("directory-picker-result")[0]).toHaveTextContent(who));
  return screen.getAllByTestId("directory-picker-result")[0]!;
}

describe("TransferDialog and the directory", () => {
  it("offers the favourites as soon as it opens", async () => {
    open();
    const results = await screen.findAllByTestId("directory-picker-result");
    expect(results).toHaveLength(1);
    expect(results[0]).toHaveTextContent("Bob Martin");
    expect((backend.calls("directory_search")[0]!.query as DirectoryQuery).favoritesOnly).toBe(true);
  });

  it("searches the directory as the user types", async () => {
    open();
    await searchFor("elodie", "Élodie Dupont");
    expect((backend.calls("directory_search").at(-1)!.query as DirectoryQuery).text).toBe("elodie");
  });

  it("makes the user pick the number: each one is its own choice, named by what it is", async () => {
    open();
    const result = await searchFor("elodie", "Élodie Dupont");
    const choices = within(result).getAllByRole("button");
    expect(choices.map((b) => b.textContent)).toEqual([
      "Professionnel +33 1 23 45 67 89",
      "Poste interne 4567",
      "Mobile 06 12-34-56-78",
    ]);
    expect(screen.getByRole("textbox", { name: "Destinataire" })).toHaveValue(""); // nothing picked for the user
  });

  it("transfers the call to the number picked, in its dialling form", async () => {
    const onOpenChange = vi.fn();
    render(<TransferDialog callId="call1" open onOpenChange={onOpenChange} />);
    const result = await searchFor("elodie", "Élodie Dupont");
    fireEvent.click(within(result).getByText("06 12-34-56-78"));
    expect(screen.getByRole("textbox", { name: "Destinataire" })).toHaveValue("06 12-34-56-78");
    expect(screen.getByTestId("transfer-picked")).toHaveTextContent("Élodie Dupont · Mobile");
    fireEvent.click(screen.getByRole("button", { name: /^Transférer$/ }));
    await waitFor(() => expect(backend.calls("transfer_call")).toHaveLength(1));
    expect(backend.calls("transfer_call")[0]).toEqual({ id: "call1", target: "0612345678" });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("still takes a number typed by hand, an internal extension, or a SIP address", async () => {
    backend.handle("directory_dialable", (a) => String(a?.number)); // both are kept as they are
    open();
    const field = screen.getByRole("textbox", { name: "Destinataire" });
    fireEvent.change(field, { target: { value: "1002" } });
    fireEvent.click(screen.getByRole("button", { name: /^Transférer$/ }));
    await waitFor(() => expect(backend.calls("transfer_call")).toHaveLength(1));
    expect(backend.calls("transfer_call")[0]).toEqual({ id: "call1", target: "1002" });
    fireEvent.change(field, { target: { value: "sip:bob@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /^Transférer$/ }));
    await waitFor(() => expect(backend.calls("transfer_call")).toHaveLength(2));
    expect(backend.calls("transfer_call")[1]).toEqual({ id: "call1", target: "sip:bob@example.com" });
  });

  it("forgets who a number was picked for when it is edited by hand", async () => {
    open();
    const result = await searchFor("elodie", "Élodie Dupont");
    fireEvent.click(within(result).getByText("4567"));
    expect(screen.getByTestId("transfer-picked")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Destinataire" }), { target: { value: "4568" } });
    expect(screen.queryByTestId("transfer-picked")).toBeNull();
  });

  it("says plainly when nobody matches, and when the search fails", async () => {
    open();
    fireEvent.change(screen.getByRole("textbox", { name: "Chercher dans l'annuaire" }), { target: { value: "zzz" } });
    expect(await screen.findByTestId("directory-picker-empty")).toHaveTextContent("Personne ne correspond.");
    backend.handle("directory_search", () => {
      throw { kind: "database", message: "Base illisible" };
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Chercher dans l'annuaire" }), { target: { value: "bob" } });
    expect(await screen.findByText(/Base illisible/)).toBeInTheDocument();
  });
});
