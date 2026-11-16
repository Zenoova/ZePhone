import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { useShortcutsStore } from "@/stores/shortcuts-store";
import { makeBackend } from "@/test/backend";
import type { ShortcutAction, ShortcutItem, ShortcutsView } from "@/types/shortcuts";

import { ShortcutsSettings } from "./ShortcutsSettings";

const LABELS: Record<ShortcutAction, string> = {
  answer: "Décrocher",
  reject: "Refuser l'appel entrant",
  hangup: "Raccrocher",
  toggleMute: "Couper / réactiver le micro",
  toggleHold: "Mettre en attente / reprendre",
  showDialer: "Afficher le clavier",
  showSearch: "Rechercher un contact",
  toggleDnd: "Ne pas déranger",
};
const KEYS: Record<ShortcutAction, string> = {
  answer: "A",
  reject: "D",
  hangup: "H",
  toggleMute: "M",
  toggleHold: "P",
  showDialer: "N",
  showSearch: "F",
  toggleDnd: "Z",
};

const item = (action: ShortcutAction, over: Partial<ShortcutItem> = {}): ShortcutItem => ({
  action,
  label: LABELS[action],
  accelerator: `CommandOrControl+Alt+Shift+${KEYS[action]}`,
  display: `⌥⇧⌘${KEYS[action]}`,
  defaultAccelerator: `CommandOrControl+Alt+Shift+${KEYS[action]}`,
  isDefault: true,
  enabled: true,
  status: { kind: "active" },
  ...over,
});

const view = (over: Partial<ShortcutsView> = {}, items?: ShortcutItem[]): ShortcutsView => ({
  enabled: true,
  capturing: false,
  mac: true,
  items: items ?? (Object.keys(LABELS) as ShortcutAction[]).map((a) => item(a)),
  ...over,
});

let backend: ReturnType<typeof makeBackend>;
let current: ShortcutsView;

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  current = view();
  useShortcutsStore.setState({ view: null });
  backend = makeBackend(invoke, {
    shortcuts_get: () => current,
    shortcuts_set: (a) => {
      current = view(
        {},
        current.items.map((i) =>
          i.action === a?.action
            ? item(i.action, {
                accelerator: a?.accelerator as string | null,
                display: a?.accelerator ? "⌥⌘K" : null,
                enabled: a?.enabled as boolean,
                isDefault: false,
              })
            : i,
        ),
      );
      return current;
    },
    shortcuts_capture: (a) => (current = { ...current, capturing: Boolean(a?.active) }),
    shortcuts_set_enabled: (a) => (current = { ...current, enabled: Boolean(a?.enabled) }),
    shortcuts_reset: () => (current = view()),
  });
});

const row = (action: ShortcutAction) => screen.getByTestId(`shortcut-${action}`);
const press = (init: KeyboardEventInit) => act(() => void fireEvent.keyDown(window, init));
const captures = () => backend.calls("shortcuts_capture").map((c) => c.active);

async function shown() {
  render(<ShortcutsSettings />);
  await screen.findByRole("list", { name: "Raccourcis" });
}

describe("ShortcutsSettings: the list", () => {
  it("shows each action with its combination, its scope and whether it is really active", async () => {
    await shown();
    const answer = within(row("answer"));
    expect(answer.getByText("Décrocher")).toBeInTheDocument();
    expect(answer.getByText("Actif")).toBeInTheDocument();
    expect(answer.getByText("Global")).toBeInTheDocument();
    expect(answer.getByRole("button", { name: /Modifier le raccourci : Décrocher/ })).toHaveTextContent("⌥⇧⌘A");
    expect(screen.getAllByText("Global")).toHaveLength(8);
  });

  it("tells a saved combination from one the system could not register, and says why", async () => {
    current = view({}, [
      item("answer"),
      item("toggleMute", {
        status: { kind: "failed", message: "Déjà utilisée par une autre application ou par le système" },
      }),
    ]);
    await shown();
    expect(within(row("answer")).getByText("Actif")).toBeInTheDocument();
    const mute = within(row("toggleMute"));
    expect(mute.getByText("Non activé")).toBeInTheDocument();
    expect(mute.getByRole("alert")).toHaveTextContent("Déjà utilisée par une autre application");
    // Its combination is still shown: it is saved.
    expect(mute.getByRole("button", { name: /Modifier/ })).toHaveTextContent("⌥⇧⌘M");
  });

  it("shows disabled and unassigned actions as such", async () => {
    current = view({}, [
      item("answer", { enabled: false, status: { kind: "disabled" } }),
      item("hangup", { accelerator: null, display: null, isDefault: false, status: { kind: "unassigned" } }),
    ]);
    await shown();
    expect(within(row("answer")).getByText("Désactivé")).toBeInTheDocument();
    expect(within(row("hangup")).getByText("Non attribué")).toBeInTheDocument();
    expect(within(row("hangup")).getByRole("button", { name: /Modifier/ })).toHaveTextContent("Aucun");
    expect(within(row("hangup")).getByRole("switch")).toBeDisabled();
  });

  it("separates what works anywhere from what only works in the window", async () => {
    await shown();
    expect(screen.getByText("Dans l'application seulement")).toBeInTheDocument();
    expect(screen.getByText("⌘1 à ⌘4")).toBeInTheDocument();
  });
});

