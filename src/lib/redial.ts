import type { AccountView, HistoryEntry } from "@/types/telephony";

/**
 * What to put back in the dialer to call a previous outgoing call again: the bare number/extension
 * when it was dialled on the account's own domain, the full address (without `sip:`) otherwise.
 */
export function redialValue(
  entry: Pick<HistoryEntry, "remoteUri" | "remoteNumber" | "accountId">,
  accounts: AccountView[],
): string {
  const uri = entry.remoteUri.trim();
  const withoutScheme = uri.replace(/^sips?:/i, "");
  const address = withoutScheme.split(";")[0] ?? withoutScheme;
  const at = address.lastIndexOf("@");
  if (at < 0) return entry.remoteNumber || address;
  const host = address
    .slice(at + 1)
    .replace(/:\d+$/, "")
    .toLowerCase();
  const account = accounts.find((a) => a.id === entry.accountId);
  const sameDomain = account && (host === account.domain.toLowerCase() || host === account.server.toLowerCase());
  return sameDomain && entry.remoteNumber ? entry.remoteNumber : address;
}
