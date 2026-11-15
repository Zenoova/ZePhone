import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useCallsStore } from "@/stores/calls-store";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";
import { makeCall } from "@/test/fixtures";

import { CallWindow } from "./CallWindow";

const show = () =>
  render(
    <>
      <CallWindow />
    </>,
  );

const connected = (over = {}) => makeCall({ state: "connected", connectedAt: new Date().toISOString(), ...over });

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string, args: { settings?: unknown }) =>
    cmd === "update_settings" ? { settings: args.settings, restartRequired: false } : undefined,
  );
  Object.values(toast).forEach((f) => f.mockReset());
  useCallsStore.setState({ calls: {}, dialing: false });
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});

describe("CallWindow", () => {
  it("shows the call on the full call screen with the toolbar at the top right", () => {
    useCallsStore.setState({ calls: { call1: connected() } });
    show();
    expect(screen.getByTestId("call-panel")).toBeInTheDocument();
    const names = within(screen.getByTestId("call-toolbar"))
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual(["Enregistrer l'appel", "Volume du son", "Options de l'appel"]);
  });

  it("an incoming call rings in this window, with its answer and reject buttons", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "incoming", direction: "incoming" }) } });
    show();
    expect(screen.getByRole("button", { name: /Répondre/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Refuser/ })).toBeInTheDocument();
  });

  it("keeps a call that just ended on screen, then closes itself", async () => {
    vi.useFakeTimers();
    try {
      useCallsStore.setState({ calls: { call1: makeCall({ state: "ended", durationSecs: 5 }) } });
      show();
      expect(screen.getByTestId("call-panel")).toHaveAttribute("data-state", "ended");
      expect(invoke).not.toHaveBeenCalledWith("close_call_window", undefined);
      act(() => useCallsStore.setState({ calls: {} }));
      await act(() => vi.advanceTimersByTimeAsync(10));
      expect(invoke).toHaveBeenCalledWith("close_call_window", undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives up when no call ever shows up", async () => {
    vi.useFakeTimers();
    try {
      show();
      expect(screen.getByTestId("call-window-empty")).toBeInTheDocument();
      await act(() => vi.advanceTimersByTimeAsync(3900));
      expect(invoke).not.toHaveBeenCalledWith("close_call_window", undefined);
      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(invoke).toHaveBeenCalledWith("close_call_window", undefined);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists the other calls as compact lines under the toolbar", () => {
    useCallsStore.setState({
      calls: {
        call1: connected(),
        call2: makeCall({ id: "call2", state: "incoming", direction: "incoming", remoteNumber: "2000" }),
      },
    });
    show();
    expect(screen.getAllByTestId("call-panel")).toHaveLength(1);
    expect(screen.getByText(/2000/)).toBeInTheDocument();
  });
});

describe("the toolbar", () => {
  it("starts the recording of an established call, and shows when it is on", async () => {
    useCallsStore.setState({ calls: { call1: connected() } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer l'appel" }));
    expect(invoke).toHaveBeenCalledWith("start_recording", { id: "call1" });

    act(() => useCallsStore.setState({ calls: { call1: connected({ recording: true }) } }));
    expect(screen.getByTestId("rec-indicator")).toBeInTheDocument();
    invoke.mockResolvedValueOnce({ id: "r1" });
    fireEvent.click(screen.getByRole("button", { name: "Arrêter l'enregistrement" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(invoke).toHaveBeenCalledWith("stop_recording", undefined);
  });

  it("says so when nothing was recorded", async () => {
    useCallsStore.setState({ calls: { call1: connected({ recording: true }) } });
    show();
    invoke.mockResolvedValueOnce(null);
    fireEvent.click(screen.getByRole("button", { name: "Arrêter l'enregistrement" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
  });

  it("cannot start a recording before the call is established", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "ringing" }) } });
    show();
    expect(screen.getByRole("button", { name: "Enregistrer l'appel" })).toBeDisabled();
  });

  it("opens the options: developer ones and a few others", async () => {
    useCallsStore.setState({ calls: { call1: connected() } });
    show();
    fireEvent.keyDown(screen.getByRole("button", { name: "Options de l'appel" }), { key: "Enter" });
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).toEqual([
      "Garder au premier plan",
      "Ouvrir ZePhone",
      "Informations de l'appel",
      "Journal du moteur SIP",
      "Copier l'identifiant de l'appel",
    ]);
  });

  it("shows what the backend knows about the call", async () => {
    useCallsStore.setState({ calls: { call1: connected() } });
    show();
    fireEvent.keyDown(screen.getByRole("button", { name: "Options de l'appel" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Informations de l'appel/ }));
    const info = await screen.findByTestId("call-info");
    expect(info).toHaveTextContent("call1");
    expect(info).toHaveTextContent("1002");
  });

  it("keeps the call window on top on request", async () => {
    useCallsStore.setState({ calls: { call1: connected() } });
    show();
    fireEvent.keyDown(screen.getByRole("button", { name: "Options de l'appel" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /Garder au premier plan/ }));
    expect(invoke).toHaveBeenCalledWith("set_call_window_on_top", { onTop: true });
  });
});
