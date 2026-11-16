import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { makeAccount, makeStatus } from "@/test/fixtures";

import { selectDefaultAccount, summarizeRegistration, useAccountsStore } from "./accounts-store";

beforeEach(() => useAccountsStore.setState({ accounts: [], statuses: {}, loaded: false }));

describe("account statuses", () => {
  it("hydrates and applies real-time status updates", () => {
    const { hydrate, applyStatus } = useAccountsStore.getState();
    hydrate([makeAccount()], [makeStatus({ state: "connecting", sipCode: null })]);
    expect(useAccountsStore.getState().statuses.acc1?.state).toBe("connecting");
    applyStatus(makeStatus({ state: "error", sipCode: 403, message: "Access denied (403)" }));
    expect(useAccountsStore.getState().statuses.acc1).toMatchObject({ state: "error", sipCode: 403 });
  });
});

describe("summarizeRegistration", () => {
  const a = makeAccount({ id: "a", label: "A", isDefault: true });
  const b = makeAccount({ id: "b", label: "B", isDefault: false });

  it("reports no account", () => {
    expect(summarizeRegistration([], {}).state).toBe("none");
  });
  it("prefers a registered account, favouring the default", () => {
    const s = summarizeRegistration([a, b], { a: makeStatus({ accountId: "a" }), b: makeStatus({ accountId: "b" }) });
    expect(s).toMatchObject({ state: "registered", label: "A" });
    const s2 = summarizeRegistration([a, b], {
      a: makeStatus({ accountId: "a", state: "error" }),
      b: makeStatus({ accountId: "b" }),
    });
    expect(s2).toMatchObject({ state: "registered", label: "B" });
  });
  it("falls back to connecting, then error, then disconnected", () => {
    expect(summarizeRegistration([a], { a: makeStatus({ accountId: "a", state: "connecting" }) }).state).toBe(
      "connecting",
    );
    expect(summarizeRegistration([a], { a: makeStatus({ accountId: "a", state: "error", sipCode: 401 }) }).state).toBe(
      "error",
    );
    expect(summarizeRegistration([a], {}).state).toBe("disconnected");
  });
  it("ignores disabled accounts for the live state", () => {
    const off = makeAccount({ id: "off", enabled: false });
    expect(summarizeRegistration([off], { off: makeStatus({ accountId: "off" }) }).state).toBe("disconnected");
  });
});

describe("selectDefaultAccount", () => {
  it("returns the flagged default or the first", () => {
    const x = makeAccount({ id: "x", isDefault: false });
    const y = makeAccount({ id: "y", isDefault: true });
    expect(selectDefaultAccount([x, y])?.id).toBe("y");
    expect(selectDefaultAccount([x])?.id).toBe("x");
    expect(selectDefaultAccount([])).toBeUndefined();
  });
});
