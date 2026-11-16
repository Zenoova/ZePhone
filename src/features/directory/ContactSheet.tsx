import { Copy, Mail, Pencil, Phone, PhoneForwarded, Star, Trash2 } from "@/components/icons";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { ContactAvatar } from "@/components/ContactAvatar";
import { PHONE_KIND_LABEL, SOURCE_BADGE, SOURCE_KIND_LABEL, entrySubtitle, sortedPhones } from "@/lib/directory";
import { cn } from "@/lib/utils";
import { useDirectoryStore } from "@/stores/directory-store";
import type { DirectoryEntry } from "@/types/directory";

import { useDirectoryActions } from "./actions";
import { GroupPicker } from "./GroupPicker";

/**
 * A person's card: who they are, every number with what it is, and for each number the three things to do with
 * it — call, copy, transfer the call in progress. Where the card comes from is kept, and said.
 */
export function ContactSheet({
  entry,
  onClose,
  onEdit,
  onDelete,
  onManageGroups,
}: {
  entry: DirectoryEntry | null;
  onClose: () => void;
  /** Local contacts only. */
  onEdit: (e: DirectoryEntry) => void;
  onDelete: (e: DirectoryEntry) => void;
  onManageGroups: () => void;
}) {
  const actions = useDirectoryActions();
  const groups = useDirectoryStore((s) => s.groups);
  const toggleFavorite = useDirectoryStore((s) => s.toggleFavorite);

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      {entry && (
        <DialogContent
          title={entry.displayName}
          description={entrySubtitle(entry) || "Contact card"}
          style={{ width: "min(calc(100vw - 2rem), 600px)" }}
        >
          <div className="space-y-5" data-testid="contact-sheet">
            <div className="flex items-center gap-3">
              <ContactAvatar name={entry.displayName} className="size-14 text-lg" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap gap-1.5">
                  {entry.sources.map((s) => (
                    <Badge key={s.recordId} tone="neutral" size="sm">
                      {SOURCE_BADGE[s.kind]} · {s.sourceName}
                    </Badge>
                  ))}
                  {entry.readOnly && (
                    <Badge tone="info" size="sm">
                      Read-only
                    </Badge>
                  )}
                </div>
                {entry.email && (
                  <p className="flex items-center gap-1.5 text-sm">
                    <Mail className="text-muted-foreground size-3.5" aria-hidden />
                    <span className="truncate" data-selectable>
                      {entry.email}
                    </span>
                  </p>
                )}
              </div>
            </div>

            <section aria-label="Numbers">
              <ul className="divide-y rounded-xl border" data-testid="phone-list">
                {sortedPhones(entry.phones).map((p) => {
                  const kind = p.label ?? PHONE_KIND_LABEL[p.kind];
                  return (
                    <li
                      key={`${p.kind}-${p.number}`}
                      className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                      data-testid="phone-row"
                    >
                      <div className="min-w-40 flex-1">
                        <p className="text-muted-foreground text-xs">{kind}</p>
                        <p className="font-mono text-sm break-all" data-selectable>
                          {p.number}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          aria-label={`Call ${kind} ${p.number}`}
                          onClick={() => void actions.call(p.number).then((ok) => ok && onClose())}
                        >
                          <Phone className="size-4" aria-hidden /> Call
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Copy ${p.number}`}
                          onClick={() => void actions.copy(p.number)}
                        >
                          <Copy className="size-4" aria-hidden /> Copy
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!actions.activeCall}
                          title={
                            actions.activeCall
                              ? "Transfer the current call to this number"
                              : "No call in progress to transfer"
                          }
                          aria-label={`Transfer the call to ${p.number}`}
                          onClick={() => void actions.transfer(p.number).then((ok) => ok && onClose())}
                        >
                          <PhoneForwarded className="size-4" aria-hidden /> Transfer
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                aria-pressed={entry.favorite}
                onClick={() => void toggleFavorite(entry)}
              >
                <Star className={cn("size-4", entry.favorite && "text-warning fill-current")} aria-hidden />
                {entry.favorite ? "Favorite" : "Add to favorites"}
              </Button>
              <GroupPicker
                entries={[entry]}
                onManage={onManageGroups}
                trigger={
                  <Button size="sm" variant="secondary">
                    Groups{entry.groups.length > 0 && ` (${entry.groups.length})`}
                  </Button>
                }
              />
              {entry.groups.map((id) => (
                <Badge key={id} tone="neutral" size="sm">
                  {groups.find((g) => g.id === id)?.name ?? "Group"}
                </Badge>
              ))}
              {!entry.readOnly && entry.sources[0]?.kind === "local" && (
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                    <Pencil className="size-4" aria-hidden /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                    <Trash2 className="text-destructive size-4" aria-hidden /> Delete
                  </Button>
                </div>
              )}
            </div>

            <details className="text-xs" data-testid="provenance">
              <summary className="text-muted-foreground cursor-pointer select-none">Provenance</summary>
              <ul className="mt-2 space-y-2">
                {entry.sources.map((s) => (
                  <li key={s.recordId}>
                    <p className="font-medium">
                      {SOURCE_KIND_LABEL[s.kind]} · {s.sourceName}
                    </p>
                    <p className="text-muted-foreground break-all">
                      Identifier in the source:{" "}
                      <span className="font-mono" data-selectable>
                        {s.externalId}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
              {entry.sources.length > 1 && (
                <p className="text-muted-foreground mt-2">
                  These records are matched because they have the same e-mail address — never just the same name.
                </p>
              )}
            </details>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
