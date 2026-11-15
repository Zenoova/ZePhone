import {
  History,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneForwarded,
  Search,
  Trash2,
  UserPlus,
  CircleX,
} from "@/components/icons";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContactAvatar } from "@/components/ContactAvatar";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { formatDateTime, formatDurationHuman } from "@/lib/format";
import { RESULT_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import { useCallsStore } from "@/stores/calls-store";
import { useHistoryStore } from "@/stores/history-store";
import { useUiStore } from "@/stores/ui-store";
import type { HistoryEntry, HistoryKind } from "@/types/telephony";

import { ContactFormDialog } from "../contacts/ContactForm";

const TABS: ReadonlyArray<{ value: HistoryKind; label: string }> = [
  { value: "all", label: "Tous" },
  { value: "incoming", label: "Entrants" },
  { value: "outgoing", label: "Sortants" },
  { value: "missed", label: "Manqués" },
  { value: "failed", label: "Échoués" },
];

export function EntryIcon({ entry }: { entry: HistoryEntry }) {
  if (entry.result === "missed") return <PhoneMissed className="text-destructive size-4" aria-label="Manqué" />;
  if (entry.result === "failed" || entry.result === "rejected" || entry.result === "cancelled")
    return <CircleX className="text-muted-foreground size-4" aria-label={RESULT_LABEL[entry.result]} />;
  return entry.direction === "incoming" ? (
    <PhoneIncoming className="text-success size-4" aria-label="Entrant" />
  ) : (
    <PhoneForwarded className="text-primary size-4" aria-label="Sortant" />
  );
}

export function HistoryPage() {
  const { entries, loaded, query, kind } = useHistoryStore();
  const setQuery = useHistoryStore((s) => s.setQuery);
  const setKind = useHistoryStore((s) => s.setKind);
  const load = useHistoryStore((s) => s.load);
  const remove = useHistoryStore((s) => s.remove);
  const clear = useHistoryStore((s) => s.clear);
  const markSeen = useHistoryStore((s) => s.markSeen);
  const dial = useCallsStore((s) => s.dial);
  const setSection = useUiStore((s) => s.setSection);
  const debounced = useDebouncedValue(query, 150);
  const [confirmClear, setConfirmClear] = useState(false);
  const [addContactFor, setAddContactFor] = useState<string | null>(null);

  useEffect(() => {
    void load();
  }, [debounced, kind, load]);

  useEffect(() => {
    markSeen();
  }, [markSeen, entries.length]);

  const callBack = async (e: HistoryEntry) => {
    const started = await dial(e.remoteUri.startsWith("sip") ? e.remoteUri : e.remoteNumber, e.accountId);
    if (started) setSection("dialer");
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Historique"
        description="Vos appels entrants, sortants, manqués et échoués"
        actions={
          entries.length > 0 && (
            <Button variant="outline" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-4" aria-hidden /> Tout effacer
            </Button>
          )
        }
      />
      <div className="flex flex-col gap-3 px-6 pb-3">
        <Tabs value={kind} onValueChange={(v) => setKind(v as HistoryKind)}>
          <TabsList className="h-auto flex-wrap">
            {TABS.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un numéro ou un nom…"
            aria-label="Rechercher dans l'historique"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-28">
        {loaded && entries.length === 0 ? (
          <EmptyState icon={History} title="Aucun appel" description="L'historique de vos appels apparaîtra ici." />
        ) : (
          <ul className="space-y-1">
            {entries.map((e) => {
              const name = e.contactName ?? e.remoteNumber;
              return (
                <li key={e.id} className="hover:bg-accent/60 group flex items-center gap-3 rounded-xl px-3 py-2.5">
                  <ContactAvatar name={name} />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn("truncate font-medium", e.result === "missed" && "text-destructive")}
                      data-selectable
                    >
                      {name}
                    </p>
                    <div className="text-muted-foreground flex min-w-0 items-center gap-1.5 truncate text-sm">
                      <EntryIcon entry={e} />
                      <span className="truncate">
                        {RESULT_LABEL[e.result]}
                        {e.durationSecs > 0 && ` · ${formatDurationHuman(e.durationSecs)}`}
                        {e.contactName && ` · ${e.remoteNumber}`}
                        {e.accountLabel && ` · ${e.accountLabel}`}
                      </span>
                    </div>
                    {e.result === "failed" && e.reason && (
                      <p className="text-muted-foreground truncate text-xs">{e.reason}</p>
                    )}
                  </div>
                  <time className="text-muted-foreground shrink-0 text-xs" dateTime={e.startedAt}>
                    {formatDateTime(e.startedAt)}
                  </time>
                  <div className="flex items-center gap-0.5">
                    <Button
                      size="icon"
                      className="bg-success text-success-foreground hover:bg-success/90 rounded-full"
                      aria-label={`Rappeler ${name}`}
                      onClick={() => void callBack(e)}
                    >
                      <Phone className="size-4" />
                    </Button>
                    {!e.contactName && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Ajouter aux contacts"
                        onClick={() => setAddContactFor(e.remoteNumber)}
                      >
                        <UserPlus className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Supprimer cette entrée"
                      onClick={() => void remove(e.id)}
                    >
                      <Trash2 className="text-destructive size-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={confirmClear}
        onOpenChange={setConfirmClear}
        title="Effacer tout l'historique ?"
        description="Toutes les entrées de l'historique des appels seront définitivement supprimées."
        confirmLabel="Tout effacer"
        onConfirm={() => {
          void clear();
          setConfirmClear(false);
        }}
      />
      <ContactFormDialog
        open={addContactFor !== null}
        onOpenChange={(o) => !o && setAddContactFor(null)}
        contact={null}
        prefillNumber={addContactFor ?? ""}
      />
    </div>
  );
}
