import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { useAccountsStore } from "@/stores/accounts-store";
import { useCallsStore } from "@/stores/calls-store";
import { useEngineStore } from "@/stores/engine-store";
import { makeAccount, makeCall, makeStatus } from "@/test/fixtures";

import { HomePage } from "./HomePage";

const renderHome = () =>
  render(
    <TooltipProvider>
      <HomePage />
    </TooltipProvider>,
  );

beforeEach(() => {
  useAccountsStore.setState({ accounts: [makeAccount()], statuses: { acc1: makeStatus() }, loaded: true });
  useEngineStore.setState({ info: { name: "baresip", version: "4.13.0", codecs: [], state: "running" } });
  useCallsStore.setState({ calls: {}, dialing: false });
});

describe("HomePage", () => {
  it("shows the keypad when there is no call", () => {
    renderHome();
    expect(screen.getByTestId("dial-display")).toBeInTheDocument();
    expect(screen.queryByTestId("call-panel")).toBeNull();
  });

  it("shows the call screen as soon as a call is in progress", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "dialing" }) } });
    renderHome();
    expect(screen.getByTestId("call-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("dial-display")).toBeNull();
  });

  it("goes back to the keypad as soon as the last call is over", () => {
    useCallsStore.setState({ calls: { call1: makeCall({ state: "connected" }) } });
    renderHome();
    expect(screen.getByTestId("call-panel")).toBeInTheDocument();
    // The ended call lingers in the store for a few seconds but no longer holds the screen.
    useCallsStore.getState().apply(makeCall({ state: "ended", durationSecs: 12 }));
    // (React re-renders on the store update)
    return vi.waitFor(() => expect(screen.getByTestId("dial-display")).toBeInTheDocument());
  });

  it("keeps the main call on screen and lists the others as compact lines", () => {
    useCallsStore.setState({
      calls: {
        a: makeCall({ id: "a", state: "connected", remoteName: "Bob" }),
        b: makeCall({
          id: "b",
          state: "incoming",
          direction: "incoming",
          remoteName: "Alice",
          createdAt: "2026-01-01T10:05:00Z",
        }),
      },
    });
    renderHome();
    expect(screen.getAllByTestId("call-panel")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Bob" })).toBeInTheDocument();
    expect(screen.getByTestId("call-row")).toHaveTextContent("Alice");
  });
});
