import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({ invoke: vi.fn(), toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { ContactFormDialog } from "./ContactForm";

beforeEach(() => {
  invoke.mockReset();
  toast.error.mockReset();
});

describe("ContactForm", () => {
  it("says in a toast what is missing, and sends nothing", () => {
    render(<ContactFormDialog open onOpenChange={() => {}} contact={null} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenLastCalledWith("Enter a name or a company for this contact.");
    expect(screen.getByLabelText("First name")).toHaveFocus();

    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Alice" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(toast.error).toHaveBeenLastCalledWith("Enter a number, an extension or a SIP address.");
    expect(screen.getByLabelText("Number or SIP address")).toHaveFocus();
    expect(invoke).not.toHaveBeenCalled();
  });
});
