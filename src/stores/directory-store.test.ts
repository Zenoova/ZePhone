import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { makeEntry, makeGroup, makeSource } from "@/test/fixtures";

import { NO_FILTERS, PAGE_SIZE, hasFilters, recordIds, useDirectoryStore } from "./directory-store";

function page(items: ReturnType<typeof makeEntry>[], total = items.length, offset = 0) {
  return { items, total, offset };
}

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
  useDirectoryStore.setState({
    filters: NO_FILTERS,
    items: [],
    total: 0,
    loaded: false,
    loading: false,
    loadingMore: false,
    error: null,
    sources: [],
    groups: [],
    departments: [],
    selection: [],
    selecting: false,
  });
});

const calls = (name: string) => invoke.mock.calls.filter((c) => c[0] === name);

describe("directory store: searching", () => {
  it("sends the filters and shows the answer", async () => {
    invoke.mockResolvedValue(page([makeEntry()], 1));
    useDirectoryStore.getState().setFilters({ text: "elodie", favoritesOnly: true });
    await useDirectoryStore.getState().search();
    expect(invoke).toHaveBeenCalledWith("directory_search", {
      query: {
        text: "elodie",
        sourceIds: [],
        groupId: null,
        department: null,
        favoritesOnly: true,
        offset: 0,
        limit: PAGE_SIZE,
      },
    });
    const s = useDirectoryStore.getState();
    expect(s.items).toHaveLength(1);
    expect([s.total, s.loaded, s.loading]).toEqual([1, true, false]);
  });

  it("drops an answer that arrives after a newer search", async () => {
    let resolveFirst!: (v: unknown) => void;
    invoke.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r)));
    invoke.mockResolvedValueOnce(page([makeEntry({ id: "b", displayName: "Bob" })], 1));
    const first = useDirectoryStore.getState().search();
    await useDirectoryStore.getState().search();
    resolveFirst(page([makeEntry({ id: "a", displayName: "Alice" })], 1));
    await first;
    expect(useDirectoryStore.getState().items.map((i) => i.displayName)).toEqual(["Bob"]);
  });

  it("loads the next page when the list is scrolled and stops at the end", async () => {
    const all = Array.from({ length: 150 }, (_, i) => makeEntry({ id: `s/${i}`, displayName: `P${i}` }));
    invoke.mockResolvedValueOnce(page(all.slice(0, 100), 150));
    await useDirectoryStore.getState().search();
    invoke.mockResolvedValueOnce(page(all.slice(100), 150, 100));
    await useDirectoryStore.getState().loadMore();
    expect(calls("directory_search")[1]?.[1]).toMatchObject({ query: { offset: 100 } });
    expect(useDirectoryStore.getState().items).toHaveLength(150);
    await useDirectoryStore.getState().loadMore(); // nothing left: no request
    expect(calls("directory_search")).toHaveLength(2);
  });

  it("reports a failed search without losing what is shown", async () => {
    invoke.mockResolvedValueOnce(page([makeEntry()], 1));
    await useDirectoryStore.getState().search();
    invoke.mockRejectedValueOnce({ kind: "database", message: "unreadable database" });
    await useDirectoryStore.getState().search();
    const s = useDirectoryStore.getState();
    expect(s.error).toContain("unreadable database");
    expect(s.items).toHaveLength(1);
  });

  it("knows whether any filter is on", () => {
    expect(hasFilters(NO_FILTERS)).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, text: "  " })).toBe(false);
    expect(hasFilters({ ...NO_FILTERS, text: "a" })).toBe(true);
    expect(hasFilters({ ...NO_FILTERS, groupId: "g" })).toBe(true);
  });
});

