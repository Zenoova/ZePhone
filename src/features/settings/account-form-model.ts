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
    };
  }
  return {
    label: a.label,
    displayName: a.displayName ?? "",
    server: a.server,
    port: String(a.port),
    transport: a.transport,
    domain: a.domain === a.server ? "" : a.domain,
    username: a.username,
    authUsername: a.authUsername ?? "",
    password: "",
    outboundProxy: a.outboundProxy ?? "",
    registerInterval: String(a.registerInterval),
    mediaEncryption: a.mediaEncryption,
    enabled: a.enabled,
  };
}

export function toInput(f: FormState, id: string | null): AccountInput {
  const opt = (v: string) => (v.trim() ? v.trim() : null);
  const num = (v: string) => (v.trim() === "" ? null : Number(v));
  return {
    id,
    label: f.label.trim(),
    displayName: opt(f.displayName),
    server: f.server.trim(),
    port: num(f.port),
    domain: opt(f.domain),
    username: f.username.trim(),
    authUsername: opt(f.authUsername),
    transport: f.transport,
    outboundProxy: opt(f.outboundProxy),
    registerInterval: num(f.registerInterval),
    mediaEncryption: f.mediaEncryption,
    enabled: f.enabled,
    password: f.password === "" ? null : f.password,
  };
}