describe("ShortcutsSettings: recording a combination", () => {
  it("pauses every shortcut while recording, then saves what was pressed and gives them back", async () => {
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    expect(await screen.findByText("Appuyez sur la combinaison…")).toBeInTheDocument();
    await waitFor(() => expect(captures()).toEqual([true]));

    press({ code: "KeyK", metaKey: true, altKey: true });
    await waitFor(() => expect(backend.calls("shortcuts_set")).toHaveLength(1));
    expect(backend.calls("shortcuts_set")[0]).toEqual({
      action: "hangup",
      accelerator: "CommandOrControl+Alt+K",
      enabled: true,
    });
    await waitFor(() => expect(captures()).toEqual([true, false]));
    expect(screen.queryByText("Appuyez sur la combinaison…")).toBeNull();
    expect(within(row("hangup")).getByRole("button", { name: /Modifier/ })).toHaveTextContent("⌥⌘K");
  });

  it("shows the modifiers as they are held", async () => {
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    press({ code: "MetaLeft", metaKey: true });
    expect(await screen.findByRole("status")).toHaveTextContent("⌘");
    press({ code: "AltLeft", metaKey: true, altKey: true });
    expect(screen.getByRole("status")).toHaveTextContent("⌘⌥");
    expect(backend.calls("shortcuts_set")).toHaveLength(0);
  });

  it("starts nothing while recording: the only things sent to the backend are the pause and the new combination", async () => {
    await shown();
    fireEvent.click(within(row("answer")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    // The user presses the combination of "Hang up" itself.
    press({ code: "KeyH", metaKey: true, altKey: true, shiftKey: true });
    await waitFor(() => expect(captures()).toEqual([true, false]));
    const asked = invoke.mock.calls.map((c) => c[0] as string);
    expect(asked.filter((c) => !c.startsWith("shortcuts_"))).toEqual([]);
  });

  it("shows the reason when the backend refuses, in the row, and stops recording", async () => {
    backend.handle("shortcuts_set", () => {
      throw { kind: "validation", message: "Déjà utilisée pour « Décrocher »" };
    });
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    press({ code: "KeyA", metaKey: true, altKey: true, shiftKey: true });
    expect(await within(row("hangup")).findByRole("alert")).toHaveTextContent("Déjà utilisée pour « Décrocher »");
    await waitFor(() => expect(captures()).toEqual([true, false]));
    expect(within(row("hangup")).getByRole("button", { name: /Modifier/ })).toHaveTextContent("⌥⇧⌘H");
  });

  it("gives up on Escape without changing anything", async () => {
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    press({ code: "Escape" });
    await waitFor(() => expect(captures()).toEqual([true, false]));
    expect(backend.calls("shortcuts_set")).toHaveLength(0);
  });

  it("gives up when the window loses the focus, so the shortcuts are never left paused", async () => {
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    act(() => void fireEvent.blur(window));
    await waitFor(() => expect(captures()).toEqual([true, false]));
  });

  it("gives them back when the page is closed in the middle of a recording", async () => {
    const { unmount } = render(<ShortcutsSettings />);
    await screen.findByRole("list", { name: "Raccourcis" });
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    await waitFor(() => expect(captures()).toEqual([true]));
    unmount();
    await waitFor(() => expect(captures()).toEqual([true, false]));
  });

  it("does not take a key that cannot be part of a combination", async () => {
    await shown();
    fireEvent.click(within(row("hangup")).getByRole("button", { name: /Modifier/ }));
    await screen.findByText("Appuyez sur la combinaison…");
    press({ code: "Comma", metaKey: true });
    expect(await screen.findByRole("status")).toHaveTextContent("ne peut pas faire partie");
    expect(backend.calls("shortcuts_set")).toHaveLength(0);
  });
});

describe("ShortcutsSettings: editing", () => {
  it("removes a combination", async () => {
    await shown();
    fireEvent.click(within(row("answer")).getByRole("button", { name: /Supprimer le raccourci : Décrocher/ }));
    await waitFor(() =>
      expect(backend.calls("shortcuts_set")[0]).toEqual({ action: "answer", accelerator: null, enabled: true }),
    );
  });

  it("turns one off and keeps its combination", async () => {
    await shown();
    fireEvent.click(within(row("answer")).getByRole("switch"));
    await waitFor(() =>
      expect(backend.calls("shortcuts_set")[0]).toEqual({
        action: "answer",
        accelerator: "CommandOrControl+Alt+Shift+A",
        enabled: false,
      }),
    );
  });

  it("puts one action, or all of them, back to the defaults", async () => {
    current = view({}, [item("answer", { accelerator: "Control+K", display: "⌃K", isDefault: false })]);
    await shown();
    fireEvent.click(within(row("answer")).getByRole("button", { name: /Rétablir le raccourci par défaut/ }));
    await waitFor(() => expect(backend.calls("shortcuts_reset")[0]).toEqual({ action: "answer" }));

    current = view({}, [item("answer", { accelerator: "Control+K", display: "⌃K", isDefault: false })]);
    useShortcutsStore.setState({ view: current });
    fireEvent.click(await screen.findByRole("button", { name: "Rétablir les réglages par défaut" }));
    await waitFor(() => expect(backend.calls("shortcuts_reset")[1]).toEqual({ action: null }));
  });

  it("the master switch turns every shortcut off at once", async () => {
    await shown();
    fireEvent.click(screen.getByRole("switch", { name: "Activer les raccourcis globaux" }));
    await waitFor(() => expect(backend.calls("shortcuts_set_enabled")[0]).toEqual({ enabled: false }));
  });

  it("with the master switch off, no single shortcut can be turned on", async () => {
    current = view({ enabled: false });
    await shown();
    expect(within(row("answer")).getByRole("switch")).toBeDisabled();
  });
});
