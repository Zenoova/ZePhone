import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { useCallStatsStore } from "@/stores/call-stats-store";
import { makeCall, makeRun } from "@/test/fixtures";

import { CallStatsDialog } from "./CallStatsDialog";

const call = makeCall({ state: "connected" });
const show = () => render(<CallStatsDialog call={call} open onOpenChange={() => {}} />);

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue([]);
  useCallStatsStore.setState({ samples: {} });
});

describe("CallStatsDialog", () => {
  it("waits for the first measures and says so", async () => {
    show();
    expect(await screen.findByTestId("stats-count")).toHaveTextContent("Les premières mesures arrivent");
    expect(screen.queryByTestId("stats-summary")).toBeNull();
    expect(screen.getByTestId("stats-hint")).toHaveTextContent("Mesures en cours");
    expect(invoke).toHaveBeenCalledWith("get_call_stats", { callId: "call1" });
  });

  it("shows the headline figures, the reading and the six charts of a call that goes well", () => {
    useCallStatsStore.setState({ samples: { call1: makeRun(20) } });
    show();
    const summary = screen.getByTestId("stats-summary");
    expect(summary).toHaveTextContent("PCMA");
    expect(summary).toHaveTextContent("0 / 20"); // seconds with an incident
    expect(screen.getByTestId("stats-hint")).toHaveAttribute("data-level", "ok");
    for (const id of ["jitter", "incidents", "blocks", "buffer", "bitrate", "filter"]) {
      expect(screen.getByTestId(`chart-${id}`)).toBeInTheDocument();
    }
  });

  it("warns, in words, when packets are late every second", () => {
    useCallStatsStore.setState({ samples: { call1: makeRun(30, () => ({ jbufLate: 1 })) } });
    show();
    const hints = within(screen.getByTestId("stats-hints")).getAllByTestId("stats-hint");
    expect(hints.map((h) => h.getAttribute("data-level"))).toEqual(["warn", "warn"]);
    expect(screen.getByText("Un incident presque chaque seconde")).toBeInTheDocument();
  });

  it("keeps up with samples that arrive while it is open", () => {
    useCallStatsStore.setState({ samples: { call1: makeRun(5) } });
    show();
    expect(screen.getByTestId("stats-count")).toHaveTextContent("5 secondes mesurées");
    useCallStatsStore.getState().push(makeRun(1, () => ({}), 10)[0]!);
    // the store is updated outside React's batching in tests: re-render through the DOM query
    return screen.findByText("6 secondes mesurées");
  });

  it("limits the charts to the chosen period but not the reading", () => {
    useCallStatsStore.setState({ samples: { call1: makeRun(100) } });
    show();
    const oneMin = screen.getByRole("button", { name: "1 min" });
    expect(oneMin).toHaveAttribute("aria-pressed", "true");
    const jitter = screen.getByTestId("chart-jitter");
    const lastTick = () => jitter.querySelectorAll("text");
    const before = lastTick().length;
    fireEvent.click(screen.getByRole("button", { name: "Tout" }));
    expect(screen.getByRole("button", { name: "Tout" })).toHaveAttribute("aria-pressed", "true");
    expect(lastTick().length).toBeGreaterThanOrEqual(before - 3);
    expect(screen.getByTestId("stats-count")).toHaveTextContent("100 secondes mesurées");
  });
});
