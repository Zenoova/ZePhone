import type { AccountInput, AccountView, MediaEncryption, Transport } from "@/types/telephony";

export interface FormState {
  label: string;
  displayName: string;
  server: string;
  port: string;
  transport: Transport;
  domain: string;
  username: string;
  authUsername: string;
  password: string;
  outboundProxy: string;
  registerInterval: string;
  mediaEncryption: MediaEncryption;
  enabled: boolean;
  /**
   * Optional fields that default to another field keep mirroring it until the user types something
   * different in them (see {@link editField}).
   */
  domainEdited: boolean;
  authEdited: boolean;
  labelEdited: boolean;
}

export const defaultPort = (t: Transport) => (t === "tls" ? "5061" : "5060");

export function toForm(a: AccountView | null): FormState {
  if (!a) {
    return {
      label: "",
      displayName: "",
      server: "",
      port: "5060",
      transport: "udp",
      domain: "",
      username: "",
      authUsername: "",
      password: "",
      outboundProxy: "",
      registerInterval: "300",
      mediaEncryption: "none",
      enabled: true,
      domainEdited: false,
      authEdited: false,
      labelEdited: false,
    };
  }
  return {
    label: a.label,
    displayName: a.displayName ?? "",
    server: a.server,
    port: String(a.port),
    transport: a.transport,
    domain: a.domain,
    username: a.username,
    authUsername: a.authUsername ?? a.username,
    password: "",
    outboundProxy: a.outboundProxy ?? "",
    registerInterval: String(a.registerInterval),
    mediaEncryption: a.mediaEncryption,
    enabled: a.enabled,
    domainEdited: a.domain !== a.server,
    authEdited: a.authUsername !== null && a.authUsername !== a.username,
    labelEdited: a.label !== `${a.username}@${a.domain}`,
  };
}

/** Default account name, same rule as the backend: `identifiant@domaine`. */
export function deriveLabel(f: Pick<FormState, "username" | "domain" | "server">): string {
  const user = f.username.trim();
  const domain = (f.domain.trim() || f.server.trim()).trim();
  return user && domain ? `${user}@${domain}` : "";
}

type Mirrored = "domain" | "authUsername" | "label";

/** Re-applies the "same as the other field" defaults, leaving the field being typed in untouched. */
function applyDefaults(f: FormState, editing?: keyof FormState): FormState {
  const domain = f.domainEdited || editing === "domain" ? f.domain : f.server;
  const authUsername = f.authEdited || editing === "authUsername" ? f.authUsername : f.username;
  const base = { ...f, domain, authUsername };
  const label = f.labelEdited || editing === "label" ? f.label : deriveLabel(base);
  return { ...base, label };
}

/**
 * Updates one field. Typing in the server also fills the domain, typing the identifier also fills the
 * authentication identifier and the account name, until the user writes a different value there.
 * Emptying a mirrored field hands it back to its default.
 */
export function editField<K extends keyof FormState>(f: FormState, key: K, value: FormState[K]): FormState {
  const next: FormState = { ...f, [key]: value };
  if (key === "domain") next.domainEdited = value !== "" && value !== f.server;
  if (key === "authUsername") next.authEdited = value !== "" && value !== f.username;
  if (key === "label") next.labelEdited = value !== "" && value !== deriveLabel(f);
  return applyDefaults(
    next,
    (["domain", "authUsername", "label"] as Mirrored[]).includes(key as Mirrored) ? key : undefined,
  );
}

export function toInput(f: FormState, id: string | null): AccountInput {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  // A value equal to its default is sent as "unset": the backend applies the same default.
  const unlessSameAs = (v: string, other: string) => (v.trim() && v.trim() !== other.trim() ? v.trim() : null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    id,
    label: unlessSameAs(f.label, deriveLabel(f)) ?? "",
    displayName: opt(f.displayName),
    server: f.server.trim(),
    port: num(f.port),
    domain: unlessSameAs(f.domain, f.server),
    username: f.username.trim(),
    authUsername: unlessSameAs(f.authUsername, f.username),
    transport: f.transport,
    outboundProxy: opt(f.outboundProxy),
    registerInterval: num(f.registerInterval),
    mediaEncryption: f.mediaEncryption,
    enabled: f.enabled,
    password: f.password === "" ? null : f.password,
  };
}
