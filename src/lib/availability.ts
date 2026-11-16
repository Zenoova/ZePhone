import type { AccountStatus, AccountView } from "@/types/telephony";

/** What the user cares about: can this account be reached right now? */
export function availability(account: AccountView, status: AccountStatus | undefined): string {
  if (!account.enabled) return "Désactivé";
  switch (status?.state) {
    case "registered":
      return "Disponible";
    case "connecting":
      return "Connexion…";
    case "error":
      return status.sipCode ? `Indisponible · SIP ${status.sipCode}` : "Indisponible";
    case "unconfigured":
      return "Non configuré";
    default:
      return "Hors ligne";
  }
}
