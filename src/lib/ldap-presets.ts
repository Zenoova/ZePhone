import type { LdapConfig, LdapMapping } from "@/types/directory";

/** The same defaults as the backend (`LdapMapping::open_ldap` and `::active_directory`), to start a form from. */
export const OPEN_LDAP_MAPPING: LdapMapping = {
  id: ["entryUUID", "nsUniqueId", "dn"],
  firstName: ["givenName"],
  lastName: ["sn"],
  displayName: ["displayName", "cn"],
  email: ["mail"],
  company: ["o"],
  department: ["departmentNumber", "ou"],
  title: ["title"],
  phones: [
    { attribute: "telephoneNumber", kind: "work" },
    { attribute: "mobile", kind: "mobile" },
    { attribute: "homePhone", kind: "home" },
    { attribute: "ipPhone", kind: "extension" },
  ],
};

export const ACTIVE_DIRECTORY_MAPPING: LdapMapping = {
  ...OPEN_LDAP_MAPPING,
  id: ["objectGUID", "dn"],
  company: ["company"],
  department: ["department"],
};

export const FILTER_OPEN_LDAP = "(objectClass=inetOrgPerson)";
/** People whose account is enabled: not computers, not disabled users. */
export const FILTER_ACTIVE_DIRECTORY =
  "(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))";

export type LdapPreset = "openldap" | "activedirectory";

export const LDAP_PRESET_LABEL: Record<LdapPreset, string> = {
  openldap: "OpenLDAP et autres (inetOrgPerson)",
  activedirectory: "Microsoft Active Directory",
};

export function presetConfig(p: LdapPreset): Pick<LdapConfig, "filter" | "mapping"> {
  return p === "activedirectory"
    ? { filter: FILTER_ACTIVE_DIRECTORY, mapping: ACTIVE_DIRECTORY_MAPPING }
    : { filter: FILTER_OPEN_LDAP, mapping: OPEN_LDAP_MAPPING };
}

export const EMPTY_LDAP_CONFIG: LdapConfig = {
  url: "",
  starttls: false,
  bindDn: "",
  baseDn: "",
  scope: "subtree",
  pageSize: 500,
  ...presetConfig("openldap"),
};

/** "a, b ,c" → ["a","b","c"]; and back. */
export const parseList = (s: string): string[] =>
  s
    .split(/[,\n]/)
    .map((x) => x.trim())
    .filter(Boolean);
export const joinList = (l: string[]): string => l.join(", ");
