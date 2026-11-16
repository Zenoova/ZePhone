import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast, playDtmfTone } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), info: vi.fn() },
  playDtmfTone: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));
vi.mock("@/lib/dtmf-tones", () => ({ playDtmfTone: (...a: unknown[]) => playDtmfTone(...a) }));

import { makeAccount, makeCall, makeHistory, makeStatus } from "@/test/fixtures";
import { useAccountsStore } from "@/stores/accounts-store";
import { useCallsStore } from "@/stores/calls-store";
import { useEngineStore } from "@/stores/engine-store";
import { useUiStore } from "@/stores/ui-store";

import { DialerPage } from "./DialerPage";

const display = () => screen.getByTestId("dial-display");
const press = (key: string, target: Window | Element = window) => fireEvent.keyDown(target, { key });

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
  toast.info.mockReset();
  playDtmfTone.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_history")
      return [
        makeHistory({
          direction: "outgoing",
          result: "answered",
          remoteUri: "sip:1002@example.com",
          remoteNumber: "1002",
        }),
      ];
    if (cmd === "dial") return makeCall({ state: "initializing" });
    return undefined;
  });
  useAccountsStore.setState({ accounts: [makeAccount()], statuses: { acc1: makeStatus() }, loaded: true });
  useEngineStore.setState({ info: { name: "baresip", version: "4.13.0", codecs: ["PCMU"], state: "running" } });
  useCallsStore.setState({ calls: {}, dialing: false });
  useUiStore.setState({ section: "dialer", dialValue: "" });
});

