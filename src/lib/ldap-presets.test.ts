import { describe, expect, it } from "vitest";

import {
  ACTIVE_DIRECTORY_MAPPING,
  EMPTY_LDAP_CONFIG,
  OPEN_LDAP_MAPPING,
  joinList,
  parseList,
  presetConfig,
} from "./ldap-presets";

describe("ldap presets", () => {
  it("start a form from the right filter and field names for the server", () => {
    expect(presetConfig("openldap").filter).toBe("(objectClass=inetOrgPerson)");
    expect(presetConfig("openldap").mapping).toBe(OPEN_LDAP_MAPPING);
    const ad = presetConfig("activedirectory");
    expect(ad.mapping).toBe(ACTIVE_DIRECTORY_MAPPING);
    expect(ad.filter).toContain("userAccountControl");
    expect(ad.mapping.id[0]).toBe("objectGUID");
    expect(ad.mapping.company).toEqual(["company"]);
    // a number attribute for every kind the card can show
    expect(OPEN_LDAP_MAPPING.phones.map((p) => p.kind)).toEqual(["work", "mobile", "home", "extension"]);
  });

  it("an empty form is secure by default and asks for nothing it cannot use", () => {
    expect(EMPTY_LDAP_CONFIG).toMatchObject({ url: "", starttls: false, scope: "subtree", pageSize: 500 });
    expect(JSON.stringify(EMPTY_LDAP_CONFIG).toLowerCase()).not.toContain("password");
  });

  it("reads and writes lists of attributes", () => {
    expect(parseList("displayName, cn ,, mail\nuid")).toEqual(["displayName", "cn", "mail", "uid"]);
    expect(parseList("  ")).toEqual([]);
    expect(joinList(["a", "b"])).toBe("a, b");
  });
});
