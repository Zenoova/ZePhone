import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { DepartmentCount, DirectoryEntry, DirectoryQuery, GroupView, SourceView } from "@/types/directory";

/** How many contacts are asked for at a time: the list loads more as it is scrolled. */
export const PAGE_SIZE = 100;

export interface DirectoryFilters {
  text: string;
  /** Only these sources (empty = all). */
  sourceIds: string[];
  groupId: string | null;
  department: string | null;
  favoritesOnly: boolean;
}

export const NO_FILTERS: DirectoryFilters = {
  text: "",
  sourceIds: [],
  groupId: null,
  department: null,
  favoritesOnly: false,
};

export const hasFilters = (f: DirectoryFilters): boolean =>
  f.text.trim() !== "" || f.sourceIds.length > 0 || f.groupId !== null || f.department !== null || f.favoritesOnly;

function toQuery(f: DirectoryFilters, offset: number, limit: number): DirectoryQuery {
  return {
    text: f.text,
    sourceIds: f.sourceIds,
    groupId: f.groupId,
    department: f.department,
    favoritesOnly: f.favoritesOnly,
    offset,
    limit,
  };
}

interface DirectoryState {
  filters: DirectoryFilters;
  items: DirectoryEntry[];
  total: number;
  /** The first search of the page has not answered yet. */
  loaded: boolean;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  sources: SourceView[];
  sourcesLoaded: boolean;
  groups: GroupView[];
  departments: DepartmentCount[];
  /** Entries ticked for a group action (by id of the main record). */
  selection: string[];
  selecting: boolean;

  setFilters: (patch: Partial<DirectoryFilters>) => void;
  resetFilters: () => void;
  /** Runs the search from the first result. Out-of-date answers are dropped. */
  search: () => Promise<void>;
  loadMore: () => Promise<void>;
  /** Re-reads everything the page shows, keeping as many contacts as are loaded. */
  refreshAll: () => Promise<void>;
  loadSources: () => Promise<void>;

  toggleFavorite: (entry: DirectoryEntry) => Promise<void>;
  createGroup: (name: string) => Promise<GroupView | null>;
  renameGroup: (id: string, name: string) => Promise<boolean>;
  deleteGroup: (id: string) => Promise<boolean>;
  addToGroup: (groupId: string, entries: DirectoryEntry[]) => Promise<boolean>;
  removeFromGroup: (groupId: string, entries: DirectoryEntry[]) => Promise<boolean>;

  setSelecting: (on: boolean) => void;
  toggleSelected: (id: string) => void;
  clearSelection: () => void;
}

/** Every record behind an entry: a person found in two sources is one entry but two records. */
export const recordIds = (e: DirectoryEntry): string[] => e.sources.map((s) => s.recordId);

let searchSeq = 0;

export const useDirectoryStore = create<DirectoryState>((set, get) => ({
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

  setFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  resetFilters: () => set({ filters: NO_FILTERS }),

  search: async () => {
    const seq = ++searchSeq;
    set({ loading: true, error: null });
    try {
      const page = await telephony.directorySearch(toQuery(get().filters, 0, PAGE_SIZE));
      if (seq !== searchSeq) return; // the user kept typing
      set({ items: page.items, total: page.total, loaded: true, loading: false });
    } catch (e) {
      if (seq !== searchSeq) return;
      set({ loaded: true, loading: false, error: errorMessage(e) });
    }
  },

  loadMore: async () => {
    const { items, total, loadingMore, loading } = get();
    if (loadingMore || loading || items.length >= total) return;
    const seq = searchSeq;
    set({ loadingMore: true });
    try {
      const page = await telephony.directorySearch(toQuery(get().filters, items.length, PAGE_SIZE));
      if (seq !== searchSeq) return;
      set((s) => ({ items: [...s.items, ...page.items], total: page.total, loadingMore: false }));
    } catch (e) {
      if (seq === searchSeq) set({ loadingMore: false, error: errorMessage(e) });
    }
  },

  loadSources: async () => {
    try {
      const [sources, groups, departments] = await Promise.all([
        telephony.directorySources(),
        telephony.directoryGroups(),
        telephony.directoryDepartments(),
      ]);
      set((s) => ({
        sources,
        sourcesLoaded: true,
        groups,
        departments,
        // a group or department that no longer exists cannot stay selected
        filters: {
          ...s.filters,
          groupId: s.filters.groupId && groups.some((g) => g.id === s.filters.groupId) ? s.filters.groupId : null,
          department:
            s.filters.department && departments.some((d) => d.name === s.filters.department)
              ? s.filters.department
              : null,
        },
      }));
    } catch (e) {
      set({ sourcesLoaded: true });
      toast.error(errorMessage(e));
    }
  },

  refreshAll: async () => {
    await get().loadSources();
    const seq = ++searchSeq;
    const keep = Math.min(Math.max(get().items.length, PAGE_SIZE), 500);
    try {
      const page = await telephony.directorySearch(toQuery(get().filters, 0, keep));
      if (seq !== searchSeq) return;
      set({ items: page.items, total: page.total, loaded: true, error: null });
    } catch (e) {
      if (seq === searchSeq) set({ loaded: true, error: errorMessage(e) });
    }
  },

  toggleFavorite: async (entry) => {
    const favorite = !entry.favorite;
    // shown at once; the directory:changed event confirms it
    set((s) => ({ items: s.items.map((i) => (i.id === entry.id ? { ...i, favorite } : i)) }));
    try {
      await telephony.directorySetFavorite(recordIds(entry), favorite);
    } catch (e) {
      set((s) => ({ items: s.items.map((i) => (i.id === entry.id ? { ...i, favorite: !favorite } : i)) }));
      toast.error(errorMessage(e));
    }
  },

  createGroup: async (name) => {
    try {
      const g = await telephony.directoryCreateGroup(name);
      await get().loadSources();
      return g;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  },

  renameGroup: async (id, name) => {
    try {
      await telephony.directoryRenameGroup(id, name);
      await get().loadSources();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  },

  deleteGroup: async (id) => {
    try {
      await telephony.directoryDeleteGroup(id);
      if (get().filters.groupId === id) set((s) => ({ filters: { ...s.filters, groupId: null } }));
      await get().refreshAll();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  },

  addToGroup: async (groupId, entries) => {
    try {
      await telephony.directoryGroupAdd(groupId, entries.flatMap(recordIds));
      await get().refreshAll();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  },

  removeFromGroup: async (groupId, entries) => {
    try {
      await telephony.directoryGroupRemove(groupId, entries.flatMap(recordIds));
      await get().refreshAll();
      return true;
    } catch (e) {
      toast.error(errorMessage(e));
      return false;
    }
  },

  setSelecting: (selecting) => set({ selecting, selection: selecting ? get().selection : [] }),
  toggleSelected: (id) =>
    set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] })),
  clearSelection: () => set({ selection: [] }),
}));
