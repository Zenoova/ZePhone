import { useEffect } from "react";
import { toast } from "@yusufceng1z/ding-react";

import { pushLevel } from "@/lib/audio-levels";
import { isTauri, subscribeTelephony, telephony } from "@/services/telephony";
import { useAccountsStore } from "@/stores/accounts-store";
import { useAudioStore } from "@/stores/audio-store";
import { useCallStatsStore } from "@/stores/call-stats-store";
import { useDirectoryStore } from "@/stores/directory-store";
import { isTerminal, useCallsStore } from "@/stores/calls-store";
import { useEngineStore } from "@/stores/engine-store";
import { useHistoryStore } from "@/stores/history-store";
import { useRecordingsStore } from "@/stores/recordings-store";
import { useSettingsStore } from "@/stores/settings-store";
import { useUiStore } from "@/stores/ui-store";

/**
 * Connects the stores to the Rust backend once: subscribes to every event first
 * (so nothing is missed), then loads a snapshot of the current state.
 */
export function useTelephonyBootstrap(): void {
  useEffect(() => {
    if (!isTauri()) {
      useUiStore.getState().setBackendUnavailable(true);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void (async () => {
      unsubscribe = await subscribeTelephony({
        onEngineState: (info) => useEngineStore.getState().apply(info),
        onAccountStatus: (status) => useAccountsStore.getState().applyStatus(status),
        onCallUpdate: (call) => {
          useCallsStore.getState().apply(call);
          if (isTerminal(call)) useCallStatsStore.getState().drop(call.id);
        },
        onHistoryChanged: () => void useHistoryStore.getState().load(),
        onAudioError: (message) => toast.error(`Erreur audio : ${message}`),
        onAudioLevel: (l) => pushLevel(l.callId, l.tx, l.db),
        onCallStats: (sample) => useCallStatsStore.getState().push(sample),
        onRecordingsChanged: () => void useRecordingsStore.getState().load(),
        onSettingsChanged: (s) => useSettingsStore.getState().adopt(s),
        onDirectoryChanged: () => void useDirectoryStore.getState().refreshAll(),
        onShellFocus: (target) => useUiStore.getState().requestFocus(target),
        onAudioState: (st) => useAudioStore.getState().apply(st),
        onHeadsetState: (st) => useAudioStore.getState().applyHeadset(st),
        onAudioTestLevel: (db) => useAudioStore.getState().pushLevel(db),
      });
      if (cancelled) {
        unsubscribe();
        return;
      }
      try {
        const snap = await telephony.getSnapshot();
        useAccountsStore.getState().hydrate(snap.accounts, snap.statuses);
        useCallsStore.getState().hydrate(snap.calls);
        useEngineStore.getState().apply(snap.engine);
      } catch (e) {
        toast.error(
          e instanceof Object && "message" in e ? String((e as { message: unknown }).message) : "Chargement impossible",
        );
      }
      void useSettingsStore.getState().load();
      void useHistoryStore.getState().load();
      void useRecordingsStore.getState().load();
      void useEngineStore.getState().loadAppInfo();
      void useSettingsStore.getState().refreshMic();
      void useDirectoryStore.getState().loadSources();
      void useAudioStore.getState().load();
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);
}
