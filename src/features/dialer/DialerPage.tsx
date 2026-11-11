import { Delete, Phone, UserPlus } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";

import { StatusDot } from "@/components/RegistrationBadge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { looksDialable, sanitizeDialInput } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { selectDefaultAccount, useAccountsStore } from "@/stores/accounts-store";
import { useCallsStore } from "@/stores/calls-store";
import { isEngineRunning, useEngineStore } from "@/stores/engine-store";
import { useUiStore } from "@/stores/ui-store";

import { Dialpad } from "./Dialpad";

const DEFAULT_ACCOUNT = "__default__";

export function DialerPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const statuses = useAccountsStore((s) => s.statuses);
  const engine = useEngineStore((s) => s.info);
  const dialValue = useUiStore((s) => s.dialValue);
  const setDialValue = useUiStore((s) => s.setDialValue);
  const dialAccountId = useUiStore((s) => s.dialAccountId);
  const setDialAccount = useUiStore((s) => s.setDialAccount);
  const openSettings = useUiStore((s) => s.openSettings);
  const setSection = useUiStore((s) => s.setSection);
  const dialing = useCallsStore((s) => s.dialing);
  const dial = useCallsStore((s) => s.dial);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => inputRef.current?.focus(), []);

  const usable = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);
  const selected = usable.find((a) => a.id === dialAccountId) ?? selectDefaultAccount(usable);
  const selectedState = selected ? (statuses[selected.id]?.state ?? "disconnected") : "disconnected";
  const canCall = looksDialable(dialValue) && !dialing && !!selected && isEngineRunning(engine);

  const place = async () => {
    if (!canCall) return;
    const call = await dial(dialValue.trim(), dialAccountId ?? selected?.id ?? null);
    if (call) {
      setDialValue("");
      setSection("calls");
    }
  };

  const append = (k: string) => {
    setDialValue(sanitizeDialInput(dialValue + k));
    inputRef.current?.focus();
  };

  if (accounts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <UserPlus className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Bienvenue dans ZePhone</h1>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Ajoutez votre compte SIP (serveur, identifiant, mot de passe) pour passer et recevoir des appels.
          </p>
        </div>
        <Button onClick={() => openSettings("accounts")}>Ajouter un compte SIP</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-4 p-5">
      {usable.length > 1 && (
        <Select
          value={dialAccountId ?? DEFAULT_ACCOUNT}
          onValueChange={(v) => setDialAccount(v === DEFAULT_ACCOUNT ? null : v)}
        >
          <SelectTrigger className="w-full" aria-label="Compte utilisé pour l'appel">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_ACCOUNT}>Compte par défaut</SelectItem>
            {usable.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                <StatusDot state={statuses[a.id]?.state ?? "disconnected"} /> {a.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {usable.length === 1 && selected && (
        <p className="text-muted-foreground flex items-center justify-center gap-2 text-xs">
          <StatusDot state={selectedState} /> {selected.label}
        </p>
      )}

      <div className="relative">
        <input
          ref={inputRef}
          value={dialValue}
          onChange={(e) => setDialValue(sanitizeDialInput(e.target.value))}
          onKeyDown={(e) => e.key === "Enter" && void place()}
          inputMode="tel"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Numéro ou adresse SIP"
          aria-label="Numéro à appeler"
          className={cn(
            "bg-card h-16 w-full rounded-2xl border px-14 text-center font-medium tracking-wide shadow-xs outline-none",
            "focus-visible:ring-ring/50 focus-visible:border-ring focus-visible:ring-[3px]",
            dialValue.length > 14 ? "text-lg" : "text-2xl",
          )}
        />
        {dialValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-full"
            aria-label="Effacer le dernier caractère"
            onClick={() => setDialValue(dialValue.slice(0, -1))}
            onDoubleClick={() => setDialValue("")}
          >
            <Delete className="size-5" />
          </Button>
        )}
      </div>

      <Dialpad onKey={append} onLongZero={() => append("+")} />

      <Button
        size="lg"
        disabled={!canCall}
        onClick={() => void place()}
        className="bg-success text-success-foreground hover:bg-success/90 h-14 w-full rounded-2xl text-base font-semibold"
      >
        <Phone className="size-5" aria-hidden />
        {dialing ? "Appel…" : "Appeler"}
      </Button>
      {!isEngineRunning(engine) && engine && (
        <p className="text-destructive text-center text-xs">Le moteur SIP n'est pas démarré.</p>
      )}
    </div>
  );
}
