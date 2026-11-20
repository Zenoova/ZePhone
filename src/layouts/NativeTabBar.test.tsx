import { act, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  install: vi.fn(),
  select: vi.fn(),
  badge: vi.fn(),
  visible: vi.fn(),
  onSelected: vi.fn(),
}));
vi.mock("@/lib/native-tabbar", () => ({ nativeTabbar: native }));

import { useCallsStore } from "@/stores/calls-store";
import { useHistoryStore } from "@/stores/history-store";
import { useUiStore } from "@/stores/ui-store";
import { makeCall, makeHistory } from "@/test/fixtures";

import { NativeTabBar } from "./NativeTabBar";

let tapTab: (id: string) => void = () => {};

beforeEach(() => {
  for (const f of Object.values(native)) f.mockReset();
  native.install.mockResolvedValue(undefined);
  native.select.mockResolvedValue(undefined);
  native.badge.mockResolvedValue(undefined);
  native.visible.mockResolvedValue(undefined);
  native.onSelected.mockImplementation(async (handler: (id: string) => void) => {
    tapTab = handler;
    return () => {};
  });
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "dialer", callHidden: false });
  useHistoryStore.setState({ entries: [], seenAt: "" });
});

describe("NativeTabBar", () => {
  it("describes the five sections to the system's tab bar, with an SF Symbol each", async () => {
    render(<NativeTabBar />);
    await waitFor(() => expect(native.install).toHaveBeenCalledTimes(1));
    const tabs = native.install.mock.calls[0]![0] as Array<{ id: string; title: string; symbol: string }>;
    expect(tabs.map((t) => t.id)).toEqual(["dialer", "contacts", "history", "recordings", "settings"]);
    expect(tabs.every((t) => t.title.length > 0 && t.symbol.length > 0)).toBe(true);
  });

  it("opens the section of the tab that is tapped, and follows the page's own navigation", async () => {
    render(<NativeTabBar />);
    await waitFor(() => expect(native.select).toHaveBeenCalledWith("dialer"));
    act(() => tapTab("history"));
    expect(useUiStore.getState().section).toBe("history");
    act(() => useUiStore.getState().setSection("settings"));
    await waitFor(() => expect(native.select).toHaveBeenLastCalledWith("settings"));
  });

  it("shows the missed calls on the History tab", async () => {
    useHistoryStore.setState({ entries: [makeHistory({ result: "missed" })], seenAt: "" });
    render(<NativeTabBar />);
    await waitFor(() => expect(native.badge).toHaveBeenCalledWith("history", 1));
  });

  it("goes away behind the call screen and comes back when it is put away", async () => {
    render(<NativeTabBar />);
    await waitFor(() => expect(native.visible).toHaveBeenLastCalledWith(true));
    act(() => useCallsStore.setState({ calls: { call1: makeCall({ state: "connected" }) } }));
    await waitFor(() => expect(native.visible).toHaveBeenLastCalledWith(false));
    act(() => useUiStore.getState().setCallHidden(true));
    await waitFor(() => expect(native.visible).toHaveBeenLastCalledWith(true));
  });
});
