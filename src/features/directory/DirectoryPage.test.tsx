import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useCallsStore } from "@/stores/calls-store";
import { NO_FILTERS, useDirectoryStore } from "@/stores/directory-store";
import { useUiStore } from "@/stores/ui-store";
import { makeBackend } from "@/test/backend";
import { makeCall, makeEntry, makeGroup, makeSource } from "@/test/fixtures";
import type { DirectoryEntry, DirectoryQuery } from "@/types/directory";

import { DirectoryPage } from "./DirectoryPage";

const elodie = makeEntry();
const bob = makeEntry({
  id: "src1/uid-2",
  displayName: "Bob Martin",
  firstName: "Bob",
  lastName: "Martin",
  title: null,
  department: "Ventes",
  email: "bob@example.org",
  phones: [{ kind: "work", number: "01.98.76.54.32" }],
});

/** A tiny directory behind `directory_search`: it only knows plain substrings, which is all these tests need. */
function directory(all: DirectoryEntry[]) {
  return (a?: Record<string, unknown>) => {
    const q = a?.query as DirectoryQuery;
    const text = q.text.trim().toLowerCase();
    const found = all.filter(
      (e) => (!text || e.displayName.toLowerCase().includes(text)) && (!q.favoritesOnly || e.favorite),
    );
    return { items: found.slice(q.offset, q.offset + q.limit), total: found.length, offset: q.offset };
  };
}

function setup(over: Record<string, (a?: Record<string, unknown>) => unknown> = {}, entries = [elodie, bob]) {
  return makeBackend(invoke, {
    directory_search: directory(entries),
    directory_sources: () => [
      makeSource({ id: "local", kind: "local", name: "Contacts locaux", readOnly: false, contactCount: 0 }),
      makeSource(),
    ],
    directory_groups: () => [makeGroup({ id: "g1", name: "Direction", memberCount: 1 })],
    directory_departments: () => [{ name: "Comptabilité", count: 1 }],
    directory_dialable: (a) => String(a?.number ?? "").replace(/[^\d+]/g, ""),
    dial: () => makeCall({ id: "new1", state: "dialing" }),
    ...over,
  });
}

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  useDirectoryStore.setState({
    filters: NO_FILTERS,
    items: [],
    total: 0,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    sources: [],
    sourcesLoaded: false,
    groups: [],
    departments: [],
    selection: [],
    selecting: false,
  });
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "contacts", settingsTab: "accounts" });
});

const rows = () => screen.queryAllByTestId("directory-row");

describe("DirectoryPage: finding people", () => {
  it("shows a loading state, then the people, with their role and their first number", async () => {
    setup();
    render(<DirectoryPage />);
    expect(screen.getByTestId("directory-loading")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(2));
    expect(screen.getByTestId("directory-count")).toHaveTextContent("2 contacts");
    const first = rows()[0]!;
    expect(first).toHaveTextContent("Élodie Dupont");
    expect(first).toHaveTextContent("Directrice financière · Société Exemple · Comptabilité");
    expect(first).toHaveTextContent("+33 1 23 45 67 89"); // as written
    expect(first).toHaveTextContent("+2"); // two more numbers
  });

  it("puts the cursor in the search field at once", async () => {
    setup();
    render(<DirectoryPage />);
    expect(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" })).toHaveFocus();
  });

  it("searches as the user types, without waiting for a button", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" }), { target: { value: "bob" } });
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Bob Martin");
    expect((b.calls("directory_search").at(-1)!.query as DirectoryQuery).text).toBe("bob");
    expect(screen.getByTestId("directory-count")).toHaveTextContent("1 contact trouvé");
  });

  it("filters the favourites", async () => {
    const b = setup({}, [{ ...elodie, favorite: true }, bob]);
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Favoris" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(rows()[0]).toHaveTextContent("Élodie Dupont");
    expect((b.calls("directory_search").at(-1)!.query as DirectoryQuery).favoritesOnly).toBe(true);
  });

  it("offers a filter per source once there is more than one", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(await screen.findByRole("button", { name: "Annuaire de l'entreprise" }));
    await waitFor(() =>
      expect((b.calls("directory_search").at(-1)!.query as DirectoryQuery).sourceIds).toEqual(["src1"]),
    );
    // clicking it again lifts the filter
    fireEvent.click(screen.getByRole("button", { name: "Annuaire de l'entreprise" }));
    await waitFor(() => expect((b.calls("directory_search").at(-1)!.query as DirectoryQuery).sourceIds).toEqual([]));
  });
});

