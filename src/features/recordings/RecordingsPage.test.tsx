import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: { error: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...a: unknown[]) => invoke(...a),
  convertFileSrc: (p: string) => `asset://localhost${p}`,
}));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useRecordingsStore } from "@/stores/recordings-store";
import type { Recording } from "@/types/telephony";

import { RecordingsPage } from "./RecordingsPage";

const rec = (over: Partial<Recording> = {}): Recording => ({
  id: "r1",
  historyId: null,
  fileName: "r1.wav",
  path: "/data/recordings/r1.wav",
  startedAt: "2026-01-01T10:00:00Z",
  durationSecs: 125,
  sizeBytes: 4_000_000,
  remoteNumber: "1002",
  remoteName: "Bob Martin",
  accountLabel: "Office",
  direction: "incoming",
  peaks: [0, 128, 255, 64],
  ...over,
});

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
  useRecordingsStore.setState({ recordings: [], loaded: true });
});

describe("RecordingsPage", () => {
  it("explains how to record when there is nothing yet", () => {
    render(<RecordingsPage />);
    expect(screen.getByText("No recordings")).toBeInTheDocument();
    expect(screen.queryAllByTestId("recording")).toHaveLength(0);
  });

  it("lists the recordings with who, when, how long, how big, and a player", () => {
    useRecordingsStore.setState({
      recordings: [
        rec(),
        rec({ id: "r2", remoteName: null, remoteNumber: "2000", direction: "outgoing", sizeBytes: 900 }),
      ],
    });
    render(<RecordingsPage />);
    const items = screen.getAllByTestId("recording");
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText("Bob Martin")).toBeInTheDocument();
    expect(items[0]).toHaveTextContent("2 min 05 s");
    expect(items[0]).toHaveTextContent("4 MB");
    expect(within(items[1]!).getByText("2000")).toBeInTheDocument();
    expect(screen.getByText(/2 calls · 4 MB on this Mac/)).toBeInTheDocument();
    // The Detent voice note: play button, position, speed — and no transcript, there is none.
    expect(within(items[0]!).getByRole("button", { name: "Lecture" })).toBeInTheDocument();
    expect(within(items[0]!).getByRole("slider", { name: "Playback position" })).toBeInTheDocument();
    expect(within(items[0]!).getByRole("button", { name: /Vitesse/ })).toBeInTheDocument();
    expect(within(items[0]!).queryByText("Transcription")).toBeNull();
  });

  it("deletes a recording after a confirmation", async () => {
    invoke.mockResolvedValue(undefined);
    useRecordingsStore.setState({ recordings: [rec()] });
    render(<RecordingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete the recording of Bob Martin" }));
    expect(invoke).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("delete_recording", { id: "r1" }));
    expect(useRecordingsStore.getState().recordings).toHaveLength(0);
  });

  it("puts the recording back and says so when the deletion fails", async () => {
    invoke.mockRejectedValue({ kind: "other", message: "Cannot delete" });
    useRecordingsStore.setState({ recordings: [rec()] });
    render(<RecordingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Delete the recording of Bob Martin" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Cannot delete"));
    expect(useRecordingsStore.getState().recordings).toHaveLength(1);
  });
});
