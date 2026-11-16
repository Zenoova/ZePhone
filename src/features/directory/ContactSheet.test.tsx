import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useCallsStore } from "@/stores/calls-store";
import { useDirectoryStore } from "@/stores/directory-store";
import { useUiStore } from "@/stores/ui-store";
import { makeBackend } from "@/test/backend";
import { makeCall, makeEntry, makeGroup } from "@/test/fixtures";
import type { DirectoryEntry } from "@/types/directory";

import { ContactSheet } from "./ContactSheet";

function show(entry: DirectoryEntry, over: Partial<React.ComponentProps<typeof ContactSheet>> = {}) {
  const props = { onClose: vi.fn(), onEdit: vi.fn(), onDelete: vi.fn(), onManageGroups: vi.fn(), ...over };
  render(<ContactSheet entry={entry} {...props} />);
  return props;
}

let backend: ReturnType<typeof makeBackend>;
const write = vi.fn();

beforeEach(() => {
  invoke.mockReset();
  write.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
  Object.values(toast).forEach((f) => f.mockReset());
  backend = makeBackend(invoke, {
    directory_dialable: (a) => String(a?.number ?? "").replace(/[^\d+]/g, ""),
    dial: () => makeCall({ id: "new1", state: "dialing" }),
    transfer_call: () => undefined,
  });
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "contacts" });
  useDirectoryStore.setState({ groups: [makeGroup({ id: "g1", name: "Direction" })], items: [] });
});

