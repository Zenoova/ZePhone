import type { AccountStatus, AccountView } from "@/types/telephony";

/** What the user cares about: can this account be reached right now? */
export function availability(account: AccountView, status: AccountStatus | undefined): string {
  if (!account.enabled) return "Disabled";
  switch (status?.state) {
    case "registered":
      return "Available";
    case "connecting":
      return "Connecting…";
    case "error":
      return status.sipCode ? `Unavailable · SIP ${status.sipCode}` : "Unavailable";
    case "unconfigured":
      return "Not configured";
    default:
      return "Offline";
  }
}
