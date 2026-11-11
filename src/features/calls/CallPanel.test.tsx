import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { makeCall } from "@/test/fixtures";
import type { Call } from "@/types/telephony";
import { useCallsStore } from "@/stores/calls-store";

import { CallPanel } from "./CallPanel";

function show(call: Call) {
  useCallsStore.setState({ calls: { [call.id]: call } });
  return render(
    <TooltipProvider>
      <CallPanel call={call} />
    </TooltipProvider>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("CallPanel", () => {
  it("shows the real call state at each stage", () => {
    const cases: Array<[Call["state"], string]> = [
      ["initializing", "Initialisation…"],
      ["dialing", "Appel en cours de composition…"],
      ["ringing", "Sonnerie…"],
      ["connected", "Connecté"],
      ["onHold", "En attente"],
      ["failed", "Échec"],
      ["ended", "Terminé"],
    ];
    for (const [state, label] of cases) {
      const { unmount } = show(makeCall({ state, connectedAt: "2026-01-01T10:00:00Z" }));
      expect(screen.getByRole("status")).toHaveTextContent(label);
      unmount();
    }
  });

  it("identifies the correspondent by name and number", () => {
    show(makeCall({ state: "connected", remoteName: "Bob Martin", remoteNumber: "1002" }));
    expect(screen.getByRole("heading", { name: "Bob Martin" })).toBeInTheDocument();
    expect(screen.getByText("1002")).toBeInTheDocument();
  });

  it("freezes the timer on the backend's duration once the call ended", () => {
    show(
      makeCall({
        state: "ended",
        connectedAt: "2026-01-01T10:00:00Z",
        endedAt: "2026-01-01T10:01:05Z",
        durationSecs: 65,
      }),
    );
    expect(screen.getByLabelText("Durée de l'appel")).toHaveTextContent("01:05");
  });

  it("outgoing connected call: mute, hold, hangup go to the backend", () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    fireEvent.click(screen.getByRole("button", { name: "Couper le micro" }));
    expect(invoke).toHaveBeenLastCalledWith("set_call_mute", { id: "call1", muted: true });
    fireEvent.click(screen.getByRole("button", { name: "Mettre en attente" }));
    expect(invoke).toHaveBeenLastCalledWith("hold_call", { id: "call1" });
    fireEvent.click(screen.getByRole("button", { name: "Raccrocher" }));
    expect(invoke).toHaveBeenLastCalledWith("hangup_call", { id: "call1" });
  });

  it("DTMF keypad sends digits during the call", () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    expect(screen.queryByRole("group", { name: "Clavier numérique" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clavier (tonalités DTMF)" }));
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    expect(invoke).toHaveBeenLastCalledWith("send_dtmf", { id: "call1", digits: "7" });
  });

  it("controls that need an established call are disabled while ringing", () => {
    show(makeCall({ state: "ringing" }));
    expect(screen.getByRole("button", { name: "Couper le micro" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transférer l'appel" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Raccrocher" })).toBeEnabled(); // can cancel
  });

  it("transfer opens a dialog and sends the target", async () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    fireEvent.click(screen.getByRole("button", { name: "Transférer l'appel" }));
    const input = await screen.findByLabelText("Destinataire");
    fireEvent.change(input, { target: { value: "1005" } });
    fireEvent.click(screen.getByRole("button", { name: /^Transférer$/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("transfer_call", { id: "call1", target: "1005" }));
  });

  it("incoming call offers answer and reject only", () => {
    show(makeCall({ state: "incoming", direction: "incoming" }));
    expect(screen.queryByRole("button", { name: "Raccrocher" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Répondre/ }));
    expect(invoke).toHaveBeenLastCalledWith("answer_call", { id: "call1" });
    fireEvent.click(screen.getByRole("button", { name: /Refuser/ }));
    expect(invoke).toHaveBeenLastCalledWith("reject_call", { id: "call1" });
  });

  it("failure shows the diagnostic reason", () => {
    show(makeCall({ state: "failed", reason: "Occupé (486)", sipCode: 486 }));
    expect(screen.getByText("Occupé (486)")).toBeInTheDocument();
  });
});
