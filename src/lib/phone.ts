/** Keys of the dialpad. */
export const DIALPAD_KEYS: ReadonlyArray<{ key: string; letters: string }> = [
  { key: "1", letters: "" },
  { key: "2", letters: "ABC" },
  { key: "3", letters: "DEF" },
  { key: "4", letters: "GHI" },
  { key: "5", letters: "JKL" },
  { key: "6", letters: "MNO" },
  { key: "7", letters: "PQRS" },
  { key: "8", letters: "TUV" },
  { key: "9", letters: "WXYZ" },
  { key: "*", letters: "" },
  { key: "0", letters: "+" },
  { key: "#", letters: "" },
];

/** Digits that can be sent as DTMF (RFC 4733): 0-9 * # A-D. */
export function isDtmfDigit(c: string): boolean {
  return /^[0-9*#A-Da-d]$/.test(c);
}

/** Keeps only characters that make sense in a dial string (numbers or SIP address). */
export function sanitizeDialInput(raw: string): string {
  return raw.replace(/[\r\n\t]/g, "").slice(0, 200);
}

/** Is the entry something we could dial at all? Real validation is done by the backend. */
export function looksDialable(value: string): boolean {
  return value.trim().length > 0;
}
