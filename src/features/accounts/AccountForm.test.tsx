import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: { error: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { makeAccount } from "@/test/fixtures";

import { AccountFormDialog } from "./AccountForm";

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
  invoke.mockResolvedValue(makeAccount());
});

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe("AccountForm", () => {
  it("says what is missing in a toast, puts the cursor there, and sends nothing", () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    fireEvent.click(screen.getByRole("button", { name: /Add and connect/ }));
    expect(toast.error).toHaveBeenLastCalledWith("Enter the address of the SIP server.");
    expect(field("SIP server")).toHaveFocus();

    fireEvent.change(field("SIP server"), { target: { value: "sip.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: /Add and connect/ }));
    expect(toast.error).toHaveBeenLastCalledWith("Enter the username of the account.");

    fireEvent.change(field("Username"), { target: { value: "1001" } });
    fireEvent.click(screen.getByRole("button", { name: /Add and connect/ }));
    expect(toast.error).toHaveBeenLastCalledWith(expect.stringContaining("Enter the account password"));
    expect(invoke).not.toHaveBeenCalled();
  });

  it("fills the optional fields while the main ones are typed, then saves them as defaults", async () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    fireEvent.change(field("SIP server"), { target: { value: "sip.example.com" } });
    fireEvent.change(field("Username"), { target: { value: "1001" } });
    fireEvent.change(field("Password"), { target: { value: "pw" } });

    expect(field("SIP domain").value).toBe("sip.example.com");
    expect(field("Authentication username").value).toBe("1001");
    expect(field("Account name").value).toBe("1001@sip.example.com");

    fireEvent.click(screen.getByRole("button", { name: /Add and connect/ }));
    await vi.waitFor(() => expect(invoke).toHaveBeenCalled());
    const [cmd, args] = invoke.mock.calls[0] as [string, { input: Record<string, unknown> }];
    expect(cmd).toBe("save_account");
    expect(args.input).toMatchObject({
      server: "sip.example.com",
      username: "1001",
      domain: null,
      authUsername: null,
      password: "pw",
    });
  });

  it("a domain typed by hand is no longer overwritten by the server", () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    fireEvent.change(field("SIP server"), { target: { value: "sip.example.com" } });
    fireEvent.change(field("SIP domain"), { target: { value: "example.com" } });
    fireEvent.change(field("SIP server"), { target: { value: "sip2.example.com" } });
    expect(field("SIP domain").value).toBe("example.com");
  });

  it("the password can be revealed", () => {
    render(<AccountFormDialog open onOpenChange={() => {}} account={null} />);
    expect(field("Password")).toHaveAttribute("type", "password");
    fireEvent.click(screen.getByRole("button", { name: "Show the password" }));
    expect(field("Password")).toHaveAttribute("type", "text");
  });
});
