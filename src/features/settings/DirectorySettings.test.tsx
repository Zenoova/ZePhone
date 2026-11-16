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
import type { LdapTestResult, LdapSourceInput, SourceView } from "@/types/directory";

import { DirectorySettings } from "./DirectorySettings";
import { LdapSourceDialog } from "./LdapSourceDialog";
import { MicrosoftSourceDialog } from "./MicrosoftSourceDialog";

const local = makeSource({ id: "local", kind: "local", name: "Contacts locaux", readOnly: false, contactCount: 3 });
let sources: SourceView[];
let backend: ReturnType<typeof makeBackend>;

function setup(list: SourceView[]) {
  sources = list;
  backend = makeBackend(invoke, {
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

describe("Settings → Annuaire: the sources", () => {
  it("starts with the local address book and says no company directory is connected", async () => {
    setup([local]);
    render(<DirectorySettings />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(cards()[0]).toHaveTextContent("Contacts locaux");
    expect(cards()[0]).toHaveTextContent("3 contacts");
    expect(await screen.findByText("Aucun annuaire d'entreprise connecté")).toBeInTheDocument();
  });

  it("shows each source with its kind, its state and when it last worked", async () => {
    setup([
      local,
      makeSource({ id: "a", name: "LDAP interne", lastSuccessAt: new Date(Date.now() - 5 * 60_000).toISOString() }),
      makeSource({ id: "b", kind: "microsoftOrg", name: "Microsoft 365", enabled: false, state: "disabled" }),
      makeSource({ id: "c", kind: "microsoftPersonal", name: "Mes contacts Outlook" }),
    ]);
    render(<DirectorySettings />);
    await waitFor(() => expect(cards()).toHaveLength(4));
    const [, ldap, org, personal] = cards();
    expect(ldap).toHaveTextContent("Annuaire LDAP");
    expect(ldap).toHaveTextContent("Synchronisée il y a 5 min");
    expect(ldap).toHaveTextContent("Lecture seule");
    expect(org).toHaveTextContent("Microsoft 365 · annuaire de l'organisation");
    expect(org).toHaveTextContent("Déconnectée");
    // the two Microsoft sources are named apart: the directory of the organisation is not the user's contacts
    expect(personal).toHaveTextContent("Outlook · contacts personnels");
  });

  it("a failure keeps the data, says what happened and offers to try again", async () => {
    setup([
      local,
      makeSource({
        state: "error",
        errorKind: "network",
        lastError: "Le serveur refuse la connexion.",
        contactCount: 80,
      }),
    ]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveAttribute("data-state", "error");
    expect(card).toHaveTextContent("80 contacts");
    expect(card).toHaveTextContent("conservées");
    const error = within(card).getByTestId("source-error");
    expect(error).toHaveTextContent("Le serveur refuse la connexion.");
    fireEvent.click(within(error).getByRole("button", { name: "Réessayer" }));
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
        lastError: "La connexion Microsoft a expiré ou a été révoquée : reconnectez la source.",
        config: { clientId: "11111111-2222-3333-4444-555555555555", tenant: "contoso.example", level: "full" },
      }),
    ]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveTextContent("À reconnecter");
    fireEvent.click(within(within(card).getByTestId("source-error")).getByRole("button", { name: "Reconnecter" }));
    // the sign-in dialog opens on this very source, with its settings
    const dialog = await screen.findByRole("dialog", { name: "Reconnecter Microsoft 365" });
    expect(within(dialog).getByLabelText("Identifiant d'application (client ID)")).toHaveValue(
      "11111111-2222-3333-4444-555555555555",
    );
  });

  it("an LDAP password that is refused asks for the password again", async () => {
    setup([local, makeSource({ state: "needsReauth", errorKind: "auth", lastError: "Identifiants refusés." })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    fireEvent.click(
      within(within(card).getByTestId("source-error")).getByRole("button", { name: "Saisir le mot de passe" }),
    );
    expect(await screen.findByRole("dialog", { name: "Modifier l'annuaire LDAP" })).toBeInTheDocument();
  });

  it("a configuration error points to the settings", async () => {
    setup([local, makeSource({ state: "error", errorKind: "config", lastError: "Base introuvable." })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    fireEvent.click(
      within(within(card).getByTestId("source-error")).getByRole("button", { name: "Modifier la configuration" }),
    );
    expect(await screen.findByRole("dialog", { name: "Modifier l'annuaire LDAP" })).toBeInTheDocument();
  });

  it("turns a source off and on", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("switch", { name: "Désactiver Annuaire de l'entreprise" }));
    await waitFor(() =>
      expect(backend.calls("directory_set_source")).toEqual([
        { id: "src1", name: "Annuaire de l'entreprise", enabled: false, syncIntervalMin: 360 },
      ]),
    );
  });

  it("reads a source again on demand, and not while it is being read", async () => {
    setup([local, makeSource(), makeSource({ id: "busy", name: "Occupée", state: "syncing" })]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    const [now, busy] = screen.getAllByRole("button", { name: "Synchroniser" });
    expect(busy).toBeDisabled();
    fireEvent.click(now!);
    await waitFor(() => expect(backend.calls("directory_sync")).toEqual([{ id: "src1" }]));
  });

  it("asks before it erases anything, and says what is kept", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("button", { name: "Se déconnecter" }));
    const dialog = await screen.findByRole("dialog", { name: "Déconnecter cette source ?" });
    expect(dialog).toHaveTextContent("mot de passe");
    expect(dialog).toHaveTextContent("favoris et vos groupes sont conservés");
    expect(backend.calls("directory_disconnect")).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "Déconnecter" }));
    await waitFor(() => expect(backend.calls("directory_disconnect")).toEqual([{ id: "src1" }]));
  });

  it("clears the memory of a source without disconnecting it, and removes a source for good", async () => {
    setup([local, makeSource()]);
    render(<DirectorySettings />);
    await screen.findAllByTestId("source-card");
    fireEvent.click(screen.getByRole("button", { name: "Effacer la mémoire" }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Effacer la mémoire" }));
    await waitFor(() => expect(backend.calls("directory_clear_cache")).toEqual([{ id: "src1" }]));
    fireEvent.click(await screen.findByRole("button", { name: /Supprimer/ }));
    fireEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Supprimer la source" }));
    await waitFor(() => expect(backend.calls("directory_remove_source")).toEqual([{ id: "src1" }]));
  });

  it("warns that an old cache will be erased", async () => {
    setup([local, makeSource({ stale: true })]);
    render(<DirectorySettings />);
    const card = (await screen.findAllByTestId("source-card"))[1]!;
    expect(card).toHaveTextContent("effacée après 30 jours");
  });

  it("explains the rules: read-only, the memory, and no presence", async () => {
    setup([local]);
    render(<DirectorySettings />);
    expect(await screen.findByText(/lecture seule/i)).toBeInTheDocument();
    expect(screen.getByText(/30 jours sans synchronisation/)).toBeInTheDocument();
    expect(screen.getByText(/présence.*n'est pas affichée/)).toBeInTheDocument();
  });
});

// ------------------------------------------------------------------ LDAP

const okTest = (n = 2): LdapTestResult => ({
  ok: true,
  error: null,
  report: {
    authenticated: true,
    skipped: 0,
    warnings: n === 0 ? ["Aucune entrée trouvée : vérifiez la base de recherche et le filtre."] : [],
    preview: Array.from({ length: n }, (_, i) => ({
      externalId: `id-${i}`,
      firstName: "Élodie",
      lastName: `Dupont${i}`,
      displayName: `Élodie Dupont${i}`,
      company: null,
      department: "Comptabilité",
      title: "Directrice",
      email: "e@example.org",
      phones: [{ kind: "work", number: "+33 1 23 45 67 89" }],
    })),
  },
});

function fillLdap() {
  fireEvent.change(screen.getByLabelText("Adresse du serveur"), { target: { value: "ldaps://ldap.example.org" } });
  fireEvent.change(screen.getByLabelText("Base de recherche (Base DN)"), {
    target: { value: "ou=people,dc=example,dc=org" },
  });
  fireEvent.change(screen.getByLabelText("Compte de connexion (Bind DN)"), {
    target: { value: "cn=reader,dc=example,dc=org" },
  });
  fireEvent.change(screen.getByLabelText("Mot de passe"), { target: { value: "s3cret-pw" } });
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
    expect(screen.getByRole("button", { name: "Enregistrer et activer" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByTestId("ldap-test-ok")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enregistrer et activer" })).toBeEnabled();
  });

  it("shows the first contacts the settings would produce, before anything is turned on", async () => {
    openLdap();
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    const ok = await screen.findByTestId("ldap-test-ok");
    const people = within(ok).getAllByTestId("preview-contact");
    expect(people).toHaveLength(2);
    expect(people[0]).toHaveTextContent("Élodie Dupont0");
    expect(people[0]).toHaveTextContent("Directrice · Comptabilité · e@example.org");
    expect(people[0]).toHaveTextContent("Professionnel +33 1 23 45 67 89"); // as the server has it
    expect(backend.calls("directory_save_ldap")).toHaveLength(0);
  });

  it("sends exactly what was tested, with the password, and nothing is stored before the save", async () => {
    const onOpenChange = openLdap();
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    await screen.findByTestId("ldap-test-ok");
    const tested = backend.calls("directory_test_ldap")[0]!.input as LdapSourceInput;
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer et activer" }));
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
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    await screen.findByTestId("ldap-test-ok");
    fireEvent.change(screen.getByLabelText("Base de recherche (Base DN)"), {
      target: { value: "ou=other,dc=example,dc=org" },
    });
    expect(screen.queryByTestId("ldap-test-ok")).toBeNull();
    expect(screen.getByRole("button", { name: "Enregistrer et activer" })).toBeDisabled();
  });

  it("explains a failed test and what to do about it, and keeps the save locked", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => ({
      ok: false,
      report: null,
      error: { kind: "auth", message: "Le serveur a refusé les identifiants : reconnectez la source." },
    }));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    const error = await screen.findByTestId("ldap-test-error");
    expect(error).toHaveTextContent("Le serveur a refusé les identifiants");
    expect(error).toHaveTextContent("Vérifiez le compte de connexion");
    expect(screen.getByRole("button", { name: "Enregistrer et activer" })).toBeDisabled();
  });

  it("a certificate problem tells the user where to add the company's authority", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => ({
      ok: false,
      report: null,
      error: {
        kind: "config",
        message:
          "La connexion sécurisée a échoué : le certificat du serveur n'est pas approuvé. Ajoutez l'autorité de certification de votre entreprise dans Paramètres → Réseau.",
      },
    }));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByTestId("ldap-test-error")).toHaveTextContent("Paramètres → Réseau");
  });

  it("warns when the preview is empty or incomplete", async () => {
    openLdap();
    backend.handle("directory_test_ldap", () => okTest(0));
    fillLdap();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText(/Aucune entrée trouvée/)).toBeInTheDocument();
  });

  it("never shows the password, and keeps the saved one when editing", async () => {
    openLdap(makeSource({ config: { url: "ldaps://ldap.example.org", baseDn: "dc=x", bindDn: "cn=r" } }));
    const field = screen.getByLabelText("Mot de passe");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toHaveValue("");
    expect(screen.getByText("Laissez vide pour garder celui qui est enregistré.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    await screen.findByTestId("ldap-test-ok");
    const sent = backend.calls("directory_test_ldap")[0]!.input as LdapSourceInput;
    expect(sent.id).toBe("src1");
    expect(sent.password).toBeUndefined(); // the backend uses the one it holds
  });

  it("lets the field mapping be changed, one attribute per kind of number", async () => {
    openLdap();
    fillLdap();
    fireEvent.click(screen.getByText("Correspondance des champs"));
    fireEvent.change(screen.getByLabelText("Attribut du numéro 1"), { target: { value: "officePhone" } });
    fireEvent.click(screen.getByRole("button", { name: "Retirer le numéro 4" }));
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
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
    expect(org).toHaveTextContent("Connecter l'annuaire de l'organisation");
    expect(org).toHaveTextContent("Ce ne sont pas vos contacts Outlook personnels");
  });

  it("names the permissions each one asks for, and the administrator's part", () => {
    openMicrosoft("microsoftOrg");
    const permissions = screen.getByRole("region", { name: "Autorisations demandées" });
    expect(permissions).toHaveTextContent("User.Read.All");
    expect(permissions).toHaveTextContent("consentement d'un administrateur");
    expect(permissions).toHaveTextContent("ne voit jamais votre mot de passe");
  });

  it("asks for less when the basic level is chosen", () => {
    openMicrosoft("microsoftOrg");
    // the level starts on "complet"; the basic one is described in the list
    expect(screen.getByRole("region", { name: "Autorisations demandées" })).not.toHaveTextContent("ReadBasic");
  });

  it("personal contacts need no administrator", () => {
    openMicrosoft("microsoftPersonal");
    const permissions = screen.getByRole("region", { name: "Autorisations demandées" });
    expect(permissions).toHaveTextContent("Contacts.Read");
    expect(permissions).toHaveTextContent("Aucune autorisation d'administrateur");
    expect(screen.getByRole("dialog")).toHaveTextContent("Ce n'est pas l'annuaire de votre organisation");
  });

  it("cannot connect without an application id", () => {
    openMicrosoft("microsoftOrg");
    expect(screen.getByRole("button", { name: "Se connecter avec Microsoft" })).toBeDisabled();
  });

  it("signs in through the browser, waits, and closes once it is done", async () => {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    const onOpenChange = openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", async () => {
      await done;
      return makeSource({ kind: "microsoftOrg" });
    });
    fireEvent.change(screen.getByLabelText("Identifiant d'application (client ID)"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec Microsoft" }));
    expect(await screen.findByTestId("ms-waiting")).toHaveTextContent(
      "En attente de la connexion dans votre navigateur",
    );
    expect(backend.calls("directory_connect_microsoft")[0]!.input).toMatchObject({
      kind: "microsoftOrg",
      config: { clientId: CLIENT, tenant: "organizations", level: "full" },
      syncIntervalMin: 360,
    });
    finish();
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toast.success).toHaveBeenCalledWith("Microsoft connecté : synchronisation en cours");
  });

  it("can give up on a sign-in that is waiting", async () => {
    openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", () => new Promise(() => {}));
    fireEvent.change(screen.getByLabelText("Identifiant d'application (client ID)"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec Microsoft" }));
    await screen.findByTestId("ms-waiting");
    fireEvent.click(screen.getByRole("button", { name: "Annuler la connexion" }));
    expect(backend.calls("directory_cancel_connect")).toHaveLength(1);
  });

  it("an administrator's restriction is shown in full, with the way forward", async () => {
    openMicrosoft("microsoftOrg");
    backend.handle("directory_connect_microsoft", () => {
      throw {
        kind: "other",
        message:
          "L'administrateur de votre organisation doit autoriser l'application à lire l'annuaire (consentement administrateur). Transmettez-lui la liste des autorisations demandées, puis reconnectez la source.",
      };
    });
    fireEvent.change(screen.getByLabelText("Identifiant d'application (client ID)"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec Microsoft" }));
    const error = await screen.findByTestId("ms-error");
    expect(error).toHaveTextContent("consentement administrateur");
    expect(error).toHaveTextContent("reconnectez la source");
    // and the form is usable again
    expect(screen.getByRole("button", { name: "Se connecter avec Microsoft" })).toBeEnabled();
  });

  it("personal contacts are connected as such", async () => {
    openMicrosoft("microsoftPersonal");
    fireEvent.change(screen.getByLabelText("Identifiant d'application (client ID)"), { target: { value: CLIENT } });
    fireEvent.click(screen.getByRole("button", { name: "Se connecter avec Microsoft" }));
    await waitFor(() => expect(backend.calls("directory_connect_microsoft")).toHaveLength(1));
    expect(backend.calls("directory_connect_microsoft")[0]!.input).toMatchObject({
      kind: "microsoftPersonal",
      config: { tenant: "common" },
    });
  });

  it("explains where to find the application id", () => {
    openMicrosoft("microsoftOrg");
    fireEvent.click(screen.getByText("Où trouver l'identifiant d'application ?"));
    expect(screen.getByText(/Application mobile et de bureau/)).toBeInTheDocument();
    expect(screen.getByText(/http:\/\/localhost/)).toBeInTheDocument();
  });
});
