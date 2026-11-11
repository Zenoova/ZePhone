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

  describe("layout", () => {
    it("puts every control in one aligned row, hang-up included", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      const group = screen.getByRole("group", { name: "Commandes de l'appel" });
      const labels = Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
      expect(labels).toEqual([
        "Couper le micro",
        "Mettre en attente",
        "Clavier (tonalités DTMF)",
        "Transférer l'appel",
        "Raccrocher",
      ]);
    });

    it("shows the remote voice orb and our own, and says whose is whose", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      expect(screen.getByTestId("orb-remote")).toBeInTheDocument();
      expect(screen.getByTestId("orb-local")).toBeInTheDocument();
      expect(screen.getByText("Vous")).toBeInTheDocument();
    });

    it("the keypad sits between the voices and the controls, hidden until asked for", () => {
      const { container } = show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      const keypad = screen.getByRole("group", { name: "Clavier numérique", hidden: true });
      const region = keypad.closest("[inert], [aria-hidden]") as HTMLElement;
      expect(region).toHaveAttribute("aria-hidden", "true");
      expect(region).toHaveAttribute("inert");

      fireEvent.click(screen.getByRole("button", { name: "Clavier (tonalités DTMF)" }));
      expect(region).toHaveAttribute("aria-hidden", "false");
      expect(region).not.toHaveAttribute("inert");
      // DOM order = visual order: orbs, keypad, controls.
      const order = [
        screen.getByTestId("orb-local"),
        region,
        screen.getByRole("group", { name: "Commandes de l'appel" }),
      ];
      for (let i = 0; i < order.length - 1; i++) {
        expect(order[i]!.compareDocumentPosition(order[i + 1]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      // The remote orb shrinks to make room.
      expect(screen.getByTestId("orb-remote").className).toContain("size-24");
      expect(container).toBeTruthy();
    });

    it("keyboard digits drive the keypad only while it is open", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      fireEvent.keyDown(window, { key: "4" });
      expect(invoke).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Clavier (tonalités DTMF)" }));
      fireEvent.keyDown(window, { key: "4" });
      expect(invoke).toHaveBeenLastCalledWith("send_dtmf", { id: "call1", digits: "4" });
    });

    it("a muted microphone is shown on our orb", () => {
      show(makeCall({ state: "connected", muted: true, connectedAt: new Date().toISOString() }));
      expect(screen.getByText("Micro coupé")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Réactiver le micro" })).toHaveAttribute("aria-pressed", "true");
    });

    it("an unanswered call has no controls to show once it is over", () => {
      show(makeCall({ state: "ended", durationSecs: 0 }));
      expect(screen.queryByRole("group", { name: "Commandes de l'appel" })).toBeNull();
    });
  });
});
