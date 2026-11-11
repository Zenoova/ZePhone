import { useRef } from "react";

import { DIALPAD_KEYS } from "@/lib/phone";
import { cn } from "@/lib/utils";

interface DialpadProps {
  onKey: (key: string) => void;
  /** Called when "0" is held: the usual way to type "+". */
  onLongZero?: () => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
}

/** 3x4 numeric keypad (shared by the dialer and the in-call DTMF pad). */
export function Dialpad({ onKey, onLongZero, disabled, compact, className }: DialpadProps) {
  // Refs, not locals: a long press re-renders the parent before the click event fires.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);

  const startZero = () => {
    longPressed.current = false;
    if (!onLongZero) return;
    holdTimer.current = setTimeout(() => {
      longPressed.current = true;
      onLongZero();
    }, 550);
  };
  const endZero = () => clearTimeout(holdTimer.current);

  return (
    <div role="group" aria-label="Clavier numérique" className={cn("grid grid-cols-3 gap-2.5", className)}>
      {DIALPAD_KEYS.map(({ key, letters }) => (
        <button
          key={key}
          type="button"
          disabled={disabled}
          aria-label={key === "*" ? "Étoile" : key === "#" ? "Dièse" : key}
          onPointerDown={key === "0" ? startZero : undefined}
          onPointerUp={key === "0" ? endZero : undefined}
          onPointerLeave={key === "0" ? endZero : undefined}
          onClick={() => {
            if (key === "0" && longPressed.current) {
              longPressed.current = false;
              return;
            }
            onKey(key);
          }}
          className={cn(
            "group bg-card hover:bg-accent active:bg-accent/70 focus-visible:ring-ring/50 flex flex-col items-center justify-center rounded-2xl border shadow-xs",
            "transition-colors outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50",
            compact ? "h-12" : "h-16",
          )}
        >
          <span className={cn("leading-none font-medium", compact ? "text-lg" : "text-2xl")}>{key}</span>
          <span className="text-muted-foreground mt-0.5 h-3 text-[10px] leading-3 font-medium tracking-widest">{letters}</span>
        </button>
      ))}
    </div>
  );
}
