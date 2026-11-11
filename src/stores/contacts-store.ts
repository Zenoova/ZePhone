import { toast } from "sonner";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { Contact, ContactInput } from "@/types/telephony";

interface ContactsState {
  contacts: Contact[];
  query: string;
  loaded: boolean;
  load: (query?: string) => Promise<void>;
  setQuery: (q: string) => void;
  save: (input: ContactInput) => Promise<Contact | null>;
  remove: (id: string) => Promise<void>;
}

export const useContactsStore = create<ContactsState>((set, get) => ({
  contacts: [],
  query: "",
  loaded: false,
  load: async (query) => {
    const q = query ?? get().query;
    try {
      const contacts = await telephony.listContacts(q || undefined);
      // Ignore stale responses (the user kept typing).
      if (q === get().query) set({ contacts, loaded: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
  setQuery: (query) => set({ query }),
  save: async (input) => {
    try {
      const saved = await telephony.saveContact(input);
      await get().load();
      return saved;
    } catch (e) {
      toast.error(errorMessage(e));
      return null;
    }
  },
  remove: async (id) => {
    try {
      await telephony.deleteContact(id);
      await get().load();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  },
}));
