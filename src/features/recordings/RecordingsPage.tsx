import { convertFileSrc } from "@tauri-apps/api/core";
import { useState } from "react";

import { AudioLines, PhoneForwarded, PhoneIncoming, Trash2 } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContactAvatar } from "@/components/ContactAvatar";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { VoiceNote } from "@/components/detent/components/voicenote/VoiceNote";
import { formatBytes, formatDateTime, formatDurationHuman } from "@/lib/format";
import { useRecordingsStore } from "@/stores/recordings-store";
import type { Recording } from "@/types/telephony";

/** A transcript is not part of a call recording: the player gets none. */
const NO_WORDS: never[] = [];

function RecordingItem({ rec, onDelete }: { rec: Recording; onDelete: () => void }) {
  const name = rec.remoteName ?? rec.remoteNumber;
  const Direction = rec.direction === "incoming" ? PhoneIncoming : PhoneForwarded;
  return (
    <li className="bg-card/40 rounded-2xl border p-3" data-testid="recording">
      <div className="mb-3 flex items-center gap-3">
        <ContactAvatar name={name} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" data-selectable>
            {name}
          </p>
          <p className="text-muted-foreground flex min-w-0 items-center gap-1.5 text-sm">
            <Direction
              className="size-3.5 shrink-0"
              aria-label={rec.direction === "incoming" ? "Entrant" : "Sortant"}
            />
            <span className="truncate">
              {formatDateTime(rec.startedAt)} · {formatDurationHuman(rec.durationSecs)} · {formatBytes(rec.sizeBytes)}
              {rec.accountLabel && ` · ${rec.accountLabel}`}
            </span>
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label={`Supprimer l'enregistrement de ${name}`} onClick={onDelete}>
          <Trash2 className="text-destructive size-4" />
        </Button>
      </div>
      <VoiceNote
        words={NO_WORDS}
        duration={Math.max(1, rec.durationSecs)}
        src={convertFileSrc(rec.path)}
        peaks={rec.peaks.map((p) => p / 255)}
        defaultTranscript={false}
      />
    </li>
  );
}

/** The calls recorded on this Mac, newest first, each with a player. */
export function RecordingsPage() {
  const recordings = useRecordingsStore((s) => s.recordings);
  const loaded = useRecordingsStore((s) => s.loaded);
  const remove = useRecordingsStore((s) => s.remove);
  const [toDelete, setToDelete] = useState<Recording | null>(null);
  const total = recordings.reduce((sum, r) => sum + r.sizeBytes, 0);

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Enregistrements"
        description={
          recordings.length > 0
            ? `${recordings.length} appel${recordings.length > 1 ? "s" : ""} · ${formatBytes(total)} sur ce Mac`
            : "Les appels que vous enregistrez, gardés sur ce Mac"
        }
      />
      <div className="min-h-0 flex-1 overflow-auto px-6 pb-28">
        {loaded && recordings.length === 0 ? (
          <EmptyState
            icon={AudioLines}
            title="Aucun enregistrement"
            description="Pendant un appel, le bouton d'enregistrement de la fenêtre d'appel garde la conversation ici. Vous pouvez aussi tout enregistrer dans Paramètres → Audio."
          />
        ) : (
          <ul className="space-y-3">
            {recordings.map((r) => (
              <RecordingItem key={r.id} rec={r} onDelete={() => setToDelete(r)} />
            ))}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="Supprimer cet enregistrement ?"
        description={`L'enregistrement de ${toDelete?.remoteName ?? toDelete?.remoteNumber ?? ""} sera effacé de ce Mac. Cette action est irréversible.`}
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (toDelete) void remove(toDelete.id);
          setToDelete(null);
        }}
      />
    </div>
  );
}
