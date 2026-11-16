import { Star } from "@/components/icons";
import { Badge } from "@/components/arc/badge/badge";
import { ContactAvatar } from "@/components/ContactAvatar";
import { Button } from "@/components/ui/button";
import { SOURCE_BADGE, entrySubtitle, sortedPhones } from "@/lib/directory";
import { cn } from "@/lib/utils";
import type { DirectoryEntry } from "@/types/directory";

import { CallButton } from "./CallButton";

export const ROW_HEIGHT = 64;

/** One person in the list. The row is only a summary: everything else is in the contact sheet. */
export function ContactRow({
  entry,
  active,
  selecting,
  selected,
  onOpen,
  onToggleSelected,
  onToggleFavorite,
  onCall,
}: {
  entry: DirectoryEntry;
  active: boolean;
  selecting: boolean;
  selected: boolean;
  onOpen: (e: DirectoryEntry) => void;
  onToggleSelected: (id: string) => void;
  onToggleFavorite: (e: DirectoryEntry) => void;
  onCall: (number: string) => void;
}) {
  const phones = sortedPhones(entry.phones);
  const subtitle = entrySubtitle(entry);
  return (
    <div
      data-testid="directory-row"
      data-active={active}
      className={cn(
        "hover:bg-accent/60 group flex h-full cursor-pointer items-center gap-3 rounded-xl px-3",
        active && "bg-accent/70 ring-ring/40 ring-2",
      )}
      onClick={() => (selecting ? onToggleSelected(entry.id) : onOpen(entry))}
    >
      {selecting ? (
        <input
          type="checkbox"
          checked={selected}
          readOnly
          tabIndex={-1}
          aria-label={`Select ${entry.displayName}`}
          className="accent-primary size-4 shrink-0"
        />
      ) : null}
      <ContactAvatar name={entry.displayName} />
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 truncate font-medium">
          <span className="truncate">{entry.displayName}</span>
          {entry.favorite && <Star className="text-warning size-3.5 shrink-0 fill-current" aria-label="Favorite" />}
        </p>
        <p className="text-muted-foreground truncate text-sm">
          {subtitle && <span>{subtitle} · </span>}
          {phones[0] && <span data-selectable>{phones[0].number}</span>}
          {phones.length > 1 && <span> · +{phones.length - 1}</span>}
        </p>
      </div>
      <div className="hidden shrink-0 gap-1 sm:flex">
        {entry.sources.map((s) => (
          <Badge key={s.recordId} tone="neutral" size="sm">
            {SOURCE_BADGE[s.kind]}
          </Badge>
        ))}
      </div>
      {!selecting && (
        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            tabIndex={-1}
            aria-label={
              entry.favorite ? `Remove ${entry.displayName} from favorites` : `Add ${entry.displayName} to favorites`
            }
            aria-pressed={entry.favorite}
            className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[on=true]:opacity-100"
            data-on={entry.favorite}
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(entry);
            }}
          >
            <Star className={cn("size-4", entry.favorite && "text-warning fill-current")} />
          </Button>
          <CallButton entry={entry} onCall={onCall} tabIndex={-1} />
        </div>
      )}
    </div>
  );
}
