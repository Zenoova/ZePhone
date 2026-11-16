import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { invoke, toast } = vi.hoisted(() => ({
  invoke: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock("@yusufceng1z/ding-react", () => ({ toast }));

import { NO_FILTERS, useDirectoryStore } from "@/stores/directory-store";
import { useUiStore } from "@/stores/ui-store";
import { makeBackend } from "@/test/backend";
import { makeSource } from "@/test/fixtures";
import type { LdapTestResult, LdapSourceInput, SourceView, SystemContactsInfo } from "@/types/directory";

import { DirectorySettings } from "./DirectorySettings";
import { LdapSourceDialog } from "./LdapSourceDialog";
import { MicrosoftSourceDialog } from "./MicrosoftSourceDialog";

const local = makeSource({ id: "local", kind: "local", name: "Local contacts", readOnly: false, contactCount: 3 });
let sources: SourceView[];
let backend: ReturnType<typeof makeBackend>;

const MAC: SystemContactsInfo = { available: true, name: "Mac contacts", access: "notDetermined" };

function setup(list: SourceView[], info: SystemContactsInfo = { ...MAC, available: false }) {
  sources = list;
  backend = makeBackend(invoke, {
    directory_system_contacts_info: () => info,
    directory_sources: () => sources,
    directory_groups: () => [],
    directory_departments: () => [],
    directory_sync: () => undefined,
    directory_set_source: (a) => ({ ...sources[0], ...a }),
    directory_disconnect: () => undefined,
    directory_clear_cache: () => undefined,
    directory_remove_source: () => undefined,
  });
}

beforeEach(() => {
  invoke.mockReset();
  Object.values(toast).forEach((f) => f.mockReset());
  useDirectoryStore.setState({ filters: NO_FILTERS, sources: [], sourcesLoaded: false, groups: [], departments: [] });
  useUiStore.setState({ section: "settings", settingsTab: "directory" });
});

const cards = () => screen.getAllByTestId("source-card");

describe("Settings → Directory: the sources", () => {
  it("starts with the local address book and says no company directory is connected", async () => {
    setup([local]);
    render(<DirectorySettings />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0]).toHaveTextContent("Local contacts");
    expect(cards()[0]).toHaveTextContent("3 contacts");
    expect(await screen.findByText("No company directory connected")).toBeInTheDocument();
  });

  it("shows each source with its kind, its state and when it last worked", async () => {
    setup([
      local,
      makeSource({ id: "a", name: "Internal LDAP", lastSuccessAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
      makeSource({ id: "b", kind: "microsoftOrg", name: "Microsoft 365", enabled: false, state: "disabled" }),
      makeSource({ id: "c", kind: "microsoftPersonal", name: "My Outlook contacts" }),
    ]);
    render(<DirectorySettings />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    const [, ldap, org, personal] = cards();
    expect(ldap).toHaveTextContent("LDAP directory");
    expect(ldap).toHaveTextContent("Synced 5 min ago");
    expect(ldap).toHaveTextContent("Read-only");
    expect(org).toHaveTextContent("Microsoft 365 · organization directory");
    expect(org).toHaveTextContent("Disconnected");
    // the two Microsoft sources are named apart: the directory of the organisation is not the user's contacts
    expect(personal).toHaveTextContent("Outlook · personal contacts");
  });

  it("a failure keeps the data, says what happened and offers to try again", async () => {
    setup([
      local,
      makeSource({
        state: "error",
        errorKind: "network",
        lastError: "The server refuses the connection.",
        contactCount: 80,
      }),
    ]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveAttribute("data-state", "error");
    expect(card).toHaveTextContent("80 contacts");
    expect(card).toHaveTextContent("contacts kept");
    const error = within(card).getByTestId("source-error");
    expect(error).toHaveTextContent("The server refuses the connection.");
    fireEvent.click(within(error).getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(backend.calls("directory_sync")).toEqual([{ id: "src1" }]));
  });

  it("an authentication error offers the way back in: reconnect the source", async () => {
    setup([
      local,
      makeSource({
        id: "ms1",
        kind: "microsoftOrg",
        name: "Microsoft 365",
        state: "needsReauth",
        errorKind: "auth",
        lastError: "The Microsoft sign-in has expired or was revoked: reconnect the source.",
        config: { clientId: "11111111-2222-3333-4444-555555555555", tenant: "contoso.example", level: "full" },
      }),
    ]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveTextContent("Reconnect");
    fireEvent.click(within(within(card).getByTestId("source-error")).getByRole("button", { name: "Reconnect" }));
    // the sign-in dialog opens on this very source, with its settings
    const dialog = await screen.findByRole("dialog", { name: "Reconnect Microsoft 365" });
    expect(within(dialog).getByLabelText("Application (client) ID")).toHaveValue(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("an LDAP password that is refused asks for the password again", async () => {
    setup([local, makeSource({ state: "needsReauth", errorKind: "auth", lastError: "Credentials refused." })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    fireEvent.click(
      within(within(card).getByTestId("source-error")).getByRole("button", { name: "Enter the password" }),
    );
    expect(await screen.findByRole("dialog", { name: "Edit the LDAP directory" })).toBeInTheDocument();
  });

  it("a configuration error points to the settings", async () => {
    setup([local, makeSource({ state: "error", errorKind: "config", lastError: "Base not found." })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    fireEvent.click(
      within(within(card).getByTestId("source-error")).getByRole("button", { name: "Edit the configuration" }),
    );
    expect(await screen.findByRole("dialog", { name: "Edit the LDAP directory" })).toBeInTheDocument();
  });

  it("turns a source off and on", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("switch", { name: "Disable Company directory" }));
    await waitFor(() =>
      expect(backend.calls("directory_set_source")).toEqual([
        { id: "src1", name: "Company directory", enabled: false, syncIntervalMin: 360 },
      ]),
    );
  });

  it("reads a source again on demand, and not while it is being read", async () => {
    setup([local, makeSource(), makeSource({ id: "busy", name: "Busy", state: "syncing" })]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    const [now, busy] = screen.getAllByRole("button", { name: "Sync" });
    expect(busy).toBeDisabled();
    fireEvent.click(now!);
    await waitFor(() => expect(backend.calls("directory_sync")).toEqual([{ id: "src1" }]));
  });

  it("asks before it erases anything, and says what is kept", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));
    const dialog = await screen.findByRole("dialog", { name: "Disconnect this source?" });
    expect(dialog).toHaveTextContent("password");
    expect(dialog).toHaveTextContent("Your favorites and groups are kept");
    expect(backend.calls("directory_disconnect")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Disconnect" }));
    await waitFor(() => expect(backend.calls("directory_disconnect")).toEqual([{ id: "src1" }]));
  });

  it("clears the memory of a source without disconnecting it, and removes a source for good", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("button", { name: "Clear the cache" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Clear the cache" }));
    await waitFor(() => expect(backend.calls("directory_clear_cache")).toEqual([{ id: "src1" }]));
    fireEvent.click(await screen.findByRole("button", { name: /Delete/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete the source" }));
    await waitFor(() => expect(backend.calls("directory_remove_source")).toEqual([{ id: "src1" }]));
  });

  it("warns that an old cache will be erased", async () => {
    setup([local, makeSource({ stale: true })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveTextContent("cleared after 30 days");
  });

  it("explains the rules: read-only, the memory, and no presence", async () => {
    setup([local]);
    render(<DirectorySettings />);
    expect(await screen.findByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByText(/30 days without/)).toBeInTheDocument();
    expect(screen.getByText(/Presence.*is not shown/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ LDAP

const okTest = (n = 2): LdapTestResult => ({
  ok: true,
  error: null,
  report: {
    authenticated: true,
    skipped: 0,
    warnings: n === 0 ? ["No entries found: check the search base and the filter."] : [],
    preview: Array.from({ length: n }, (_, i) => ({
      externalId: `id-${i}`,
      firstName: "Élodie",
      lastName: `Dupont${i}`,
      displayName: `Élodie Dupont${i}`,
      company: null,
      department: "Accounting",
      title: "Director",
      email: "e@example.org",
      phones: [{ kind: "work", number: "+33 1 23 45 67 89" }],
    })),
  },
});

function fillLdap() {
  fireEvent.change(screen.getByLabelText("Server address"), { target: { value: "ldaps://ldap.example.org" } });
  fireEvent.change(screen.getByLabelText("Search base (Base DN)"), {
    target: { value: "ou=people,dc=example,dc=org" },
  });
  fireEvent.change(screen.getByLabelText("Sign-in account (Bind DN)"), {
    target: { value: "cn=reader,dc=example,dc=org" },
  });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "s3cret-pw" } });
}

describe("The LDAP dialog", () => {
  const save = vi.fn();
  function openLdap(source: SourceView | null = null) {
    save.mockReset();
    backend = makeBackend(invoke, {
      directory_test_ldap: () => okTest(),
      directory_save_ldap: (a) => {
        save(a?.input);
        return makeSource();
      },
      directory_sources: () => [local],
      directory_groups: () => [],
      directory_departments: () => [],
    });
    const onOpenChange = vi.fn();
    render(<LdapSourceDialog open onOpenChange={onOpenChange} source={source} />);
    return onOpenChange;
  }

  it("will not activate a source before the connection was tested", async () => {
    openLdap();
    fillLdap();
    expect(screen.getByRole("button", { name: "Save and enable" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    expect(await screen.findByTestId("ldap-test-ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save and enable" })).toBeEnabled();
  });

  it("shows the first contacts the settings would produce, before anything is turned on", async () => {
    openLdap();
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    const ok = await screen.findByTestId("ldap-test-ok");
    const people = within(ok).getAllByTestId("preview-contact");
    expect(people).toHaveLength(2);
    expect(people[0]).toHaveTextContent("Élodie Dupont0");
    expect(people[0]).toHaveTextContent("Director · Accounting · e@example.org");
    expect(people[0]).toHaveTextContent("Work +33 1 23 45 67 89"); // as the server has it
    expect(backend.calls("directory_save_ldap")).toHaveLength(0);
  });

  it("sends exactly what was tested, with the password, and nothing is stored before the save", async () => {
    const onOpenChange = openLdap();
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    await screen.findByTestId("ldap-test-ok");
    const tested = backend.calls("directory_test_ldap")[0]!.input as LdapSourceInput;
    fireEvent.click(screen.getByRole("button", { name: "Save and enable" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save.mock.calls[0]![0]).toEqual(tested);
    expect(tested).toMatchObject({
      password: "s3cret-pw",
      config: {
        url: "ldaps://ldap.example.org",
        baseDn: "ou=people,dc=example,dc=org",
        bindDn: "cn=reader,dc=example,dc=org",
        pageSize: 500,
      },
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalled();
  });

  it("a change after the test asks for a new test", async () => {
    openLdap();
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    await screen.findByTestId("ldap-test-ok");
    fireEvent.change(screen.getByLabelText("Search base (Base DN)"), {
      target: { value: "ou=other,dc=example,dc=org" },
    });
    expect(screen.queryByTestId("ldap-test-ok")).toBeNull();
    expect(screen.getByRole("button", { name: "Save and enable" })).toBeDisabled();
  });

  it("explains a failed test and what to do about it, and keeps the save locked", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => ({
      ok: false,
      report: null,
      error: { kind: "auth", message: "The server refused the credentials: reconnect the source." },
    }));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    const error = await screen.findByTestId("ldap-test-error");
    expect(error).toHaveTextContent("The server refused the credentials");
    expect(error).toHaveTextContent("Check the sign-in account");
    expect(screen.getByRole("button", { name: "Save and enable" })).toBeDisabled();
  });

  it("a certificate problem tells the user where to add the company's authority", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => ({
      ok: false,
      report: null,
      error: {
        kind: "config",
        message:
          "The secure connection failed: the server's certificate is not trusted. Add your company's certificate authority in Settings → Network.",
      },
    }));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    expect(await screen.findByTestId("ldap-test-error")).toHaveTextContent("Settings → Network");
  });

  it("warns when the preview is empty or incomplete", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => okTest(0));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    expect(await screen.findByText(/No entries found/)).toBeInTheDocument();
  });

  it("never shows the password, and keeps the saved one when editing", async () => {
    openLdap(makeSource({ config: { url: "ldaps://ldap.example.org", baseDn: "dc=x", bindDn: "cn=r" } }));
    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(screen.getByText("Leave empty to keep the one that is saved.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    await screen.findByTestId("ldap-test-ok");
    const sent = backend.calls("directory_test_ldap")[0]!.input as LdapSourceInput;
    expect(sent.id).toBe("src1");
    expect(sent.password).toBeUndefined(); // the backend uses the one it holds
  });

  it("lets the field mapping be changed, one attribute per kind of number", async () => {
    openLdap();
    fillLdap();
    fireEvent.click(screen.getByText("Field mapping"));
    fireEvent.change(screen.getByLabelText("Number attribute 1"), { target: { value: "officePhone" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove number 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Test the connection" }));
    await screen.findByTestId("ldap-test-ok");
    const sent = backend.calls("directory_test_ldap")[0]!.input as LdapSourceInput;
    expect(sent.config.mapping.phones).toHaveLength(3);
    expect(sent.config.mapping.phones[0]).toEqual({ attribute: "officePhone", kind: "work" });
  });
});

// ------------------------------------------------------------------ Microsoft

describe("The Microsoft dialog", () => {
  const CLIENT = "11111111-2222-3333-4444-555555555555";

  function openMicrosoft(kind: "microsoftOrg" | "microsoftPersonal") {
    backend = makeBackend(invoke, {
      directory_connect_microsoft: () => makeSource({ kind }),
      directory_cancel_connect: () => undefined,
    });
    const onOpenChange = vi.fn();
    render(<MicrosoftSourceDialog open onOpenChange={onOpenChange} kind={kind} source={null} />);
    return onOpenChange;
  }

  it("keeps the organisation's directory and the personal contacts clearly apart", () => {
    openMicrosoft("microsoftOrg");
    const org = screen.getByRole("dialog");
    expect(org).toHaveTextContent("Connect the organization directory");
    expect(org).toHaveTextContent("These are not your personal Outlook contacts");
  });

  it("names the permissions each one asks for, and the administrator's part", () => {
    openMicrosoft("microsoftOrg");
    const permissions = screen.getByRole("region", { name: "Requested permissions" });
    expect(permissions).toHaveTextContent("User.Read.All");
    expect(permissions).toHaveTextContent("administrator's consent");
    expect(permissions).toHaveTextContent("never sees your password");
  });

  it("asks for less when the basic level is chosen", () => {
    openMicrosoft("microsoftOrg");
    // the level starts on "complet"; the basic one is described in the list
    expect(screen.getByRole("region", { name: "Requested permissions" })).not.toHaveTextContent("ReadBasic");
  });

  it("personal contacts need no administrator", () => {
    openMicrosoft("microsoftPersonal");
    const permissions = screen.getByRole("region", { name: "Requested permissions" });
    expect(permissions).toHaveTextContent("Contacts.Read");
    expect(permissions).toHaveTextContent("No administrator permission");
    expect(screen.getByRole("dialog")).toHaveTextContent("This is not your organization's directory");
  });

  it("cannot connect without an application id", () => {
    openMicrosoft("microsoftOrg");
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeDisabled();
  });

  it("signs in through the browser, waits, and closes once it is done", async () => {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const onOpenChange = openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", async () => {
      await done;
      return makeSource({ kind: "microsoftOrg" });
    });
    fireEvent.change(screen.getByLabelText("Application (client) ID"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    expect(await screen.findByTestId("ms-waiting")).toHaveTextContent("Waiting for the sign-in in your browser");
    expect(backend.calls("directory_connect_microsoft")[0]!.input).toMatchObject({
      kind: "microsoftOrg",
      config: { clientId: CLIENT, tenant: "organizations", level: "full" },
      syncIntervalMin: 360,
    });
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Microsoft connected: syncing");
  });

  it("can give up on a sign-in that is waiting", async () => {
    openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", () => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Application (client) ID"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await screen.findByTestId("ms-waiting");
    fireEvent.click(screen.getByRole("button", { name: "Cancel the connection" }));
    expect(backend.calls("directory_cancel_connect")).toHaveLength(1);
  });

  it("an administrator's restriction is shown in full, with the way forward", async () => {
    openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", () => {
      throw {
        kind: "other",
        message:
          "Your organization's administrator must allow the application to read the directory (admin consent). Give them the list of requested permissions, then reconnect the source.",
      };
    });
    fireEvent.change(screen.getByLabelText("Application (client) ID"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    const error = await screen.findByTestId("ms-error");
    expect(error).toHaveTextContent("admin consent");
    expect(error).toHaveTextContent("reconnect the source");
    // and the form is usable again
    expect(screen.getByRole("button", { name: "Sign in with Microsoft" })).toBeEnabled();
  });

  it("personal contacts are connected as such", async () => {
    openMicrosoft("microsoftPersonal");
    fireEvent.change(screen.getByLabelText("Application (client) ID"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Sign in with Microsoft" }));
    await waitFor(() => expect(backend.calls("directory_connect_microsoft")).toHaveLength(1));
    expect(backend.calls("directory_connect_microsoft")[0]!.input).toMatchObject({
      kind: "microsoftPersonal",
      config: { tenant: "common" },
    });
  });

  it("explains where to find the application id", () => {
    openMicrosoft("microsoftOrg");
    fireEvent.click(screen.getByText("Where to find the application ID?"));
    expect(screen.getByText(/Mobile and desktop applications/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ the device's own address book

describe("Settings → Directory: the device's address book", () => {
  const device = (over: Partial<SourceView> = {}) =>
    makeSource({ id: "dev", kind: "systemContacts", name: "Mac contacts", contactCount: 240, ...over });

  async function addSourceMenu() {
    fireEvent.keyDown(await screen.findByRole("button", { name: "Add a source" }), { key: "Enter" });
    return (await screen.findAllByRole("menuitem")).map((i) => i.textContent);
  }

  it("is offered where there is an address book to read, in read-only", async () => {
    setup([local], MAC);
    render(<DirectorySettings />);
    expect(await addSourceMenu()).toContain("Mac contacts (read-only)");
  });

  it("is not offered where there is none", async () => {
    setup([local]); // available: false
    render(<DirectorySettings />);
    expect(await addSourceMenu()).not.toContain("Mac contacts (read-only)");
  });

  it("is offered once: not again when it is already connected", async () => {
    setup([local, device()], { ...MAC, access: "authorized" });
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    expect(await addSourceMenu()).not.toContain("Mac contacts (read-only)");
  });

  it("waits for the user's answer to the system's question, then says it is reading", async () => {
    setup([local], MAC);
    let answer!: () => void;
    const answered = new Promise<void>((r) => (answer = r));
    backend.handle("directory_connect_system_contacts", async () => {
      await answered;
      return device();
    });
    render(<DirectorySettings />);
    await addSourceMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mac contacts/ }));
    expect(await screen.findByTestId("contacts-asking")).toHaveTextContent("Waiting for your answer");
    answer();
    await waitFor(() => expect(screen.queryByTestId("contacts-asking")).toBeNull());
    expect(toast.success).toHaveBeenCalledWith("Contacts connected: reading in progress");
    expect(backend.calls("directory_connect_system_contacts")).toHaveLength(1);
  });

  it("a refusal creates nothing, says where to change it, and offers to open the settings", async () => {
    setup([local], MAC);
    backend.handle("directory_connect_system_contacts", () => {
      throw {
        kind: "other",
        message:
          "Access to your contacts is denied. Allow ZePhone in System Settings → Privacy & Security → Contacts, then reconnect the source.",
      };
    });
    render(<DirectorySettings />);
    await addSourceMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Mac contacts/ }));
    const error = await screen.findByTestId("contacts-error");
    expect(error).toHaveTextContent("Privacy & Security → Contacts");
    expect(cards()).toHaveLength(1); // no source was made
    fireEvent.click(within(error).getByRole("button", { name: "Open settings" }));
    await waitFor(() => expect(backend.calls("directory_open_contacts_privacy_settings")).toHaveLength(1));
  });

  it("shows the connected address book as read-only, with nothing to configure", async () => {
    setup([local, device()], { ...MAC, access: "authorized" });
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveTextContent("Device contacts");
    expect(card).toHaveTextContent("240 contacts");
    expect(card).toHaveTextContent("Read-only");
    expect(within(card).queryByRole("button", { name: /Edit/ })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Reconnect" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Sync" })).toBeInTheDocument();
  });

  it("a permission taken back says so and offers to give it again", async () => {
    setup(
      [
        local,
        device({
          state: "error",
          errorKind: "forbidden",
          lastError: "Access to your contacts is denied.",
        }),
      ],
      { ...MAC, access: "denied" },
    );
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    const error = within(card).getByTestId("source-error");
    expect(error).toHaveTextContent("Access to your contacts is denied.");
    fireEvent.click(within(error).getByRole("button", { name: "Allow access" }));
    await waitFor(() => expect(backend.calls("directory_connect_system_contacts")).toHaveLength(1));
    fireEvent.click(within(error).getByRole("button", { name: "Open settings" }));
    await waitFor(() => expect(backend.calls("directory_open_contacts_privacy_settings")).toHaveLength(1));
  });

  it("says that the contacts stay on this computer and are never changed", async () => {
    setup([local]);
    render(<DirectorySettings />);
    expect(await screen.findByText(/stay on this computer/)).toBeInTheDocument();
    expect(screen.getByText(/never modifies them/)).toBeInTheDocument();
  });
});
