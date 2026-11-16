/** The company directory (see `src-tauri/src/directory`). */

export type PhoneKind = "work" | "mobile" | "extension" | "home" | "sip" | "other";

export interface PhoneEntry {
  kind: PhoneKind;
  /** Exactly what the source gave: formatting and all. */
  number: string;
  label?: string;
}

export type SourceKind = "local" | "ldap" | "microsoftOrg" | "microsoftPersonal";

/** Why the last synchronisation failed; decides which action the UI offers. */
export type SyncErrorKind = "network" | "auth" | "forbidden" | "throttled" | "config" | "invalid" | "server";

export type SourceState = "idle" | "syncing" | "error" | "needsReauth" | "disabled";

export interface SourceView {
  id: string;
  kind: SourceKind;
  name: string;
  enabled: boolean;
  readOnly: boolean;
  state: SourceState;
  contactCount: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  lastError: string | null;
  errorKind: SyncErrorKind | null;
  /** Minutes between automatic synchronisations; 0 = manual only. */
  syncIntervalMin: number;
  /** The cache has not been refreshed for a long time. */
  stale: boolean;
  /** Non-secret settings of the source. */
  config: Record<string, unknown>;
}

export interface SourceRef {
  recordId: string;
  sourceId: string;
  sourceName: string;
  kind: SourceKind;
  externalId: string;
}

export interface DirectoryEntry {
  /** Id of the main record. */
  id: string;
  displayName: string;
  firstName: string;
  lastName: string;
  company: string | null;
  department: string | null;
  title: string | null;
  email: string | null;
  phones: PhoneEntry[];
  /** One record, or several when the same e-mail address is found in two sources. */
  sources: SourceRef[];
  favorite: boolean;
  /** Ids of the personal groups. */
  groups: string[];
  readOnly: boolean;
}

export interface DirectoryQuery {
  text: string;
  sourceIds: string[];
  groupId: string | null;
  department: string | null;
  favoritesOnly: boolean;
  offset: number;
  limit: number;
}

export interface DirectoryPage {
  items: DirectoryEntry[];
  total: number;
  offset: number;
}

export interface GroupView {
  id: string;
  name: string;
  memberCount: number;
}

export interface DepartmentCount {
  name: string;
  count: number;
}

// ------------------------------------------------------------------ LDAP

export type LdapScope = "subtree" | "oneLevel";

export interface PhoneAttribute {
  attribute: string;
  kind: PhoneKind;
}

export interface LdapMapping {
  id: string[];
  firstName: string[];
  lastName: string[];
  displayName: string[];
  email: string[];
  company: string[];
  department: string[];
  title: string[];
  phones: PhoneAttribute[];
}

export interface LdapConfig {
  url: string;
  starttls: boolean;
  bindDn: string;
  baseDn: string;
  scope: LdapScope;
  filter: string;
  pageSize: number;
  mapping: LdapMapping;
}

/** What the settings form sends. The password is only set when the user typed one. */
export interface LdapSourceInput {
  id?: string;
  name: string;
  config: LdapConfig;
  password?: string;
  syncIntervalMin: number;
}

export interface Failure {
  kind: SyncErrorKind;
  message: string;
}

export interface PreviewContact {
  externalId: string;
  firstName: string;
  lastName: string;
  displayName: string;
  company: string | null;
  department: string | null;
  title: string | null;
  email: string | null;
  phones: PhoneEntry[];
}

export interface LdapTestReport {
  authenticated: boolean;
  preview: PreviewContact[];
  skipped: number;
  warnings: string[];
}

export interface LdapTestResult {
  ok: boolean;
  report: LdapTestReport | null;
  error: Failure | null;
}

// ------------------------------------------------------------------ Microsoft 365

export type MicrosoftLevel = "basic" | "full";

export interface MicrosoftConfig {
  clientId: string;
  tenant: string;
  level: MicrosoftLevel;
}

export interface MicrosoftSourceInput {
  /** Set to sign an existing source in again. */
  sourceId?: string;
  kind: "microsoftOrg" | "microsoftPersonal";
  name: string;
  config: MicrosoftConfig;
  syncIntervalMin: number;
}
