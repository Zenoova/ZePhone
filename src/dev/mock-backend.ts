/**
 * DEV-ONLY preview of the UI without the Rust backend: `npm run dev` then open
 * http://localhost:1420/?mock in a normal browser.
 *
 * It replaces Tauri's IPC bridge with an in-memory fake so layouts, states and
 * responsive behaviour can be reviewed. It is loudly flagged in the UI/console and is
 * compiled out of production builds (`import.meta.env.DEV`). It simulates nothing of
 * SIP: real telephony only exists in the Tauri app.
 */
import { createMockDirectory } from "./mock-directory";
import { DEFAULT_SETTINGS } from "@/stores/settings-store";
import { createMockAudio } from "./mock-audio";
import { createMockShortcuts } from "./mock-shortcuts";
import type {
  AccountStatus,
  AccountView,
  AudioDevices,
  Call,
  CallStatsSample,
  Contact,
  HistoryEntry,
  Recording,
  Settings,
} from "@/types/telephony";

type Handler = (payload: unknown) => void;
type Args = Record<string, unknown> | undefined;

const now = () => new Date().toISOString();
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

export function installMockBackend(): void {
  const listeners = new Map<string, Array<{ id: number; handler: number }>>();
  let nextListenerId = 1;
  let nextCallbackId = 1;
  let callSeq = 1;

  const emit = (event: string, payload: unknown) => {
    for (const l of listeners.get(event) ?? []) {
      const cb = (window as unknown as Record<string, Handler | undefined>)[`_${l.handler}`];
      cb?.({ event, id: l.id, payload });
    }
  };

  let accounts: AccountView[] = [
    {
      id: "acc1",
      label: "Bureau",
      displayName: "Ada Lovelace",
      server: "sip.example.com",
      port: 5061,
      domain: "example.com",
      username: "1001",
      authUsername: null,
      transport: "tls",
      outboundProxy: null,
      registerInterval: 300,
      mediaEncryption: "srtp",
      enabled: true,
      isDefault: true,
      hasPassword: true,
    },
    {
      id: "acc2",
      label: "Mobile VoIP",
      displayName: null,
      server: "voip.operateur.fr",
      port: 5060,
      domain: "voip.operateur.fr",
      username: "0987654321",
      authUsername: "user_0987654321",
      transport: "udp",
      outboundProxy: null,
      registerInterval: 300,
      mediaEncryption: "none",
      enabled: true,
      isDefault: false,
      hasPassword: true,
    },
  ];
  const statuses: Record<string, AccountStatus> = {
    acc1: { accountId: "acc1", state: "registered", sipCode: 200, reason: "OK", message: null, updatedAt: now() },
    acc2: {
      accountId: "acc2",
      state: "error",
      sipCode: 403,
      reason: "Forbidden",
      message: "Accès refusé (403) : le serveur rejette ce compte ou ce mot de passe",
      updatedAt: now(),
    },
  };
  let contacts: Contact[] = [
    {
      id: "c1",
      firstName: "Bob",
      lastName: "Martin",
      company: "Acme",
      number: "1002",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "c2",
      firstName: "Alice",
      lastName: "Durand",
      company: null,
      number: "+33 6 12 34 56 78",
      createdAt: now(),
      updatedAt: now(),
    },
    {
      id: "c3",
      firstName: "",
      lastName: "",
      company: "Standard Acme",
      number: "sip:standard@example.com",
      createdAt: now(),
      updatedAt: now(),
    },
  ];
  let history: HistoryEntry[] = [
    h("h1", "incoming", "missed", "2000", null, 12, 0),
    h("h2", "outgoing", "answered", "1002", "Bob Martin", 95, 342),
    h("h3", "incoming", "answered", "+33612345678", "Alice Durand", 300, 62),
    h("h4", "outgoing", "failed", "1099", null, 1500, 0, 404, "Compte ou domaine introuvable sur le serveur (404)"),
    h("h5", "incoming", "rejected", "3000", null, 3000, 0),
  ];
  let settings: Settings = {
    audio: { ...DEFAULT_SETTINGS.audio },
    notifications: { incomingCall: true, missedCall: true, ringtone: true },
    general: {
      theme: "system",
      launchAtLogin: false,
      startMinimized: false,
      closeToTray: true,
      showTrayIcon: true,
      translucent: true,
      voiceOrb: "shdr-32",
      doNotDisturb: false,
    },
    network: { customCaFile: null, sipTrace: false, localSipPort: null, netInterface: null },
    recording: { autoRecord: true },
  };
  const calls = new Map<string, Call>();
  const devices: AudioDevices = {
    inputs: [
      { name: "MacBook Pro Microphone", isDefault: true, selectable: true },
      { name: "USB Headset", isDefault: false, selectable: true },
    ],
    outputs: [
      { name: "MacBook Pro Speakers", isDefault: true, selectable: true },
      { name: "AirPods Pro", isDefault: false, selectable: true },
    ],
  };

  function h(
    id: string,
    direction: HistoryEntry["direction"],
    result: HistoryEntry["result"],
    number: string,
    name: string | null,
    minutesAgo: number,
    secs: number,
    sipCode: number | null = null,
    reason: string | null = null,
  ): HistoryEntry {
    return {
      id,
      accountId: "acc1",
      accountLabel: "Bureau",
      remoteUri: `sip:${number}@example.com`,
      remoteNumber: number,
      contactName: name,
      direction,
      result,
      startedAt: ago(minutesAgo),
      answeredAt: secs ? ago(minutesAgo) : null,
      endedAt: ago(minutesAgo - 1),
      durationSecs: secs,
      sipCode,
      reason,
    };
  }

  // Fake speech-like levels (dBFS) for connected calls, to review the voice animation.
  let tick = 0;
  setInterval(() => {
    tick += 1;
    for (const c of calls.values()) {
      if (c.state !== "connected") continue;
      const speaking = Math.sin(tick / 9) + Math.sin(tick / 4.3) * 0.6 > -0.2; // phrases and pauses
      const rx = speaking ? -34 + Math.abs(Math.sin(tick / 1.7)) * 20 + Math.random() * 6 : -80 + Math.random() * 6;
      const talkingBack = Math.sin(tick / 11 + 2) + Math.sin(tick / 5.1) * 0.5 > 0.5;
      const tx = c.muted ? -96 : talkingBack ? -32 + Math.abs(Math.sin(tick / 1.3)) * 18 + Math.random() * 5 : -78;
      emit("audio:level", { callId: c.id, tx: false, db: rx });
      emit("audio:level", { callId: c.id, tx: true, db: tx });
    }
  }, 62);

  // Fake call statistics, one second apart: a steady call with a glitch every 9 s, to review the charts.
  const statsHistory = new Map<string, CallStatsSample[]>();
  const statsSince = new Map<string, number>();
  let statsTick = 0;
  setInterval(() => {
    statsTick += 1;
    for (const c of calls.values()) {
      if (c.state !== "connected") continue;
      const list = statsHistory.get(c.id) ?? [];
      const t0 = statsSince.get(c.id) ?? Date.now();
      statsSince.set(c.id, t0);
      const glitch = statsTick % 9 === 0;
      const prev = list.at(-1)?.totals;
      const rxPackets = (prev?.rxPackets ?? 0) + (glitch ? 47 : 50);
      const sample: CallStatsSample = {
        callId: c.id,
        atMs: Date.now(),
        elapsedSecs: (Date.now() - t0) / 1000,
        rxPackets: glitch ? 47 : 50,
        txPackets: 50,
        rxBitrate: glitch ? 60_000 : 64_000,
        txBitrate: 64_000,
        rxJitterMs: 3 + Math.random() * 3 + (glitch ? 28 : 0),
        txJitterMs: 2 + Math.random() * 2,
        rttMs: 28 + Math.random() * 8,
        jbufDelayMs: glitch ? 90 : 40 + Math.random() * 8,
        jbufPackets: 2,
        jbufSkewMs: 0,
        jbufLost: glitch ? 1 : 0,
        jbufLate: glitch ? 2 : 0,
        jbufOverflow: 0,
        jbufFlush: 0,
        jbufOutOfSeq: 0,
        rxGapMaxMs: glitch ? 62 : 20 + Math.random() * 3,
        txGapMaxMs: 20 + Math.random() * 4,
        rxLateBlocks: glitch ? 1 : 0,
        txLateBlocks: 0,
        rxBusyMaxUs: 20 + Math.random() * 30,
        txBusyMaxUs: 15 + Math.random() * 20,
        recDropped: 0,
        totals: {
          codec: "PCMA",
          txCodec: "PCMA",
          clockRate: 8000,
          rxPackets,
          txPackets: (prev?.txPackets ?? 0) + 50,
          rxBytes: rxPackets * 160,
          txBytes: ((prev?.txPackets ?? 0) + 50) * 160,
          rxErrors: 0,
          txErrors: 0,
          rxLost: (prev?.rxLost ?? 0) + (glitch ? 1 : 0),
          lossPct: 0.4,
          jbufLost: (prev?.jbufLost ?? 0) + (glitch ? 1 : 0),
          jbufLate: (prev?.jbufLate ?? 0) + (glitch ? 2 : 0),
          jbufOverflow: 0,
          jbufFlush: 0,
          rxLateBlocks: (prev?.rxLateBlocks ?? 0) + (glitch ? 1 : 0),
          txLateBlocks: 0,
          recDropped: 0,
        },
      };
      statsHistory.set(c.id, [...list, sample].slice(-900));
      emit("call:stats", sample);
    }
  }, 1000);

  // Sample recordings for the preview: short tone bursts, as real WAV files the player can read.
  const toneWav = (secs: number, hz: number): string => {
    const rate = 8000;
    const n = rate * secs;
    const buf = new ArrayBuffer(44 + n * 2);
    const v = new DataView(buf);
    const text = (o: number, s: string) => [...s].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    text(0, "RIFF");
    v.setUint32(4, 36 + n * 2, true);
    text(8, "WAVEfmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);
    v.setUint16(22, 1, true);
    v.setUint32(24, rate, true);
    v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    text(36, "data");
    v.setUint32(40, n * 2, true);
    for (let i = 0; i < n; i++) {
      const gate = Math.sin(i / rate / 0.9) > -0.3 ? 1 : 0.04; // phrases and pauses
      v.setInt16(44 + i * 2, Math.sin((2 * Math.PI * hz * i) / rate) * 7000 * gate, true);
    }
    return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
  };
  const wave = (secs: number): number[] =>
    Array.from({ length: 96 }, (_, i) =>
      Math.round(255 * Math.min(1, 0.15 + Math.abs(Math.sin(i / 7 + secs)) * 0.9 * Math.abs(Math.sin(i / 3)))),
    );
  const rec = (
    id: string,
    secs: number,
    number: string,
    name: string | null,
    dir: "incoming" | "outgoing",
    ago: number,
  ) => ({
    id,
    historyId: null,
    fileName: `${id}.wav`,
    path: toneWav(secs, 300 + secs * 3),
    startedAt: new Date(Date.now() - ago * 60_000).toISOString(),
    durationSecs: secs,
    sizeBytes: secs * 32_000,
    remoteNumber: number,
    remoteName: name,
    accountLabel: "Bureau",
    direction: dir,
    peaks: wave(secs),
  });
  let recordings: Recording[] = [
    rec("r1", 42, "1002", "Bob Martin", "outgoing", 30),
    rec("r2", 215, "+33612345678", "Alice Durand", "incoming", 60 * 26),
    rec("r3", 9, "2000", null, "incoming", 60 * 80),
  ];

  const engine = () => ({ name: "baresip", version: "4.13.0", codecs: ["PCMU", "PCMA"], state: "running" as const });
  const setCall = (c: Call) => {
    calls.set(c.id, c);
    emit("call:update", c);
  };
  const patch = (id: string, p: Partial<Call>) => {
    const c = calls.get(id);
    if (c) setCall({ ...c, ...p });
  };
  const finish = (id: string, state: "ended" | "failed", extra: Partial<Call> = {}) => {
    const c = calls.get(id);
    if (!c) return;
    const secs = c.connectedAt ? Math.floor((Date.now() - new Date(c.connectedAt).getTime()) / 1000) : 0;
    setCall({ ...c, state, endedAt: now(), durationSecs: secs, ...extra });
    calls.delete(id);
  };

  const directory = createMockDirectory(emit, () => contacts);
  const commands: Record<string, (a: Args) => unknown> = {
    ...directory,
    ...createMockShortcuts(),
    ...createMockAudio(emit),
    get_snapshot: () => ({ engine: engine(), accounts, statuses: Object.values(statuses), calls: [...calls.values()] }),
    get_app_info: () => ({
      name: "zephone",
      version: "0.1.0 (aperçu)",
      tauriVersion: "2.x",
      os: "macos",
      arch: "aarch64",
      dataDir: "~/Library/Application Support/app.zephone.softphone",
      engine: engine(),
    }),
    list_accounts: () => accounts,
    save_account: (a) => {
      const input = a?.input as Record<string, unknown>;
      const id = (input.id as string | null) ?? `acc${accounts.length + 1}-${Date.now()}`;
      const view = {
        ...(accounts.find((x) => x.id === id) ?? { isDefault: accounts.length === 0 }),
        ...input,
        id,
        port: input.port ?? 5060,
        domain: input.domain ?? input.server,
        label: (input.label as string) || `${input.username}@${input.server}`,
        hasPassword: Boolean(input.password) || Boolean(accounts.find((x) => x.id === id)?.hasPassword),
      } as AccountView;
      accounts = accounts.some((x) => x.id === id)
        ? accounts.map((x) => (x.id === id ? view : x))
        : [...accounts, view];
      statuses[id] = {
        accountId: id,
        state: "connecting",
        sipCode: null,
        reason: null,
        message: null,
        updatedAt: now(),
      };
      setTimeout(() => {
        statuses[id] = {
          accountId: id,
          state: "registered",
          sipCode: 200,
          reason: "OK",
          message: null,
          updatedAt: now(),
        };
        emit("account:status", statuses[id]);
      }, 900);
      emit("account:status", statuses[id]);
      return view;
    },
    delete_account: (a) => void (accounts = accounts.filter((x) => x.id !== a?.id)),
    set_default_account: (a) => void (accounts = accounts.map((x) => ({ ...x, isDefault: x.id === a?.id }))),
    set_account_enabled: (a) =>
      void (accounts = accounts.map((x) => (x.id === a?.id ? { ...x, enabled: Boolean(a?.enabled) } : x))),
    connect_account: (a) => {
      const id = a?.id as string;
      statuses[id] = {
        accountId: id,
        state: "registered",
        sipCode: 200,
        reason: "OK",
        message: null,
        updatedAt: now(),
      };
      emit("account:status", statuses[id]);
    },
    disconnect_account: (a) => {
      const id = a?.id as string;
      statuses[id] = {
        accountId: id,
        state: "disconnected",
        sipCode: null,
        reason: null,
        message: null,
        updatedAt: now(),
      };
      emit("account:status", statuses[id]);
    },

    dial: (a) => {
      const id = `call${callSeq++}`;
      const target = String(a?.target ?? "");
      const contact = contacts.find((c) => c.number.replace(/\s/g, "") === target.replace(/\s/g, ""));
      const base: Call = {
        id,
        accountId: "acc1",
        accountLabel: "Bureau",
        direction: "outgoing",
        state: "initializing",
        remoteUri: `sip:${target}@example.com`,
        remoteNumber: target,
        remoteName: contact ? `${contact.firstName} ${contact.lastName}`.trim() : null,
        muted: false,
        recording: false,
        heldLocally: false,
        heldRemotely: false,
        createdAt: now(),
        connectedAt: null,
        endedAt: null,
        durationSecs: 0,
        sipCode: null,
        reason: null,
      };
      calls.set(id, base);
      setTimeout(() => patch(id, { state: "dialing" }), 250);
      setTimeout(() => patch(id, { state: "ringing" }), 900);
      setTimeout(() => {
        if (target === "486") finish(id, "failed", { sipCode: 486, reason: "Occupé (486)" });
        else patch(id, { state: "connected", connectedAt: now() });
      }, 2200);
      return base;
    },
    answer_call: (a) => patch(String(a?.id), { state: "connected", connectedAt: now() }),
    reject_call: (a) => finish(String(a?.id), "ended"),
    hangup_call: (a) => finish(String(a?.id), "ended"),
    hold_call: (a) => patch(String(a?.id), { state: "onHold", heldLocally: true }),
    resume_call: (a) => patch(String(a?.id), { state: "connected", heldLocally: false }),
    set_call_mute: (a) => patch(String(a?.id), { muted: Boolean(a?.muted) }),
    list_recordings: () => recordings,
    delete_recording: (a) => {
      recordings = recordings.filter((r) => r.id !== a?.id);
      emit("recordings:changed", null);
    },
    set_audio_gains: () => undefined,
    get_call_stats: (a) => statsHistory.get(String(a?.callId)) ?? [],
    open_call_window: () => undefined,
    close_call_window: () => undefined,
    set_call_window_on_top: () => undefined,
    show_main: () => undefined,
    send_dtmf: () => undefined,
    transfer_call: () => undefined,

    list_contacts: (a) => {
      const q = String(a?.query ?? "").toLowerCase();
      return contacts.filter(
        (c) => !q || `${c.firstName} ${c.lastName} ${c.company ?? ""} ${c.number}`.toLowerCase().includes(q),
      );
    },
    save_contact: (a) => {
      const i = a?.input as Record<string, string | null>;
      const c = {
        id: i.id ?? `c${Date.now()}`,
        firstName: i.firstName ?? "",
        lastName: i.lastName ?? "",
        company: i.company ?? null,
        number: i.number ?? "",
        createdAt: now(),
        updatedAt: now(),
      } as Contact;
      contacts = contacts.some((x) => x.id === c.id) ? contacts.map((x) => (x.id === c.id ? c : x)) : [...contacts, c];
      return c;
    },
    delete_contact: (a) => void (contacts = contacts.filter((c) => c.id !== a?.id)),
    list_history: (a) => {
      const f = (a?.filter ?? {}) as { kind?: string; query?: string | null };
      return history.filter(
        (e) =>
          (!f.kind ||
            f.kind === "all" ||
            (f.kind === "missed"
              ? e.result === "missed"
              : f.kind === "failed"
                ? ["failed", "rejected", "cancelled"].includes(e.result)
                : e.direction === f.kind)) &&
          (!f.query || `${e.remoteNumber} ${e.contactName ?? ""}`.toLowerCase().includes(f.query.toLowerCase())),
      );
    },
    delete_history_entry: (a) => void (history = history.filter((e) => e.id !== a?.id)),
    clear_history: () => void (history = []),

    get_settings: () => settings,
    update_settings: (a) => {
      settings = a?.settings as Settings;
      emit("settings:changed", settings);
      return { settings, restartRequired: false };
    },
    list_audio_devices: () => devices,
    get_microphone_permission: () => "authorized",
    request_microphone_permission: () => "authorized",
    open_microphone_settings: () => undefined,
    restart_engine: () => undefined,
    get_engine_log: () => [
      "baresip v4.13.0 (aperçu : journal factice)",
      "aucodec: PCMU/8000/1",
      "aucodec: PCMA/8000/1",
      "baresip is ready.",
    ],
    quit_app: () => undefined,
  };

  const internals = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main", windowLabel: "main" } },
    transformCallback(cb: Handler): number {
      const id = nextCallbackId++;
      (window as unknown as Record<string, Handler>)[`_${id}`] = cb;
      return id;
    },
    unregisterCallback(id: number) {
      delete (window as unknown as Record<string, unknown>)[`_${id}`];
    },
    convertFileSrc: (p: string) => p,
    invoke: async (cmd: string, args?: Args): Promise<unknown> => {
      if (cmd === "plugin:event|listen") {
        const { event, handler } = args as { event: string; handler: number };
        const id = nextListenerId++;
        listeners.set(event, [...(listeners.get(event) ?? []), { id, handler }]);
        return id;
      }
      if (cmd === "plugin:event|unlisten") {
        const { event, eventId } = args as { event: string; eventId: number };
        listeners.set(
          event,
          (listeners.get(event) ?? []).filter((l) => l.id !== eventId),
        );
        return undefined;
      }
      const fn = commands[cmd];
      if (!fn) throw { kind: "other", message: `Commande inconnue dans l'aperçu : ${cmd}` };
      return fn(args);
    },
  };

  Object.assign(window, {
    __TAURI_INTERNALS__: internals,
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: () => {} },
    /** Console helpers to exercise states: `__mock.incoming()`, `__mock.regError(401)`. */
    __mock: {
      incoming(name: string | null = "Alice Durand", number = "+33612345678") {
        const id = `call${callSeq++}`;
        setCall({
          id,
          accountId: "acc1",
          accountLabel: "Bureau",
          direction: "incoming",
          state: "incoming",
          remoteUri: `sip:${number}@example.com`,
          remoteNumber: number,
          remoteName: name,
          muted: false,
          recording: false,
          heldLocally: false,
          heldRemotely: false,
          createdAt: now(),
          connectedAt: null,
          endedAt: null,
          durationSecs: 0,
          sipCode: null,
          reason: null,
        });
        return id;
      },
      regError(code = 401, state: AccountStatus["state"] = "error") {
        const s = {
          accountId: "acc1",
          state,
          sipCode: code,
          reason: "Unauthorized",
          message: `Authentification refusée (${code})`,
          updatedAt: now(),
        };
        statuses["acc1"] = s;
        emit("account:status", s);
      },
      engine(state: "restarting" | "failed" | "running") {
        emit(
          "engine:state",
          state === "running"
            ? engine()
            : state === "failed"
              ? { ...engine(), state, reason: "binaire manquant" }
              : { ...engine(), state, attempt: 1, reason: "crash" },
        );
      },
      emit,
    },
  });
  document.documentElement.dataset.preview = "1";
  console.warn("[ZePhone] APERÇU HORS-LIGNE : backend simulé en mémoire, aucune communication SIP réelle.");
}
