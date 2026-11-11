import { describe, expect, it } from "vitest";

import { errorMessage, toAppError } from "./errors";

describe("toAppError", () => {
  it("keeps the backend's {kind, message}", () => {
    expect(toAppError({ kind: "validation", message: "Port invalide" })).toEqual({
      kind: "validation",
      message: "Port invalide",
    });
  });
  it("accepts plain strings and unknown shapes", () => {
    expect(toAppError("boom")).toEqual({ kind: "unknown", message: "boom" });
    expect(toAppError({ message: "x" })).toEqual({ kind: "unknown", message: "x" });
    expect(toAppError(42)).toEqual({ kind: "unknown", message: "Erreur inattendue" });
    expect(toAppError(null)).toEqual({ kind: "unknown", message: "Erreur inattendue" });
  });
  it("errorMessage extracts the text", () => {
    expect(errorMessage({ kind: "engine", message: "pas de moteur" })).toBe("pas de moteur");
  });
});
