import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

import { makeCall } from "@/test/fixtures";
import { useCallsStore } from "@/stores/calls-store";
import { useUiStore } from "@/stores/ui-store";

import { IncomingCallDialog } from "./IncomingCallDialog";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useCallsStore.setState({ calls: {} });
  useUiStore.setState({ section: "settings" });
});

describe("IncomingCallDialog", () => {
  it("is hidden without an incoming call", () => {
    render(<IncomingCallDialog />);
    expect(screen.queryByTestId("incoming-call")).toBeNull();
  });

  it("appears over any section and lets the user answer", () => {
    useCallsStore.setState({
      calls: {
        call1: makeCall({ state: "incoming", direction: "incoming", remoteName: "Alice", remoteNumber: "2000" }),
      },
    });
    render(<IncomingCallDialog />);
    expect(screen.getByTestId("incoming-call")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Répondre/ }));
    expect(invoke).toHaveBeenCalledWith("answer_call", { id: "call1" });
    expect(useUiStore.getState().section).toBe("calls");
  });

  it("lets the user decline", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "incoming", direction: "incoming" }) } });
    render(<IncomingCallDialog />);
    fireEvent.click(screen.getByRole("button", { name: /Refuser/ }));
    expect(invoke).toHaveBeenCalledWith("reject_call", { id: "call1" });
  });

  it("cannot be dismissed with Escape (the user must answer or decline)", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "incoming", direction: "incoming" }) } });
    render(<IncomingCallDialog />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(screen.getByTestId("incoming-call")).toBeInTheDocument();
  });

  it("announces how many other calls are waiting", () => {
    useCallsStore.setState({
      calls: {
        a: makeCall({ id: "a", state: "incoming", direction: "incoming" }),
        b: makeCall({ id: "b", state: "incoming", direction: "incoming", createdAt: "2026-01-01T10:01:00Z" }),
      },
    });
    render(<IncomingCallDialog />);
    expect(screen.getByText("(+1)")).toBeInTheDocument();
  });
});