describe("ContactSheet", () => {
  it("gives the person's details and every number with what it is, exactly as the source wrote it", () => {
    show(makeEntry());
    const dialog = screen.getByRole("dialog", { name: "Élodie Dupont" });
    expect(dialog).toHaveTextContent("Directrice financière · Société Exemple · Comptabilité");
    expect(dialog).toHaveTextContent("elodie.dupont@example.org");
    expect(dialog).toHaveTextContent("Lecture seule");
    const phones = screen.getAllByTestId("phone-row").map((r) => r.textContent);
    expect(phones[0]).toContain("Professionnel");
    expect(phones[0]).toContain("+33 1 23 45 67 89");
    expect(phones.join(" ")).toContain("Poste interne");
    expect(phones.join(" ")).toContain("06 12-34-56-78");
  });

  it("keeps the provenance, with the identifier the source gave", () => {
    show(makeEntry());
    const provenance = screen.getByTestId("provenance");
    expect(provenance).toHaveTextContent("Annuaire LDAP · Annuaire de l'entreprise");
    expect(provenance).toHaveTextContent("uid-1");
  });

  it("says when two records were joined, and on what", () => {
    const linked = makeEntry({
      sources: [
        { recordId: "a/1", sourceId: "a", sourceName: "LDAP", kind: "ldap", externalId: "1" },
        { recordId: "b/9", sourceId: "b", sourceName: "Microsoft", kind: "microsoftOrg", externalId: "9" },
      ],
    });
    show(linked);
    const provenance = screen.getByTestId("provenance");
    expect(provenance).toHaveTextContent("Annuaire LDAP");
    expect(provenance).toHaveTextContent("Microsoft 365");
    expect(provenance).toHaveTextContent("même adresse e-mail — jamais seulement le même nom");
  });

  it("calls the number it is asked to, through the application's own dialling", async () => {
    const props = show(makeEntry());
    fireEvent.click(screen.getByRole("button", { name: "Appeler Mobile 06 12-34-56-78" }));
    await waitFor(() => expect(backend.calls("dial")).toHaveLength(1));
    expect(backend.calls("directory_dialable")).toEqual([{ number: "06 12-34-56-78" }]);
    expect(backend.calls("dial")[0]).toMatchObject({ target: "0612345678" });
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
    expect(useUiStore.getState().section).toBe("dialer");
  });

  it("keeps an internal extension and a SIP address usable", async () => {
    backend.handle("directory_dialable", (a) => String(a?.number)); // the backend keeps both as they are
    show(
      makeEntry({
        phones: [
          { kind: "extension", number: "4567" },
          { kind: "sip", number: "sip:elodie@pbx.example.org" },
        ],
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Appeler Poste interne 4567" }));
    await waitFor(() => expect(backend.calls("dial")).toHaveLength(1));
    expect(backend.calls("dial")[0]).toMatchObject({ target: "4567" });
    fireEvent.click(screen.getByRole("button", { name: "Appeler Adresse SIP sip:elodie@pbx.example.org" }));
    await waitFor(() => expect(backend.calls("dial")).toHaveLength(2));
    expect(backend.calls("dial")[1]).toMatchObject({ target: "sip:elodie@pbx.example.org" });
  });

  it("copies the number as written", async () => {
    show(makeEntry());
    fireEvent.click(screen.getByRole("button", { name: "Copier 06 12-34-56-78" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("06 12-34-56-78"));
    expect(toast.success).toHaveBeenCalledWith("Numéro copié");
  });

  it("cannot transfer when there is no call, and says why", () => {
    show(makeEntry());
    const button = screen.getAllByRole("button", { name: /Transférer l'appel vers/ })[0]!;
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("title", "Aucun appel en cours à transférer");
  });

  it("transfers the call in progress to the number picked, through the application's own transfer", async () => {
    useCallsStore.setState({ calls: { call1: makeCall({ id: "call1", state: "connected" }) } });
    const props = show(makeEntry());
    fireEvent.click(screen.getByRole("button", { name: "Transférer l'appel vers +33 1 23 45 67 89" }));
    await waitFor(() => expect(backend.calls("transfer_call")).toHaveLength(1));
    expect(backend.calls("transfer_call")[0]).toEqual({ id: "call1", target: "+33123456789" });
    expect(toast.success).toHaveBeenCalledWith("Transfert demandé");
    await waitFor(() => expect(props.onClose).toHaveBeenCalled());
  });

  it("does not offer to transfer a call that is on hold, only the one in progress", () => {
    useCallsStore.setState({ calls: { held: makeCall({ id: "held", state: "onHold" }) } });
    show(makeEntry());
    expect(screen.getAllByRole("button", { name: /Transférer l'appel vers/ })[0]).toBeDisabled();
  });

  it("toggles the favourite", async () => {
    useDirectoryStore.setState({ items: [makeEntry()] });
    backend.handle("directory_set_favorite", () => undefined);
    show(makeEntry());
    fireEvent.click(screen.getByRole("button", { name: "Ajouter aux favoris" }));
    await waitFor(() =>
      expect(backend.calls("directory_set_favorite")).toEqual([{ ids: ["src1/uid-1"], favorite: true }]),
    );
  });

  it("only lets the local address book be edited", () => {
    const readOnly = show(makeEntry());
    expect(screen.queryByRole("button", { name: /Modifier/ })).toBeNull();
    expect(readOnly.onEdit).not.toHaveBeenCalled();
  });

  it("edits and deletes a local contact", () => {
    const local = makeEntry({
      id: "local/c1",
      readOnly: false,
      sources: [
        { recordId: "local/c1", sourceId: "local", sourceName: "Contacts locaux", kind: "local", externalId: "c1" },
      ],
    });
    const props = show(local);
    expect(screen.queryByText("Lecture seule")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Modifier/ }));
    expect(props.onEdit).toHaveBeenCalledWith(local);
    fireEvent.click(screen.getByRole("button", { name: /Supprimer/ }));
    expect(props.onDelete).toHaveBeenCalledWith(local);
  });

  it("shows the groups the person is in", () => {
    show(makeEntry({ groups: ["g1"] }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Groupes (1)" })).toBeInTheDocument();
    expect(within(dialog).getByText("Direction")).toBeInTheDocument();
  });
});
