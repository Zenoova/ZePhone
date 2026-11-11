import { create } from "zustand";

import { errorMessage, telephony } from "@/services/telephony";
import type { AppInfo, EngineInfo } from "@/types/telephony";

interface EngineState {
  info: EngineInfo | null;
  appInfo: AppInfo | null;
  restarting: boolean;
  apply: (info: EngineInfo) => void;
  loadAppInfo: () => Promise<void>;
  restart: () => Promise<string | null>;
}

export const useEngineStore = create<EngineState>((set) => ({
  info: null,
  appInfo: null,
  restarting: false,
  apply: (info) => set({ info }),
  loadAppInfo: async () => {
    try {
      const appInfo = await telephony.getAppInfo();
      set({ appInfo, info: appInfo.engine });
    } catch {
      /* shown elsewhere */
    }
  },
  restart: async () => {
    set({ restarting: true });
    try {
      await telephony.restartEngine();
      return null;
    } catch (e) {
      return errorMessage(e);
    } finally {
      set({ restarting: false });
    }
  },
}));

/** Is the SIP engine up and usable? */
export function isEngineRunning(info: EngineInfo | null): boolean {
  return info?.state === "running";
}
