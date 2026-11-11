import { useMemo } from "react";

import { StatusDot } from "@/components/RegistrationBadge";
import { REGISTRATION_LABEL } from "@/lib/labels";
import { summarizeRegistration, useAccountsStore } from "@/stores/accounts-store";
import { useEngineStore } from "@/stores/engine-store";
import { useUiStore } from "@/stores/ui-store";

/** Always-visible SIP connection indicator (real registration state, with the SIP code on errors). */
export function StatusBar() {
  const accounts = useAccountsStore((s) => s.accounts);
  const statuses = useAccountsStore((s) => s.statuses);
  const engine = useEngineStore((s) => s.info);
  const openSettings = useUiStore((s) => s.openSettings);
  const summary = useMemo(() => summarizeRegistration(accounts, statuses), [accounts, statuses]);

  const registered = accounts.filter((a) => statuses[a.id]?.state === "registered").length;
  const stateLabel = summary.state === "none" ? "Aucun compte configuré" : REGISTRATION_LABEL[summary.state];
  const code = summary.state === "error" && summary.status?.sipCode ? ` (SIP ${summary.status.sipCode})` : "";

  return (
    <footer className="bg-sidebar/60 text-muted-foreground flex h-8 shrink-0 items-center justify-between gap-3 border-t px-3 text-xs">
      <button
        type="button"
        onClick={() => openSettings("accounts")}
        className="hover:text-foreground flex min-w-0 items-center gap-2 outline-none focus-visible:underline"
        title={summary.status?.message ?? undefined}
        data-testid="connection-status"
        data-state={summary.state}
      >
        <StatusDot state={summary.state} />
        <span className="truncate">
          {summary.state !== "none" && summary.label ? `${summary.label} — ` : ""}
          {stateLabel}
          {code}
        </span>
        {accounts.length > 1 && <span className="shrink-0">· {registered}/{accounts.length} enregistrés</span>}
      </button>
      <span className="hidden shrink-0 sm:inline" aria-label="Moteur SIP">
        {engine ? `${engine.name} ${engine.version ?? ""}` : "…"}
      </span>
    </footer>
  );
}
