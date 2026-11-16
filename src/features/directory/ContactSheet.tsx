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
        <DialogContent title={entry.displayName} description={entrySubtitle(entry) || "Fiche contact"}>
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
                      Lecture seule
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

            <section aria-label="Numéros">
              <ul className="divide-y rounded-xl border" data-testid="phone-list">
                {sortedPhones(entry.phones).map((p) => {
                  const kind = p.label ?? PHONE_KIND_LABEL[p.kind];
                  return (
                    <li
                      key={`${p.kind}-${p.number}`}
                      className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                      data-testid="phone-row"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-muted-foreground text-xs">{kind}</p>
                        <p className="font-mono text-sm break-all" data-selectable>
                          {p.number}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          size="sm"
                          variant="primary"
                          aria-label={`Appeler ${kind} ${p.number}`}
                          onClick={() => void actions.call(p.number).then((ok) => ok && onClose())}
                        >
                          <Phone className="size-4" aria-hidden /> Appeler
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label={`Copier ${p.number}`}
                          onClick={() => void actions.copy(p.number)}
                        >
                          <Copy className="size-4" aria-hidden /> Copier
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!actions.activeCall}
                          title={
                            actions.activeCall
                              ? "Transférer l'appel en cours vers ce numéro"
                              : "Aucun appel en cours à transférer"
                          }
                          aria-label={`Transférer l'appel vers ${p.number}`}
                          onClick={() => void actions.transfer(p.number).then((ok) => ok && onClose())}
                        >
                          <PhoneForwarded className="size-4" aria-hidden /> Transférer
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
                {entry.favorite ? "Favori" : "Ajouter aux favoris"}
              </Button>
              <GroupPicker
                entries={[entry]}
                onManage={onManageGroups}
                trigger={
                  <Button size="sm" variant="secondary">
                    Groupes{entry.groups.length > 0 && ` (${entry.groups.length})`}
                  </Button>
                }
              />
              {entry.groups.map((id) => (
                <Badge key={id} tone="neutral" size="sm">
                  {groups.find((g) => g.id === id)?.name ?? "Groupe"}
                </Badge>
              ))}
              {!entry.readOnly && entry.sources[0]?.kind === "local" && (
                <div className="ml-auto flex gap-1.5">
                  <Button size="sm" variant="ghost" onClick={() => onEdit(entry)}>
                    <Pencil className="size-4" aria-hidden /> Modifier
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => onDelete(entry)}>
                    <Trash2 className="text-destructive size-4" aria-hidden /> Supprimer
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
                      Identifiant chez la source :{" "}
                      <span className="font-mono" data-selectable>
                        {s.externalId}
                      </span>
                    </p>
                  </li>
                ))}
              </ul>
              {entry.sources.length > 1 && (
                <p className="text-muted-foreground mt-2">
                  Ces fiches sont rapprochées parce qu'elles ont la même adresse e-mail — jamais seulement le même nom.
                </p>
              )}
            </details>
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
