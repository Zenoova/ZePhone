import { describe, expect, it } from "vitest";

import { makeAccount } from "@/test/fixtures";

import { deriveLabel, editField, toForm, toInput } from "./account-form-model";

const empty = () => toForm(null);

describe("mirrored optional fields (new account)", () => {
  it("typing the server also fills the domain", () => {
    let f = editField(empty(), "server", "sip.example.com");
    expect(f.domain).toBe("sip.example.com");
    f = editField(f, "server", "sip.example.co");
    expect(f.domain).toBe("sip.example.co");
  });

  it("typing the identifier also fills the authentication identifier and the account name", () => {
    let f = editField(empty(), "server", "pbx.lan");
    f = editField(f, "username", "1001");
    expect(f.authUsername).toBe("1001");
    expect(f.label).toBe("1001@pbx.lan");
    f = editField(f, "username", "100");
    expect(f.authUsername).toBe("100");
    expect(f.label).toBe("100@pbx.lan");
  });

  it("stops mirroring a field once the user writes something different in it", () => {
    let f = editField(empty(), "server", "sip.example.com");
    f = editField(f, "domain", "example.com");
    expect(f.domainEdited).toBe(true);
    f = editField(f, "server", "sip2.example.com");
    expect(f.domain).toBe("example.com"); // untouched by the server now
    // The account name follows the (edited) domain.
    f = editField(f, "username", "1001");
    expect(f.label).toBe("1001@example.com");
  });

  it("keeps a custom account name and authentication identifier", () => {
    let f = editField(empty(), "server", "pbx.lan");
    f = editField(f, "label", "Office");
    f = editField(f, "authUsername", "auth-1001");
    f = editField(f, "username", "1001");
    expect(f.label).toBe("Office");
    expect(f.authUsername).toBe("auth-1001");
  });

  it("lets the user empty a mirrored field while typing, and resumes mirroring afterwards", () => {
    let f = editField(empty(), "server", "pbx.lan");
    f = editField(f, "domain", "other.lan");
    f = editField(f, "domain", ""); // select-all + delete
    expect(f.domain).toBe(""); // not instantly refilled under the user's fingers
    expect(f.domainEdited).toBe(false);
    f = editField(f, "server", "pbx2.lan");
    expect(f.domain).toBe("pbx2.lan");
  });

  it("typing the same value as the source counts as 'not customised'", () => {
    let f = editField(empty(), "server", "pbx.lan");
    f = editField(f, "domain", "pbx.lan");
    expect(f.domainEdited).toBe(false);
    f = editField(f, "server", "pbx3.lan");
    expect(f.domain).toBe("pbx3.lan");
  });
});

describe("toInput", () => {
  it("sends mirrored values as unset so the backend applies the same defaults", () => {
    let f = editField(empty(), "server", "sip.example.com");
    f = editField(f, "username", "1001");
    f = editField(f, "password", "pw");
    const input = toInput(f, null);
    expect(input.domain).toBeNull();
    expect(input.authUsername).toBeNull();
    expect(input.label).toBe("");
    expect(input).toMatchObject({ server: "sip.example.com", username: "1001", password: "pw" });
  });

  it("sends customised values", () => {
    let f = editField(empty(), "server", "sip.example.com");
    f = editField(f, "username", "1001");
    f = editField(f, "domain", "example.com");
    f = editField(f, "authUsername", "auth1001");
    f = editField(f, "label", "Office");
    expect(toInput(f, "x")).toMatchObject({
      id: "x",
      domain: "example.com",
      authUsername: "auth1001",
      label: "Office",
    });
  });
});

describe("toForm (existing account)", () => {
  it("shows the effective values and only freezes the fields that really differ", () => {
    const plain = makeAccount({
      server: "pbx.lan",
      domain: "pbx.lan",
      username: "1001",
      authUsername: null,
      label: "1001@pbx.lan",
    });
    const f = toForm(plain);
    expect([f.domain, f.authUsername, f.label]).toEqual(["pbx.lan", "1001", "1001@pbx.lan"]);
    expect([f.domainEdited, f.authEdited, f.labelEdited]).toEqual([false, false, false]);
    // Editing the server of such an account keeps the domain in sync.
    expect(editField(f, "server", "pbx2.lan").domain).toBe("pbx2.lan");

    const custom = toForm(
      makeAccount({
        server: "sip.example.com",
        domain: "example.com",
        username: "1001",
        authUsername: "auth",
        label: "Office",
      }),
    );
    expect([custom.domainEdited, custom.authEdited, custom.labelEdited]).toEqual([true, true, true]);
    expect(editField(custom, "server", "x.com").domain).toBe("example.com");
  });

  it("derives the default label like the backend", () => {
    expect(deriveLabel({ username: "1001", domain: "", server: "pbx.lan" })).toBe("1001@pbx.lan");
    expect(deriveLabel({ username: "", domain: "", server: "pbx.lan" })).toBe("");
  });
});
