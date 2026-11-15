import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast: { error: vi.fn() } }));

import { OrbPicker } from "@/components/OrbPicker";
import { VOICE_ORBS } from "@/lib/voice-orbs";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/stores/settings-store";

const group = () => screen.getByRole("radiogroup", { name: "Voice orb" });
const name = () => screen.getByTestId("orb-name").textContent;
const saved = () => invoke.mock.calls.filter(([cmd]) => cmd === "update_settings");
/** Lets the "carousel at rest" timer (250 ms) run out. */
const rest = () => act(() => vi.advanceTimersByTimeAsync(300));

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  invoke.mockReset();
  invoke.mockImplementation(async (_cmd: string, args: { settings: unknown }) => ({
    settings: args.settings,
    restartRequired: false,
  }));
  useSettingsStore.setState({ settings: DEFAULT_SETTINGS });
});
afterEach(() => vi.useRealTimers());

describe("OrbPicker", () => {
  it("has the chosen orb in the middle with only its English name under it: no title, no description", () => {
    render(<OrbPicker />);
    expect(name()).toBe("Galaxy");
    expect(screen.getByRole("radio", { name: "Galaxy" })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByText(/orbe vocal/i)).toBeNull();
    // The neighbours are there too, but not selected.
    expect(screen.getByRole("radio", { name: "Plasma" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("radio", { name: "Cloud" })).toHaveAttribute("aria-checked", "false");
  });

  it("starts on the saved orb", () => {
    useSettingsStore.setState({
      settings: { ...DEFAULT_SETTINGS, general: { ...DEFAULT_SETTINGS.general, voiceOrb: "shdr-12" } },
    });
    render(<OrbPicker />);
    expect(name()).toBe("Bricks");
  });

  it("moves with the arrow keys, loops around, and saves once it rests", async () => {
    render(<OrbPicker />);
    fireEvent.keyDown(group(), { key: "ArrowRight" });
    fireEvent.keyDown(group(), { key: "ArrowRight" });
    expect(name()).toBe("Caustics"); // Galaxy -> Cloud -> Caustics
    expect(saved()).toHaveLength(0); // still moving: nothing saved yet
    await rest();
    expect(saved()).toHaveLength(1); // one save, for the orb it stopped on
    expect(useSettingsStore.getState().settings.general.voiceOrb).toBe("shdr-16");

    fireEvent.keyDown(group(), { key: "Home" });
    expect(name()).toBe(VOICE_ORBS[0]!.label);
    fireEvent.keyDown(group(), { key: "ArrowLeft" }); // before the first one: the last one
    expect(name()).toBe(VOICE_ORBS.at(-1)!.label);
    fireEvent.keyDown(group(), { key: "End" });
    expect(name()).toBe(VOICE_ORBS.at(-1)!.label);
  });

  it("goes to a neighbour when it is clicked", async () => {
    render(<OrbPicker />);
    fireEvent.click(screen.getByRole("radio", { name: "Plasma" }));
    expect(name()).toBe("Plasma");
    await rest();
    expect(useSettingsStore.getState().settings.general.voiceOrb).toBe("shdr-13");
    // Clicking the orb in the middle changes nothing.
    fireEvent.click(screen.getByRole("radio", { name: "Plasma" }));
    expect(name()).toBe("Plasma");
  });

  it("follows a horizontal scroll, one orb per step", async () => {
    vi.useRealTimers(); // the pause after a step is measured with the event's own (real) clock
    render(<OrbPicker />);
    fireEvent.wheel(group(), { deltaX: 20 }); // not enough yet
    expect(name()).toBe("Galaxy");
    fireEvent.wheel(group(), { deltaX: 40 });
    expect(name()).toBe("Cloud");
    fireEvent.wheel(group(), { deltaX: 80 }); // inertia right after a step is ignored
    expect(name()).toBe("Cloud");
    await new Promise((r) => setTimeout(r, 220));
    fireEvent.wheel(group(), { deltaX: -80 });
    expect(name()).toBe("Galaxy");
  });

  it("follows a swipe: about one orb per slot swiped", () => {
    render(<OrbPicker />);
    fireEvent.pointerDown(group(), { clientX: 200 });
    fireEvent.pointerUp(group(), { clientX: 100 }); // swipe left: the next orb comes to the middle
    expect(name()).toBe("Cloud");
    fireEvent.pointerDown(group(), { clientX: 100 });
    fireEvent.pointerUp(group(), { clientX: 280 }); // a long swipe right goes back two orbs
    expect(name()).toBe("Plasma");
    fireEvent.pointerDown(group(), { clientX: 100 });
    fireEvent.pointerUp(group(), { clientX: 110 }); // a tiny move is not a swipe
    expect(name()).toBe("Plasma");
  });

  it("does not lose the choice when it closes right after a swipe", () => {
    const { unmount } = render(<OrbPicker />);
    fireEvent.keyDown(group(), { key: "ArrowRight" });
    expect(saved()).toHaveLength(0);
    unmount();
    expect(saved()).toHaveLength(1);
    expect(useSettingsStore.getState().settings.general.voiceOrb).toBe("shdr-21");
  });

  it("saves nothing when it ends where it started", async () => {
    render(<OrbPicker />);
    fireEvent.keyDown(group(), { key: "ArrowRight" });
    fireEvent.keyDown(group(), { key: "ArrowLeft" });
    await rest();
    expect(saved()).toHaveLength(0);
  });
});
