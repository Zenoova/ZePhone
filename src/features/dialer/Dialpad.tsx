import { useEffect, useRef, useState } from "react";

import { isOverlayOpen, isShortcut, isTypingTarget } from "@/lib/keyboard";
import { playDtmfTone } from "@/lib/dtmf-tones";
import { DIALPAD_KEYS } from "@/lib/phone";
import { cn } from "@/lib/utils";

const KEYPAD_KEYS = new Set(DIALPAD_KEYS.map((k) => k.key));

interface DialpadProps {
  onKey: (key: string) => void;
  /** Called when "0" is held: the usual way to type "+". */
  onLongZero?: () => void;
  disabled?: boolean;
  compact?: boolean;
  /** Play the DTMF tone of each key (default). */
  sound?: boolean;
  /**
   * Physical keys 0-9, * and # press the matching button (same click, same sound, same animation)
   * instead of typing into a field.
   */
  captureKeyboard?: boolean;
  className?: string;
}

const PRESS_FLASH_MS = 130;

/** 3x4 numeric keypad (shared by the dialer and the in-call DTMF pad). */
export function Dialpad({
  onKey,
  onLongZero,
  disabled,
  compact,
  sound = true,
  captureKeyboard,
  className,
}: DialpadProps) {
  // Refs, not locals: a long press re-renders the parent before the click event fires.
  const holdTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const longPressed = useRef(false);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [flashed, setFlashed] = useState<string | null>(null);

  useEffect(
    () => () => {
      clearTimeout(holdTimer.current);
      clearTimeout(flashTimer.current);
    },
    [],
  );

  // Physical keyboard -> button click.
  useEffect(() => {
    if (!captureKeyboard || disabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || isShortcut(e) || isTypingTarget(e.target) || isOverlayOpen()) return;
      if (!KEYPAD_KEYS.has(e.key)) return;
      const button = buttons.current.get(e.key);
      if (!button) return;
      e.preventDefault();
      setFlashed(e.key);
      clearTimeout(flashTimer.current);
      flashTimer.current = setTimeout(() => setFlashed(null), PRESS_FLASH_MS);
      button.click();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [captureKeyboard, disabled]);

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
    <div role="group" aria-label="Numeric keypad" className={cn("grid grid-cols-3 gap-2.5", className)}>
      {DIALPAD_KEYS.map(({ key, letters }) => (
        <button
          key={key}
          ref={(el) => {
            if (el) buttons.current.set(key, el);
            else buttons.current.delete(key);
          }}
          type="button"
          disabled={disabled}
          aria-label={key === "*" ? "Star" : key === "#" ? "Pound" : key}
          data-pressed={flashed === key}
          onPointerDown={key === "0" ? startZero : undefined}
          onPointerUp={key === "0" ? endZero : undefined}
          onPointerLeave={key === "0" ? endZero : undefined}
          onClick={() => {
            if (key === "0" && longPressed.current) {
              longPressed.current = false;
              return;
            }
            if (sound) playDtmfTone(key);
            onKey(key);
          }}
          className={cn(
            "group bg-card hover:bg-accent active:bg-accent/70 focus-visible:ring-ring/50 flex flex-col items-center justify-center rounded-2xl border shadow-xs",
            "transition-[background-color,transform] duration-100 outline-none focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50",
            "active:scale-95 data-[pressed=true]:bg-accent data-[pressed=true]:scale-95",
            compact ? "h-12" : "h-16",
          )}
        >
          <span className={cn("leading-none font-medium", compact ? "text-lg" : "text-2xl")}>{key}</span>
          <span className="text-muted-foreground mt-0.5 h-3 text-[10px] leading-3 font-medium tracking-widest">
            {letters}
          </span>
        </button>
      ))}
    </div>
  );
}