describe("DirectoryPage: states", () => {
  it("says the directory is empty and offers to fill it", async () => {
    setup({}, []);
    render(<DirectoryPage />);
    expect(await screen.findByText("L'annuaire est vide")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Nouveau contact/ }).length).toBeGreaterThanOrEqual(1);
    fireEvent.click(screen.getByRole("button", { name: "Connecter un annuaire" }));
    expect(useUiStore.getState()).toMatchObject({ section: "settings", settingsTab: "directory" });
  });

  it("says nothing matches, and how to get out of it", async () => {
    setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.change(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" }), { target: { value: "zzz" } });
    expect(await screen.findByText("Aucun résultat")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Effacer la recherche et les filtres" }));
    await waitFor(() => expect(rows()).toHaveLength(2));
  });

  it("says a synchronisation is under way while the first one has not finished", async () => {
    setup({ directory_sources: () => [makeSource({ state: "syncing" })] }, []);
    render(<DirectoryPage />);
    expect(await screen.findByText("Synchronisation en cours…")).toBeInTheDocument();
  });

  it("shows a search that failed, and retries", async () => {
    let fail = true;
    setup({
      directory_search: (a) => {
        if (fail) throw { kind: "database", message: "Base illisible" };
        return directory([elodie])(a);
      },
    });
    render(<DirectoryPage />);
    expect(await screen.findByText("La recherche a échoué")).toBeInTheDocument();
    expect(screen.getByText(/Base illisible/)).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("a source that needs signing in again is said so, and the contacts stay", async () => {
    setup({
      directory_sources: () => [
        makeSource({
          kind: "microsoftOrg",
          name: "Microsoft 365",
          state: "needsReauth",
          errorKind: "auth",
          lastError: "La connexion Microsoft a expiré.",
        }),
      ],
    });
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2)); // still searchable
    const notice = await screen.findByTestId("source-notice");
    expect(notice).toHaveTextContent("Microsoft 365 : reconnexion nécessaire");
    expect(notice).toHaveTextContent("conservés");
    fireEvent.click(within(notice).getByRole("button", { name: "Reconnecter" }));
    expect(useUiStore.getState().settingsTab).toBe("directory");
  });

  it("a source that is unreachable offers to try again", async () => {
    const b = setup({
      directory_sources: () => [
        makeSource({ state: "error", errorKind: "network", lastError: "Le serveur refuse la connexion." }),
      ],
    });
    render(<DirectoryPage />);
    const notice = await screen.findByTestId("source-notice");
    expect(notice).toHaveTextContent("Le serveur refuse la connexion.");
    fireEvent.click(within(notice).getByRole("button", { name: "Réessayer" }));
    await waitFor(() => expect(b.calls("directory_sync")).toEqual([{ id: "src1" }]));
  });

  it("shows when a synchronisation is running", async () => {
    setup({ directory_sources: () => [makeSource({ state: "syncing", name: "LDAP" })] });
    render(<DirectoryPage />);
    expect(await screen.findByTestId("directory-syncing")).toHaveTextContent("Synchronisation de LDAP");
  });
});

