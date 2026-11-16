import { Phone } from "@/components/icons";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Button } from "@/components/ui/button";
import { PHONE_KIND_LABEL, sortedPhones } from "@/lib/directory";
import type { DirectoryEntry } from "@/types/directory";

const ROUND = "bg-success text-success-foreground hover:bg-success/90 rounded-full";

/**
 * The call button of a person. With one number it calls it; with several it asks which one first, naming each by
 * what it is (business, mobile, internal extension...): a call is never placed on a number the user did not pick.
 */
export function CallButton({
  entry,
  onCall,
  tabIndex,
}: {
  entry: DirectoryEntry;
  onCall: (number: string) => void;
  /** -1 inside a list that handles the keyboard itself. */
  tabIndex?: number;
}) {
  const phones = sortedPhones(entry.phones);
  const name = entry.displayName;

  if (phones.length <= 1) {
    return (
      <Button
        size="icon"
        className={ROUND}
        aria-label={`Call ${name}`}
        disabled={phones.length === 0}
        tabIndex={tabIndex}
        onClick={(e) => {
          e.stopPropagation();
          if (phones[0]) onCall(phones[0].number);
        }}
      >
        <Phone className="size-4" />
      </Button>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          className={ROUND}
          aria-label={`Call ${name}: choose the number`}
          tabIndex={tabIndex}
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72" data-testid="number-chooser">
        <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">Call which number?</p>
        <ul className="space-y-0.5">
          {phones.map((p) => (
            <li key={`${p.kind}-${p.number}`}>
              <PopoverClose asChild>
                <button
                  type="button"
                  className="hover:bg-accent focus-visible:bg-accent flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left outline-none"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCall(p.number);
                  }}
                >
                  <span className="text-muted-foreground text-xs">{p.label ?? PHONE_KIND_LABEL[p.kind]}</span>
                  <span className="font-mono text-sm">{p.number}</span>
                </button>
              </PopoverClose>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
