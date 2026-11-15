import { Delete, Phone, UserPlus } from "@/components/icons";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "@yusufceng1z/ding-react";

import { StatusDot } from "@/components/RegistrationBadge";
import { Button } from "@/components/ui/button";
import { Button as ArcButton } from "@/components/arc/button/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { isOverlayOpen, isShortcut, isTypingTarget } from "@/lib/keyboard";
import { looksDialable, sanitizeDialInput } from "@/lib/phone";
import { redialValue } from "@/lib/redial";
import { cn } from "@/lib/utils";
import { errorMessage, telephony } from "@/services/telephony";
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
  const setSection = useUiStore((s) => s.setSection);
  const dialing = useCallsStore((s) => s.dialing);
  const dial = useCallsStore((s) => s.dial);
  const usable = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);
  const selected = usable.find((a) => a.id === dialAccountId) ?? selectDefaultAccount(usable);
  const selectedState = selected ? (statuses[selected.id]?.state ?? "disconnected") : "disconnected";
  const canPlace = !dialing && !!selected && isEngineRunning(engine);

  /** Empty display + "Appeler": bring back the number of the last outgoing call (the user then confirms). */
  const fillWithLastNumber = async () => {
    try {
      const [last] = await telephony.listHistory({ kind: "outgoing", limit: 1 });
      if (!last) {
        toast.info("Aucun appel sortant à rappeler");
        return;
      }
      setDialValue(sanitizeDialInput(redialValue(last, accounts)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const place = async () => {
    if (!canPlace) return;
    if (!looksDialable(dialValue)) {
      await fillWithLastNumber();
      return;
    }
    const call = await dial(dialValue.trim(), dialAccountId ?? selected?.id ?? null);
    if (call) {
      setDialValue("");
      setSection("dialer");
    }
  };

  const append = (k: string) => setDialValue(sanitizeDialInput(dialValue + k));

  // The keyboard listener below outlives renders: it always calls the latest `place`.
  const placeRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    placeRef.current = place;
  });

  // Keys that are not keypad buttons (the keypad handles 0-9 * # itself): editing, calling, SIP-address characters.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || isShortcut(e) || isTypingTarget(e.target) || isOverlayOpen()) return;
      const { dialValue: value } = useUiStore.getState();
      if (e.key === "Backspace") {
        e.preventDefault();
        setDialValue(e.altKey ? "" : value.slice(0, -1));
      } else if (e.key === "Escape" || e.key === "Delete") {
        if (value) {
          e.preventDefault();
          setDialValue("");
        }
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!e.repeat) void placeRef.current();
      } else if (e.key.length === 1 && /^[A-Za-z@._:+ -]$/.test(e.key) && !(e.key === " " && value === "")) {
        e.preventDefault();
        setDialValue(sanitizeDialInput(value + e.key));
      }
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isTypingTarget(e.target) || isOverlayOpen()) return;
      const text = e.clipboardData?.getData("text") ?? "";
      const line = text.split(/\r?\n/)[0]?.trim() ?? "";
      if (!line) return;
      e.preventDefault();
      setDialValue(sanitizeDialInput(line));
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("paste", onPaste);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("paste", onPaste);
    };
  }, [setDialValue]);

  if (accounts.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 pb-[6.5rem] text-center">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <UserPlus className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Bienvenue dans ZePhone</h1>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Ajoutez votre compte SIP (serveur, identifiant, mot de passe) pour passer et recevoir des appels.
          </p>
        </div>
        <ArcButton onClick={() => setSection("accounts")}>Ajouter un compte SIP</ArcButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-4 p-5 pb-[6.5rem]">
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

      {/* The number is written straight on the background: no field, no placeholder. */}
      <div className="relative">
        <div
          role="textbox"
          aria-readonly="true"
          aria-label="Numéro à appeler"
          data-testid="dial-display"
          data-selectable
          className="flex h-20 w-full items-center justify-center px-14 text-center"
        >
          <span
            className={cn(
              "min-w-0 truncate font-light tracking-wide transition-[font-size] duration-150",
              dialValue.length > 14 ? "text-3xl" : "text-5xl",
            )}
          >
            {dialValue}
          </span>
        </div>
        {dialValue && (
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-1/2 right-0 -translate-y-1/2 rounded-full"
            aria-label="Effacer le dernier caractère"
            onClick={() => setDialValue(dialValue.slice(0, -1))}
            onDoubleClick={() => setDialValue("")}
          >
            <Delete className="size-5" />
          </Button>
        )}
      </div>

      <Dialpad captureKeyboard onKey={append} onLongZero={() => append("+")} />

      <Button
        size="lg"
        disabled={!canPlace}
        title={looksDialable(dialValue) ? undefined : "Rappeler le dernier numéro composé"}
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