describe("directory store: sources, groups and refresh", () => {
  function backend(over: Record<string, unknown> = {}) {
    const answers: Record<string, unknown> = {
      directory_sources: [makeSource()],
      directory_groups: [makeGroup()],
      directory_departments: [{ name: "Accounting", count: 3 }],
      directory_search: page([makeEntry()], 1),
      ...over,
    };
    invoke.mockImplementation(async (cmd: string) => answers[cmd]);
  }

  it("loads the sources, the groups and the departments together", async () => {
    backend();
    await useDirectoryStore.getState().loadSources();
    const s = useDirectoryStore.getState();
    expect(s.sources).toHaveLength(1);
    expect(s.groups[0]?.name).toBe("Direction");
    expect(s.departments[0]?.name).toBe("Accounting");
  });

  it("forgets a group or a department that no longer exists", async () => {
    backend({ directory_groups: [], directory_departments: [] });
    useDirectoryStore.getState().setFilters({ groupId: "gone", department: "Disappeared" });
    await useDirectoryStore.getState().loadSources();
    expect(useDirectoryStore.getState().filters).toMatchObject({ groupId: null, department: null });
  });

  it("re-reads the list without dropping the contacts that were loaded", async () => {
    backend({ directory_search: page([makeEntry()], 300) });
    useDirectoryStore.setState({
      items: Array.from({ length: 250 }, (_, i) => makeEntry({ id: `s/${i}` })),
      total: 300,
    });
    await useDirectoryStore.getState().refreshAll();
    expect(calls("directory_search")[0]?.[1]).toMatchObject({ query: { offset: 0, limit: 250 } });
  });

  it("deleting the group that is the current filter clears the filter", async () => {
    backend();
    useDirectoryStore.getState().setFilters({ groupId: "g1" });
    expect(await useDirectoryStore.getState().deleteGroup("g1")).toBe(true);
    expect(invoke).toHaveBeenCalledWith("directory_delete_group", { id: "g1" });
    expect(useDirectoryStore.getState().filters.groupId).toBeNull();
  });
});

describe("directory store: favourites and groups", () => {
  it("a favourite applies to every record of the person, and shows at once", async () => {
    const entry = makeEntry({
      sources: [
        { recordId: "a/1", sourceId: "a", sourceName: "LDAP", kind: "ldap", externalId: "1" },
        { recordId: "b/9", sourceId: "b", sourceName: "Microsoft", kind: "microsoftOrg", externalId: "9" },
      ],
    });
    expect(recordIds(entry)).toEqual(["a/1", "b/9"]);
    invoke.mockResolvedValue(undefined);
    useDirectoryStore.setState({ items: [entry] });
    await useDirectoryStore.getState().toggleFavorite(entry);
    expect(invoke).toHaveBeenCalledWith("directory_set_favorite", { ids: ["a/1", "b/9"], favorite: true });
    expect(useDirectoryStore.getState().items[0]?.favorite).toBe(true);
  });

  it("puts the favourite back and says so when it could not be saved", async () => {
    const entry = makeEntry();
    useDirectoryStore.setState({ items: [entry] });
    invoke.mockRejectedValue({ kind: "database", message: "disk full" });
    await useDirectoryStore.getState().toggleFavorite(entry);
    expect(useDirectoryStore.getState().items[0]?.favorite).toBe(false);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("disk full"));
  });

  it("adds several contacts to a group in one go, every record of each", async () => {
    invoke.mockResolvedValue(undefined);
    const a = makeEntry({ id: "x/1" });
    const b = makeEntry({
      id: "x/2",
      sources: [
        { recordId: "x/2", sourceId: "x", sourceName: "LDAP", kind: "ldap", externalId: "2" },
        { recordId: "y/2", sourceId: "y", sourceName: "MS", kind: "microsoftOrg", externalId: "2" },
      ],
    });
    expect(await useDirectoryStore.getState().addToGroup("g1", [a, b])).toBe(true);
    expect(invoke).toHaveBeenCalledWith("directory_group_add", { groupId: "g1", ids: ["x/1", "x/2", "y/2"] });
  });

  it("explains a refused group name", async () => {
    invoke.mockRejectedValue({ kind: "validation", message: "A group already has this name" });
    expect(await useDirectoryStore.getState().createGroup("Direction")).toBeNull();
    expect(toast.error).toHaveBeenCalledWith("A group already has this name");
  });

  it("keeps a selection that is cleared when selecting stops", () => {
    const s = useDirectoryStore.getState();
    s.setSelecting(true);
    s.toggleSelected("a");
    s.toggleSelected("b");
    s.toggleSelected("a");
    expect(useDirectoryStore.getState().selection).toEqual(["b"]);
    s.setSelecting(false);
    expect(useDirectoryStore.getState().selection).toEqual([]);
  });
});
