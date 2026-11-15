import { toast } from "@yusufceng1z/ding-react";
import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { AccountInput, AccountStatus, AccountView, RegistrationState } from "@/types/telephony";

interface AccountsState {
  accounts: AccountView[];
  statuses: Record<string, AccountStatus>;
  loaded: boolean;
  hydrate: (accounts: AccountView[], statuses: AccountStatus[]) => void;
  applyStatus: (status: AccountStatus) => void;
  reload: () => Promise<void>;
  save: (input: AccountInput) => Promise<AccountView | null>;
  remove: (id: string) => Promise<boolean>;
  setDefault: (id: string) => Promise<void>;
  setEnabled: (id: string, enabled: boolean) => Promise<void>;
  connect: (id: string) => Promise<void>;
  disconnect: (id: string) => Promise<void>;
}

async function attempt<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    toast.error(errorMessage(e));
    return fallback;
  }
}

export const useAccountsStore = create<AccountsState>((set, get) => ({
  accounts: [],
  statuses: {},
  loaded: false,
  hydrate: (accounts, statuses) =>
    set({ accounts, statuses: Object.fromEntries(statuses.map((s) => [s.accountId, s])), loaded: true }),
  applyStatus: (status) => set((s) => ({ statuses: { ...s.statuses, [status.accountId]: status } })),
  reload: async () => {
    const accounts = await attempt(() => telephony.listAccounts(), get().accounts);
    set({ accounts, loaded: true });
  },
  save: async (input) => {
    const saved = await attempt(() => telephony.saveAccount(input), null);
    await get().reload();
    return saved;
  },
  remove: async (id) => {
    const ok = await attempt(async () => (await telephony.deleteAccount(id), true), false);
    if (ok)
      set((s) => {
        const { [id]: _removed, ...rest } = s.statuses;
        return { statuses: rest };
      });
    await get().reload();
    return ok;
  },
  setDefault: async (id) => {
    await attempt(() => telephony.setDefaultAccount(id), undefined);
    await get().reload();
  },
  setEnabled: async (id, enabled) => {
    await attempt(() => telephony.setAccountEnabled(id, enabled), undefined);
    await get().reload();
  },
  connect: async (id) => {
    await attempt(() => telephony.connectAccount(id), undefined);
  },
  disconnect: async (id) => {
    await attempt(() => telephony.disconnectAccount(id), undefined);
  },
}));

export function selectDefaultAccount(accounts: AccountView[]): AccountView | undefined {
  return accounts.find((a) => a.isDefault) ?? accounts[0];
}

/** Worst-to-best summary used by the always-visible connection indicator. */
export function summarizeRegistration(
  accounts: AccountView[],
  statuses: Record<string, AccountStatus>,
): { state: RegistrationState | "none"; label: string; status?: AccountStatus; account?: AccountView } {
  const enabled = accounts.filter((a) => a.enabled);
  if (accounts.length === 0) return { state: "none", label: "Aucun compte" };
  const def = selectDefaultAccount(enabled.length ? enabled : accounts);
  const pick = (state: RegistrationState) =>
    enabled.find((a) => statuses[a.id]?.state === state && a.id === def?.id) ??
    enabled.find((a) => statuses[a.id]?.state === state);
  for (const state of ["registered", "connecting", "error", "unconfigured"] as const) {
    const account = pick(state);
    if (account) return { state, label: account.label, status: statuses[account.id], account };
  }
  const account = def ?? accounts[0];
  return {
    state: "disconnected",
    label: account?.label ?? "",
    status: account ? statuses[account.id] : undefined,
    account,
  };
}
