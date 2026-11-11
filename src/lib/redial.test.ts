import { describe, expect, it } from "vitest";

import { makeAccount, makeHistory } from "@/test/fixtures";

import { redialValue } from "./redial";

describe("redialValue", () => {
  const accounts = [makeAccount({ id: "acc1", domain: "example.com", server: "sip.example.com" })];

  it("gives the bare number for a call on the account's own domain", () => {
    expect(redialValue(makeHistory({ remoteUri: "sip:1002@example.com", remoteNumber: "1002" }), accounts)).toBe(
      "1002",
    );
    expect(
      redialValue(
        makeHistory({ remoteUri: "sip:+33612345678@sip.example.com:5060", remoteNumber: "+33612345678" }),
        accounts,
      ),
    ).toBe("+33612345678");
  });

  it("keeps the full address (without sip:) for another domain", () => {
    expect(redialValue(makeHistory({ remoteUri: "sip:bob@other.org", remoteNumber: "bob" }), accounts)).toBe(
      "bob@other.org",
    );
    expect(
      redialValue(makeHistory({ remoteUri: "sips:bob@other.org:5061;transport=tls", remoteNumber: "bob" }), accounts),
    ).toBe("bob@other.org:5061");
  });

  it("keeps the full address when the account no longer exists", () => {
    expect(redialValue(makeHistory({ accountId: "gone", remoteUri: "sip:1002@example.com" }), accounts)).toBe(
      "1002@example.com",
    );
  });

  it("handles a user-less URI", () => {
    expect(redialValue(makeHistory({ remoteUri: "sip:example.com", remoteNumber: "example.com" }), accounts)).toBe(
      "example.com",
    );
  });
});
