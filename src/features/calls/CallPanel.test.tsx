import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { makeCall } from "@/test/fixtures";
import type { Call } from "@/types/telephony";
import { useCallsStore } from "@/stores/calls-store";

import { CallPanel } from "./CallPanel";

function show(call: Call) {
  useCallsStore.setState({ calls: { [call.id]: call } });
  return render(
    <>
      <CallPanel call={call} />
    </>,
  );
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("CallPanel", () => {
  it("shows the real call state at each stage", () => {
    const cases: Array<[Call["state"], string]> = [
      ["initializing", "Initializing…"],
      ["dialing", "Call being dialled…"],
      ["ringing", "Ringtone…"],
      ["connected", "Connected"],
      ["onHold", "On hold"],
      ["failed", "Failed"],
      ["ended", "Ended"],
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
    expect(screen.getByLabelText("Call duration")).toHaveTextContent("01:05");
  });

  it("outgoing connected call: mute, hold, hangup go to the backend", () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    fireEvent.click(screen.getByRole("button", { name: "Mute the microphone" }));
    expect(invoke).toHaveBeenLastCalledWith("set_call_mute", { id: "call1", muted: true });
    fireEvent.click(screen.getByRole("button", { name: "Put on hold" }));
    expect(invoke).toHaveBeenLastCalledWith("hold_call", { id: "call1" });
    fireEvent.click(screen.getByRole("button", { name: "Hang up" }));
    expect(invoke).toHaveBeenLastCalledWith("hangup_call", { id: "call1" });
  });

  it("DTMF keypad sends digits during the call", () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    expect(screen.queryByRole("group", { name: "Numeric keypad" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Keypad (DTMF tones)" }));
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    expect(invoke).toHaveBeenLastCalledWith("send_dtmf", { id: "call1", digits: "7" });
  });

  it("controls that need an established call are disabled while ringing", () => {
    show(makeCall({ state: "ringing" }));
    expect(screen.getByRole("button", { name: "Mute the microphone" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Transfer the call" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Hang up" })).toBeEnabled(); // can cancel
  });

  it("transfer opens a dialog and sends the target", async () => {
    show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
    fireEvent.click(screen.getByRole("button", { name: "Transfer the call" }));
    const input = await screen.findByLabelText("Recipient");
    fireEvent.change(input, { target: { value: "1005" } });
    fireEvent.click(screen.getByRole("button", { name: /^Transfer$/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenLastCalledWith("transfer_call", { id: "call1", target: "1005" }));
  });

  it("incoming call offers answer and reject only", () => {
    show(makeCall({ state: "incoming", direction: "incoming" }));
    expect(screen.queryByRole("button", { name: "Hang up" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Answer/ }));
    expect(invoke).toHaveBeenLastCalledWith("answer_call", { id: "call1" });
    fireEvent.click(screen.getByRole("button", { name: /Refuser/ }));
    expect(invoke).toHaveBeenLastCalledWith("reject_call", { id: "call1" });
  });

  it("failure shows the diagnostic reason", () => {
    show(makeCall({ state: "failed", reason: "Busy (486)", sipCode: 486 }));
    expect(screen.getByText("Busy (486)")).toBeInTheDocument();
  });

  describe("layout", () => {
    it("puts every control in one aligned row, hang-up included", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      const group = screen.getByRole("group", { name: "Call controls" });
      const labels = Array.from(group.querySelectorAll("button")).map((b) => b.getAttribute("aria-label"));
      expect(labels).toEqual([
        "Mute the microphone",
        "Put on hold",
        "Keypad (DTMF tones)",
        "Transfer the call",
        "Hang up",
      ]);
    });

    it("shows only the voice of the other party: no orb for our own", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      expect(screen.getByTestId("orb-remote")).toBeInTheDocument();
      expect(screen.queryByTestId("orb-local")).toBeNull();
      expect(screen.queryByText("You")).toBeNull();
    });

    it("the keypad is a glass sheet over the voices, right above the controls, hidden until asked for", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      const sheet = screen.getByTestId("keypad-sheet");
      expect(sheet).toHaveAttribute("aria-hidden", "true");
      expect(sheet).toHaveAttribute("inert");
      expect(sheet.className).toContain("glass");

      fireEvent.click(screen.getByRole("button", { name: "Keypad (DTMF tones)" }));
      expect(sheet).toHaveAttribute("aria-hidden", "false");
      expect(sheet).not.toHaveAttribute("inert");
      // It overlays: positioned above the controls, inside the same container.
      const controls = screen.getByRole("group", { name: "Call controls" });
      expect(sheet.parentElement).toBe(controls.parentElement);
      expect(sheet.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      // The orb keeps its size: nothing is pushed aside.
      expect(screen.getByTestId("orb-remote").className).toContain("size-[clamp(12rem");
    });

    it("keyboard digits drive the keypad only while it is open", () => {
      show(makeCall({ state: "connected", connectedAt: new Date().toISOString() }));
      fireEvent.keyDown(window, { key: "4" });
      expect(invoke).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Keypad (DTMF tones)" }));
      fireEvent.keyDown(window, { key: "4" });
      expect(invoke).toHaveBeenLastCalledWith("send_dtmf", { id: "call1", digits: "4" });
    });

    it("shows a muted microphone on its button only, with no text about it", () => {
      show(makeCall({ state: "connected", muted: true, connectedAt: new Date().toISOString() }));
      expect(screen.queryByText("Muted")).toBeNull();
      expect(screen.getByRole("button", { name: "Unmute" })).toHaveAttribute("aria-pressed", "true");
    });

    it("an unanswered call has no controls to show once it is over", () => {
      show(makeCall({ state: "ended", durationSecs: 0 }));
      expect(screen.queryByRole("group", { name: "Call controls" })).toBeNull();
    });
  });
});
