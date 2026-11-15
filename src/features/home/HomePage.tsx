import { DialerPage } from "@/features/dialer/DialerPage";

/** The home page: the keypad. Calls have a window of their own (see `CallWindow`). */
export function HomePage() {
  return (
    <div className="animate-in fade-in-0 h-full duration-300">
      <DialerPage />
    </div>
  );
}
