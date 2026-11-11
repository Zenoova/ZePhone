import type { CallResult, CallState, RegistrationState } from "@/types/telephony";

export const CALL_STATE_LABEL: Record<CallState, string> = {
  initializing: "Initialisation…",
  dialing: "Appel en cours de composition…",
  ringing: "Sonnerie…",
  incoming: "Appel entrant",
  connected: "Connecté",
  onHold: "En attente",
  ended: "Terminé",
  failed: "Échec",
};

export const REGISTRATION_LABEL: Record<RegistrationState, string> = {
  unconfigured: "Non configuré",
  connecting: "Connexion en cours",
  registered: "Enregistré",
  disconnected: "Déconnecté",
  error: "Erreur",
};

export const RESULT_LABEL: Record<CallResult, string> = {
  answered: "Répondu",
  missed: "Manqué",
  rejected: "Refusé",
  failed: "Échoué",
  cancelled: "Annulé",
};

export const TRANSPORT_LABEL = { udp: "UDP", tcp: "TCP", tls: "TLS (chiffré)" } as const;

export const MEDIA_ENCRYPTION_LABEL = {
  none: "Aucun",
  srtp: "SRTP (si disponible)",
  "srtp-mandatory": "SRTP obligatoire",
} as const;
