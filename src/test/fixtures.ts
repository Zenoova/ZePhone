import type { Account, AccountStatus, AccountView, Call, HistoryEntry } from "@/types/telephony";

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
