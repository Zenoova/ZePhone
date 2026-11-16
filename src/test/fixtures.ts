import type { Account, AccountStatus, AccountView, Call, CallStatsSample, HistoryEntry } from "@/types/telephony";

export function makeCall(over: Partial<Call> = {}): Call {
  return {
    id: "call1",
    accountId: "acc1",
    accountLabel: "Bureau",
    direction: "outgoing",
    state: "dialing",
    remoteUri: "sip:1002@example.com",
    remoteNumber: "1002",
    remoteName: null,
    muted: false,
    recording: false,
    heldLocally: false,
    heldRemotely: false,
    createdAt: "2026-01-01T10:00:00Z",
    connectedAt: null,
    endedAt: null,
    durationSecs: 0,
    sipCode: null,
    reason: null,
    ...over,
  };
}

export function makeAccount(over: Partial<AccountView> = {}): AccountView {
  const base: Account = {
    id: "acc1",
    label: "Bureau",
    displayName: null,
    server: "sip.example.com",
    port: 5060,
    domain: "example.com",
    username: "1001",
    authUsername: null,
    transport: "udp",
    outboundProxy: null,
    registerInterval: 300,
    mediaEncryption: "none",
    enabled: true,
    isDefault: true,
  };
  return { ...base, hasPassword: true, ...over };
}

export function makeStatus(over: Partial<AccountStatus> = {}): AccountStatus {
  return {
    accountId: "acc1",
    state: "registered",
    sipCode: 200,
    reason: "OK",
    message: null,
    updatedAt: "2026-01-01T10:00:00Z",
    ...over,
  };
}

export function makeHistory(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: "h1",
    accountId: "acc1",
    accountLabel: "Bureau",
    remoteUri: "sip:1002@example.com",
    remoteNumber: "1002",
    contactName: null,
    direction: "incoming",
    result: "missed",
    startedAt: "2026-01-01T10:00:00Z",
    answeredAt: null,
    endedAt: "2026-01-01T10:00:08Z",
    durationSecs: 0,
    sipCode: null,
    reason: null,
    ...over,
  };
}

/** One healthy second of a call: 50 packets each way, steady 20 ms blocks, nothing lost. */
export function makeStats(over: Partial<CallStatsSample> = {}): CallStatsSample {
  const elapsedSecs = over.elapsedSecs ?? 10;
  return {
    callId: "call1",
    atMs: 1_700_000_000_000 + elapsedSecs * 1000,
    elapsedSecs,
    rxPackets: 50,
    txPackets: 50,
    rxBitrate: 64_000,
    txBitrate: 64_000,
    rxJitterMs: 2,
    txJitterMs: 2,
    rttMs: 30,
    jbufDelayMs: 40,
    jbufPackets: 2,
    jbufSkewMs: 0,
    jbufLost: 0,
    jbufLate: 0,
    jbufOverflow: 0,
    jbufFlush: 0,
    jbufOutOfSeq: 0,
    rxGapMaxMs: 21,
    txGapMaxMs: 21,
    rxLateBlocks: 0,
    txLateBlocks: 0,
    rxBusyMaxUs: 30,
    txBusyMaxUs: 20,
    recDropped: 0,
    totals: {
      codec: "PCMA",
      txCodec: "PCMA",
      clockRate: 8000,
      rxPackets: elapsedSecs * 50,
      txPackets: elapsedSecs * 50,
      rxBytes: elapsedSecs * 8000,
      txBytes: elapsedSecs * 8000,
      rxErrors: 0,
      txErrors: 0,
      rxLost: 0,
      lossPct: 0,
      jbufLost: 0,
      jbufLate: 0,
      jbufOverflow: 0,
      jbufFlush: 0,
      rxLateBlocks: 0,
      txLateBlocks: 0,
      recDropped: 0,
    },
    ...over,
  };
}

/** `n` consecutive seconds of a call, from second `from`; `edit` changes one of them. */
export function makeRun(
  n: number,
  edit: (i: number) => Partial<CallStatsSample> = () => ({}),
  from = 5,
): CallStatsSample[] {
  return Array.from({ length: n }, (_, i) => makeStats({ elapsedSecs: from + i, ...edit(i) }));
}