describe("DialerPage keyboard", () => {
  it("has no text input: the number is a display", () => {
    render(<DialerPage />);
    expect(screen.queryByRole("textbox", { name: "Numéro à appeler" })).toHaveAttribute("aria-readonly", "true");
    expect(document.querySelector("input")).toBeNull();
  });

  it("physical digit keys press the keypad buttons: same display, same tone", () => {
    render(<DialerPage />);
    press("1");
    press("0");
    press("*");
    press("#");
    expect(display()).toHaveTextContent("10*#");
    expect(playDtmfTone.mock.calls.map((c) => c[0])).toEqual(["1", "0", "*", "#"]);
  });

  it("clicking a keypad button gives the same result as typing the key", () => {
    render(<DialerPage />);
    fireEvent.click(screen.getByRole("button", { name: "7" }));
    expect(display()).toHaveTextContent("7");
    expect(playDtmfTone).toHaveBeenCalledWith("7");
  });

  it("the pressed key is visibly highlighted", () => {
    render(<DialerPage />);
    press("5");
    expect(screen.getByRole("button", { name: "5" })).toHaveAttribute("data-pressed", "true");
  });

  it("ignores repeated keydown events and shortcuts", () => {
    render(<DialerPage />);
    fireEvent.keyDown(window, { key: "4", repeat: true });
    fireEvent.keyDown(window, { key: "4", metaKey: true });
    fireEvent.keyDown(window, { key: "4", ctrlKey: true });
    expect(display().textContent).toBe("");
  });

  it("does not hijack real text fields", () => {
    render(
      <>
        <DialerPage />
        <input aria-label="ailleurs" />
      </>,
    );
    press("9", screen.getByLabelText("ailleurs"));
    expect(display().textContent).toBe("");
  });

  it("does not react while a dialog is open", () => {
    render(
      <>
        <DialerPage />
        <div role="dialog" />
      </>,
    );
    press("3");
    expect(display().textContent).toBe("");
  });

  it("Backspace, Alt+Backspace and Escape edit the number", () => {
    useUiStore.setState({ dialValue: "1234" });
    render(<DialerPage />);
    press("Backspace");
    expect(display()).toHaveTextContent("123");
    fireEvent.keyDown(window, { key: "Backspace", altKey: true });
    expect(display().textContent).toBe("");
    useUiStore.setState({ dialValue: "55" });
    press("Escape");
    expect(useUiStore.getState().dialValue).toBe("");
  });

  it("letters and symbols can be typed for SIP addresses", () => {
    render(<DialerPage />);
    for (const k of "bob@ex.org") press(k);
    expect(display()).toHaveTextContent("bob@ex.org");
    expect(playDtmfTone).not.toHaveBeenCalled(); // no tone for non-keypad characters
  });

  it("pastes a number or address", () => {
    render(<DialerPage />);
    const event = new Event("paste", { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    event.clipboardData = { getData: () => "  sip:bob@example.com \nsecond line" };
    fireEvent(window, event);
    expect(display()).toHaveTextContent("sip:bob@example.com");
  });

  it("Enter places the call with what is displayed", async () => {
    useUiStore.setState({ dialValue: "1002" });
    render(<DialerPage />);
    press("Enter");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc1" }));
  });
});

describe("DialerPage redial", () => {
  it("clicking Appeler with an empty display brings back the last dialled number instead of calling", async () => {
    render(<DialerPage />);
    fireEvent.click(screen.getByRole("button", { name: /Appeler/ }));
    await vi.waitFor(() => expect(display()).toHaveTextContent("1002"));
    expect(invoke).toHaveBeenCalledWith("list_history", { filter: { kind: "outgoing", limit: 1 } });
    expect(invoke.mock.calls.some((c) => c[0] === "dial")).toBe(false);

    // A second click now dials it.
    fireEvent.click(screen.getByRole("button", { name: /Appeler/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc1" }));
  });

  it("Enter on an empty display does the same", async () => {
    render(<DialerPage />);
    press("Enter");
    await vi.waitFor(() => expect(display()).toHaveTextContent("1002"));
  });

  it("says so when there is nothing to redial", async () => {
    invoke.mockImplementation(async (cmd: string) => (cmd === "list_history" ? [] : undefined));
    render(<DialerPage />);
    fireEvent.click(screen.getByRole("button", { name: /Appeler/ }));
    await vi.waitFor(() => expect(toast.info).toHaveBeenCalledWith("Aucun appel sortant à rappeler"));
    expect(display().textContent).toBe("");
  });

  it("the button stays enabled with an empty display when an account is connected", () => {
    render(<DialerPage />);
    expect(screen.getByRole("button", { name: /Appeler/ })).toBeEnabled();
  });

  it("the button is disabled when the engine is not running", () => {
    useEngineStore.setState({ info: { name: "baresip", version: null, codecs: [], state: "stopped" } });
    render(<DialerPage />);
    expect(screen.getByRole("button", { name: /Appeler/ })).toBeDisabled();
  });
});

describe("DialerPage accounts", () => {
  const two = () => {
    useAccountsStore.setState({
      accounts: [
        makeAccount(),
        makeAccount({ id: "acc2", label: "Mobile VoIP", username: "0987654321", isDefault: false }),
      ],
      statuses: { acc1: makeStatus(), acc2: makeStatus({ accountId: "acc2" }) },
      loaded: true,
    });
  };
  const type = (n: string) => n.split("").forEach((k) => press(k));
  const choose = () => screen.getByRole("button", { name: "Choisir le compte pour appeler" });
  const openMenu = () => fireEvent.keyDown(choose(), { key: "Enter" });

  it("with one account there is nothing to choose and no account name: just the keypad and the call button", () => {
    render(<DialerPage />);
    expect(screen.queryByText("Bureau")).toBeNull();
    expect(screen.queryByText("Compte par défaut")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Choisir le compte pour appeler" })).toBeNull();
    expect(screen.getByRole("button", { name: "Appeler" })).toBeInTheDocument();
  });

  it("with several accounts the list is not on top of the keypad any more", () => {
    two();
    render(<DialerPage />);
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByText("Compte par défaut")).toBeNull();
    expect(screen.queryByText("Mobile VoIP")).toBeNull(); // only in the menu, once opened
  });

  it("with several accounts a menu sits next to the call button", () => {
    two();
    render(<DialerPage />);
    const call = screen.getByRole("button", { name: "Appeler" });
    expect(call.parentElement).toContainElement(choose());
  });

  it("the call button calls with the default account", async () => {
    two();
    render(<DialerPage />);
    type("1002");
    fireEvent.click(screen.getByRole("button", { name: "Appeler" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc1" }));
  });

  it("the default account is the one marked as such, not the first", async () => {
    useAccountsStore.setState({
      accounts: [makeAccount({ isDefault: false }), makeAccount({ id: "acc2", label: "Mobile VoIP", isDefault: true })],
      statuses: { acc1: makeStatus(), acc2: makeStatus({ accountId: "acc2" }) },
      loaded: true,
    });
    render(<DialerPage />);
    type("1002");
    press("Enter");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc2" }));
  });

  it("Enter calls with the default account too", async () => {
    two();
    render(<DialerPage />);
    type("1002");
    press("Enter");
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc1" }));
  });

  it("the menu lists the accounts, says which is the default, and calls with the one picked", async () => {
    two();
    render(<DialerPage />);
    type("1002");
    openMenu();
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((i) => i.textContent)).toEqual(["Bureau · par défaut", "Mobile VoIP"]);
    fireEvent.click(within(document.body).getByRole("menuitem", { name: "Mobile VoIP" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1002", accountId: "acc2" }));
    // the choice was for this call only: the next "Appeler" is the default account again
    await vi.waitFor(() => expect(display().textContent).toBe("")); // the call went out: the display is clear
    invoke.mockClear();
    type("1003");
    fireEvent.click(await screen.findByRole("button", { name: "Appeler" }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith("dial", { target: "1003", accountId: "acc1" }));
  });

  it("the menu waits for a number: there is nothing to call yet", () => {
    two();
    render(<DialerPage />);
    expect(choose()).toBeDisabled();
    type("1");
    expect(choose()).toBeEnabled();
  });

  it("an account that is switched off is not offered", () => {
    useAccountsStore.setState({
      accounts: [makeAccount(), makeAccount({ id: "acc2", label: "Mobile VoIP", isDefault: false, enabled: false })],
      statuses: { acc1: makeStatus() },
      loaded: true,
    });
    render(<DialerPage />);
    expect(screen.queryByRole("button", { name: "Choisir le compte pour appeler" })).toBeNull();
  });

  it("two accounts with the same name are told apart by their address", async () => {
    useAccountsStore.setState({
      accounts: [
        makeAccount({ label: "Bureau", username: "1001" }),
        makeAccount({ id: "acc2", label: "Bureau", username: "2002", isDefault: false }),
      ],
      statuses: { acc1: makeStatus(), acc2: makeStatus({ accountId: "acc2" }) },
      loaded: true,
    });
    render(<DialerPage />);
    type("1");
    openMenu();
    const items = (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
    expect(items).toEqual(["Bureau (1001@example.com) · par défaut", "Bureau (2002@example.com)"]);
  });
});
