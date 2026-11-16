import type { CallResult, CallState, RegistrationState } from "@/types/telephony";

export const CALL_STATE_LABEL: Record<CallState, string> = {
  initializing: "Initializing…",
  dialing: "Call being dialled…",
  ringing: "Ringtone…",
  incoming: "Incoming call",
  connected: "Connected",
  onHold: "On hold",
  ended: "Ended",
  failed: "Failed",
};

export const REGISTRATION_LABEL: Record<RegistrationState, string> = {
  unconfigured: "Not configured",
  connecting: "Connecting",
  registered: "Saved",
  disconnected: "Disconnected",
  error: "Error",
};

export const RESULT_LABEL: Record<CallResult, string> = {
  answered: "Answered",
  missed: "Missed",
  rejected: "Declined",
  failed: "Failed",
  cancelled: "Cancelled",
};

export const TRANSPORT_LABEL = { udp: "UDP", tcp: "TCP", tls: "TLS (encrypted)" } as const;

export const MEDIA_ENCRYPTION_LABEL = {
  none: "None",
  srtp: "SRTP (if available)",
  "srtp-mandatory": "SRTP required",
} as const;
