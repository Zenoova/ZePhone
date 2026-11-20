import { ChevronDown, Delete, Phone, UserPlus } from "@/components/icons";
import { useEffect, useMemo, useRef } from "react";
import { toast } from "@yusufceng1z/ding-react";

import { StatusDot } from "@/components/RegistrationBadge";
import { Button } from "@/components/ui/button";
import { Button as ArcButton } from "@/components/arc/button/button";
import DropdownMenu from "@/components/arc/dropdown-menu/dropdown-menu";
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

export function DialerPage() {
  const accounts = useAccountsStore((s) => s.accounts);
  const statuses = useAccountsStore((s) => s.statuses);
  const engine = useEngineStore((s) => s.info);
  const dialValue = useUiStore((s) => s.dialValue);
  const setDialValue = useUiStore((s) => s.setDialValue);
  const setSection = useUiStore((s) => s.setSection);
  const openSettings = useUiStore((s) => s.openSettings);
  // A shortcut brought the window forward "on the dialer": the digits typed next go to the number, not to
  // whatever field had the focus.
  const focusRequest = useUiStore((s) => s.focusRequest);
  useEffect(() => {
    if (focusRequest !== "dialer") return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    useUiStore.getState().clearFocusRequest();
  }, [focusRequest]);
  const dialing = useCallsStore((s) => s.dialing);
  const dial = useCallsStore((s) => s.dial);
  const usable = useMemo(() => accounts.filter((a) => a.enabled), [accounts]);
  // “Call” always calls with the default account; another one is picked from the menu next to it.
  const selected = selectDefaultAccount(usable);
  const canPlace = !dialing && !!selected && isEngineRunning(engine);
  /** What the menu calls each account: its label, with the address when two accounts share a label, and "default". */
  const accountLabels = useMemo(() => {
    const count = new Map<string, number>();
    for (const a of usable) count.set(a.label, (count.get(a.label) ?? 0) + 1);
    return new Map(
      usable.map((a) => {
        const name = (count.get(a.label) ?? 0) > 1 ? `${a.label} (${a.username}@${a.domain})` : a.label;
        return [a.id, a.id === selected?.id ? `${name} · default` : name] as const;
      }),
    );
  }, [usable, selected?.id]);

  /** Empty display + "Call": bring back the number of the last outgoing call (the user then confirms). */
  const fillWithLastNumber = async () => {
    try {
      const [last] = await telephony.listHistory({ kind: "outgoing", limit: 1 });
      if (!last) {
        toast.info("No outgoing call to redial");
        return;
      }
      setDialValue(sanitizeDialInput(redialValue(last, accounts)));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  /** Places the call with `accountId`, or with the default account. */
  const place = async (accountId?: string) => {
    if (!canPlace) return;
    if (!looksDialable(dialValue)) {
      await fillWithLastNumber();
      return;
    }
    const call = await dial(dialValue.trim(), accountId ?? selected?.id ?? null);
    if (call) {
      setDialValue("");
      setSection("dialer");
    }
  };

  const append = (k: string) => setDialValue(sanitizeDialInput(dialValue + k));

  // The keyboard listener below outlives renders: it always calls the latest `place`.
  const placeRef = useRef<(accountId?: string) => Promise<void>>(async () => {});
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
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 pb-[calc(var(--dock-clearance)-0.5rem)] text-center">
        <div className="bg-primary/10 text-primary flex size-14 items-center justify-center rounded-full">
          <UserPlus className="size-7" aria-hidden />
        </div>
        <div>
          <h1 className="text-xl font-semibold">Welcome to ZePhone</h1>
          <p className="text-muted-foreground mx-auto mt-1 max-w-xs text-sm">
            Add your SIP account (server, username, password) to make and receive calls.
          </p>
        </div>
        <ArcButton onClick={() => openSettings("accounts")}>Add a SIP account</ArcButton>
      </div>
    );
  }

  return (
    <div className="mx-auto flex h-full w-full max-w-sm flex-col justify-center gap-4 p-5 pb-[calc(var(--dock-clearance)-0.5rem)]">
      {/* The number is written straight on the background: no field, no placeholder. */}
      <div className="relative">
        <div
          role="textbox"
          aria-readonly="true"
          aria-label="Number to call"
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
            aria-label="Delete the last character"
            onClick={() => setDialValue(dialValue.slice(0, -1))}
            onDoubleClick={() => setDialValue("")}
          >
            <Delete className="size-5" />
          </Button>
        )}
      </div>

      <Dialpad captureKeyboard onKey={append} onLongZero={() => append("+")} />

      <div className="flex w-full gap-1">
        <Button
          size="lg"
          disabled={!canPlace}
          title={looksDialable(dialValue) ? undefined : "Redial the last number dialled"}
          onClick={() => void place()}
          className={cn(
            "bg-success text-success-foreground hover:bg-success/90 h-14 flex-1 text-base font-semibold",
            usable.length > 1 ? "rounded-l-2xl rounded-r-md" : "rounded-2xl",
          )}
        >
          <Phone className="size-5" aria-hidden />
          {dialing ? "Calling…" : "Call"}
        </Button>
        {usable.length > 1 && (
          <DropdownMenu
            label="Call with"
            items={usable.map((a) => ({
              label: accountLabels.get(a.id) ?? a.label,
              icon: <StatusDot state={statuses[a.id]?.state ?? "disconnected"} />,
              onSelect: () => void place(a.id),
            }))}
            trigger={
              <Button
                size="lg"
                disabled={!canPlace || !looksDialable(dialValue)}
                aria-label="Choose the account to call with"
                title={looksDialable(dialValue) ? "Call with another account" : "Enter a number to choose the account"}
                className="bg-success text-success-foreground hover:bg-success/90 h-14 w-12 shrink-0 rounded-l-md rounded-r-2xl px-0"
              >
                <ChevronDown className="size-5" aria-hidden />
              </Button>
            }
          />
        )}
      </div>
      {!isEngineRunning(engine) && engine && (
        <p className="text-destructive text-center text-xs">The SIP engine is not started.</p>
      )}
    </div>
  );
}