describe("DirectoryPage: the keyboard", () => {
  async function ready() {
    setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    return screen.getByRole("listbox", { name: "Résultats de l'annuaire" });
  }

  it("goes from the search field to the list and down the results", async () => {
    const list = await ready();
    const search = screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" });
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(list).toHaveFocus();
    expect(list).toHaveAttribute("aria-activedescendant", "directory-list-0");
    fireEvent.keyDown(list, { key: "ArrowDown" });
    expect(list).toHaveAttribute("aria-activedescendant", "directory-list-1");
    fireEvent.keyDown(list, { key: "ArrowDown" }); // stops at the last one
    expect(list).toHaveAttribute("aria-activedescendant", "directory-list-1");
    fireEvent.keyDown(list, { key: "Home" });
    expect(list).toHaveAttribute("aria-activedescendant", "directory-list-0");
    fireEvent.keyDown(list, { key: "Escape" });
    expect(search).toHaveFocus();
  });

  it("opens the card with Enter", async () => {
    const list = await ready();
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" }), { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter" });
    expect(await screen.findByRole("dialog", { name: "Élodie Dupont" })).toBeInTheDocument();
    expect(screen.getByTestId("contact-sheet")).toHaveTextContent("+33 1 23 45 67 89");
  });

  it("calls the only number of a person with Ctrl+Enter, but asks first when there are several", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const list = screen.getByRole("listbox", { name: "Résultats de l'annuaire" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" }), { key: "ArrowDown" });

    // Élodie has three numbers: the card opens so that the user picks one
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    expect(await screen.findByTestId("contact-sheet")).toBeInTheDocument();
    expect(b.calls("dial")).toHaveLength(0);
    fireEvent.keyDown(screen.getByTestId("contact-sheet"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByTestId("contact-sheet")).toBeNull());

    // Bob has one: it is called
    fireEvent.keyDown(list, { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(b.calls("dial")).toHaveLength(1));
    expect(b.calls("dial")[0]).toMatchObject({ target: "0198765432" });
  });

  it("toggles a favourite with F", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const list = screen.getByRole("listbox", { name: "Résultats de l'annuaire" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" }), { key: "ArrowDown" });
    fireEvent.keyDown(list, { key: "f" });
    await waitFor(() => expect(b.calls("directory_set_favorite")).toEqual([{ ids: ["src1/uid-1"], favorite: true }]));
  });

  it("jumps to the search with a slash from anywhere", async () => {
    const list = await ready();
    list.focus();
    fireEvent.keyDown(list, { key: "/" });
    expect(screen.getByRole("textbox", { name: "Rechercher dans l'annuaire" })).toHaveFocus();
  });
});

describe("DirectoryPage: a large directory", () => {
  it("only draws what is in view, and loads further pages as it is scrolled", async () => {
    const all = Array.from({ length: 4000 }, (_, i) =>
      makeEntry({ id: `src1/${i}`, displayName: `Personne ${String(i).padStart(4, "0")}` }),
    );
    const b = setup({}, all);
    render(<DirectoryPage />);
    await waitFor(() => expect(rows().length).toBeGreaterThan(0));
    expect(rows().length).toBeLessThan(30);
    expect(screen.getByTestId("directory-count")).toHaveTextContent("4000 contacts");
    expect((b.calls("directory_search")[0]!.query as DirectoryQuery).limit).toBe(100);

    const list = screen.getByRole("listbox", { name: "Résultats de l'annuaire" });
    list.scrollTop = 64 * 90;
    fireEvent.scroll(list);
    await waitFor(() =>
      expect(b.calls("directory_search").some((c) => (c.query as DirectoryQuery).offset === 100)).toBe(true),
    );
  });
});

describe("DirectoryPage: choosing the number", () => {
  it("asks which number when a person has several, and calls the one picked", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Appeler Élodie Dupont : choisir le numéro" }));
    const chooser = await screen.findByTestId("number-chooser");
    expect(chooser).toHaveTextContent("Professionnel");
    expect(chooser).toHaveTextContent("Mobile");
    expect(chooser).toHaveTextContent("Poste interne");
    expect(b.calls("dial")).toHaveLength(0); // nothing is called until the user picks
    fireEvent.click(within(chooser).getByText("06 12-34-56-78"));
    await waitFor(() => expect(b.calls("dial")).toHaveLength(1));
    // the number is shown as written, and dialled cleaned of its separators, through the app's own dialling
    expect(b.calls("directory_dialable")).toEqual([{ number: "06 12-34-56-78" }]);
    expect(b.calls("dial")[0]).toMatchObject({ target: "0612345678" });
    await waitFor(() => expect(useUiStore.getState().section).toBe("dialer"));
  });

  it("calls a person who has one number directly", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Appeler Bob Martin" }));
    await waitFor(() => expect(b.calls("dial")).toHaveLength(1));
    expect(b.calls("dial")[0]).toMatchObject({ target: "0198765432" });
  });
});

describe("DirectoryPage: groups", () => {
  it("adds several people to a group in one go", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "Sélectionner" }));
    for (const r of rows()) fireEvent.click(r);
    expect(screen.getByTestId("selection-bar")).toHaveTextContent("2 sélectionnés");
    fireEvent.click(screen.getByRole("button", { name: "Ajouter au groupe…" }));
    const picker = await screen.findByTestId("group-picker");
    expect(picker).toHaveTextContent("Ajouter 2 contacts à…");
    fireEvent.click(within(picker).getByRole("menuitemcheckbox", { name: /Direction/ }));
    await waitFor(() =>
      expect(b.calls("directory_group_add")).toEqual([{ groupId: "g1", ids: ["src1/uid-1", "src1/uid-2"] }]),
    );
  });

  it("filters by a personal group", async () => {
    const b = setup();
    render(<DirectoryPage />);
    await waitFor(() => expect(rows()).toHaveLength(2));
    act(() => useDirectoryStore.getState().setFilters({ groupId: "g1" }));
    await waitFor(() => expect((b.calls("directory_search").at(-1)!.query as DirectoryQuery).groupId).toBe("g1"));
  });
});
