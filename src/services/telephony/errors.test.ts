import { describe, expect, it } from "vitest";

import { errorMessage, toAppError } from "./errors";

describe("toAppError", () => {
  it("keeps the backend's {kind, message}", () => {
    expect(toAppError({ kind: "validation", message: "Invalid port" })).toEqual({
      kind: "validation",
      message: "Invalid port",
    });
  });
  it("accepts plain strings and unknown shapes", () => {
    expect(toAppError("boom")).toEqual({ kind: "unknown", message: "boom" });
    expect(toAppError({ message: "x" })).toEqual({ kind: "unknown", message: "x" });
    expect(toAppError(42)).toEqual({ kind: "unknown", message: "Unexpected error" });
    expect(toAppError(null)).toEqual({ kind: "unknown", message: "Unexpected error" });
  });
  it("errorMessage extracts the text", () => {
    expect(errorMessage({ kind: "engine", message: "no engine" })).toBe("no engine");
  });
});
