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
import { Button as ArcButton } from "@/components/arc/button/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/arc/tabs/tabs";
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
  { value: "all", label: "All" },
  { value: "incoming", label: "Entrants" },
  { value: "outgoing", label: "Outgoing" },
  { value: "missed", label: "Missed" },
  { value: "failed", label: "Failed" },
];

export function EntryIcon({ entry }: { entry: HistoryEntry }) {
  if (entry.result === "missed") return <PhoneMissed className="text-destructive size-4" aria-label="Missed" />;
  if (entry.result === "failed" || entry.result === "rejected" || entry.result === "cancelled")
    return <CircleX className="text-muted-foreground size-4" aria-label={RESULT_LABEL[entry.result]} />;
  return entry.direction === "incoming" ? (
    <PhoneIncoming className="text-success size-4" aria-label="Incoming" />
  ) : (
    <PhoneForwarded className="text-primary size-4" aria-label="Outgoing" />
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
        title="History"
        description="Your incoming, outgoing, missed and failed calls"
        actions={
          entries.length > 0 && (
            <ArcButton variant="secondary" onClick={() => setConfirmClear(true)}>
              <Trash2 className="size-4" aria-hidden /> Tout effacer
            </ArcButton>
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
            placeholder="Search for a number or a name…"
            aria-label="Search the history"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-(--dock-clearance)">
        {loaded && entries.length === 0 ? (
          <EmptyState icon={History} title="No call" description="Your call history will appear here." />
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
                      aria-label={`Call back ${name}`}
                      onClick={() => void callBack(e)}
                    >
                      <Phone className="size-4" />
                    </Button>
                    {!e.contactName && (
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Add to contacts"
                        onClick={() => setAddContactFor(e.remoteNumber)}
                      >
                        <UserPlus className="size-4" />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label="Delete this entry"
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
        title="Clear the whole history?"
        description="All the entries of the call history will be permanently deleted."
        confirmLabel="Clear all"
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
