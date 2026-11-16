import { toast } from "@yusufceng1z/ding-react";
import { useEffect, useState } from "react";

import {
  Building2,
  Cloud,
  LogOut,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  UserRound,
  Users,
} from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import DropdownMenu from "@/components/arc/dropdown-menu/dropdown-menu";
import { Switch } from "@/components/arc/switch/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERVAL_OPTIONS, SOURCE_KIND_LABEL, failureAction, intervalLabel, sourceStatus } from "@/lib/directory";
import { errorMessage, telephony } from "@/services/telephony";
import { useDirectoryStore } from "@/stores/directory-store";
import { useUiStore } from "@/stores/ui-store";
import type { SourceKind, SourceState, SourceView, SystemContactsInfo } from "@/types/directory";

import { Alert } from "./alert";
import { LdapSourceDialog } from "./LdapSourceDialog";
import { MicrosoftSourceDialog } from "./MicrosoftSourceDialog";
import { SettingsSection } from "./parts";

const STATE_TONE: Record<SourceState, BadgeTone> = {
  idle: "success",
  syncing: "info",
  error: "danger",
  needsReauth: "warning",
  disabled: "neutral",
};

const STATE_LABEL: Record<SourceState, string> = {
  idle: "Connected",
  syncing: "Syncing…",
  error: "Error",
  needsReauth: "Reconnect",
  disabled: "Disconnected",
};

const KIND_ICON: Record<SourceKind, typeof Server> = {
  local: Users,
  ldap: Server,
  microsoftOrg: Building2,
  microsoftPersonal: Cloud,
  systemContacts: UserRound,
};

type Editor =
  | { type: "ldap"; source: SourceView | null }
  | { type: "microsoft"; kind: "microsoftOrg" | "microsoftPersonal"; source: SourceView | null };

type Confirm = { kind: "disconnect" | "clear" | "remove"; source: SourceView };

const CONFIRM_TEXT: Record<Confirm["kind"], (name: string) => { title: string; description: string; label: string }> = {
  disconnect: (n) => ({
    title: "Disconnect this source?",
    description: `“${n}” is disconnected: the saved password or authorization and the cached contacts are cleared. Your favorites and groups are kept for a future connection.`,
    label: "Disconnect",
  }),
  clear: (n) => ({
    title: "Clear this source's cache?",
    description: `The cached contacts of “${n}” are cleared; the source stays connected and will be read again at the next sync. Your favorites and groups are kept.`,
    label: "Clear the cache",
  }),
  remove: (n) => ({
    title: "Delete this source?",
    description: `“${n}” is deleted, with its password or authorization, its cached contacts, and the favorites and groups that only concerned its contacts.`,
    label: "Delete the source",
  }),
};

function SourceCard({
  source,
  onEdit,
  onConfirm,
  onAuthorize,
}: {
  source: SourceView;
  onEdit: (s: SourceView) => void;
  onConfirm: (c: Confirm) => void;
  /** Asks again for the permission to read the device's address book. */
  onAuthorize: () => void;
}) {
  const Icon = KIND_ICON[source.kind];
  const failure = failureAction(source);
  const local = source.kind === "local";
  const microsoft = source.kind === "microsoftOrg" || source.kind === "microsoftPersonal";
  // The device's address book has no settings and no password: what it can lack is the user's permission.
  const device = source.kind === "systemContacts";

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const problem = source.state === "error" || source.state === "needsReauth";

  return (
    <li className="bg-card/40 rounded-2xl border p-4" data-testid="source-card" data-state={source.state}>
      <div className="flex items-start gap-3">
        <div className="bg-muted text-muted-foreground flex size-10 shrink-0 items-center justify-center rounded-xl">
          <Icon className="size-5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{source.name}</h3>
            <Badge tone={STATE_TONE[source.state]} size="sm">
              {local ? "Always available" : STATE_LABEL[source.state]}
            </Badge>
            {!local && (
              <Badge tone="neutral" size="sm">
                Read-only
              </Badge>
            )}
          </div>
          <p className="text-muted-foreground mt-1 text-sm">
            {SOURCE_KIND_LABEL[source.kind]} · {source.contactCount} contact{source.contactCount > 1 ? "s" : ""}
          </p>
          <p className="text-muted-foreground mt-0.5 text-xs" data-testid="source-status">
            {sourceStatus(source)}
            {!local &&
              source.syncIntervalMin > 0 &&
              source.enabled &&
              ` · ${intervalLabel(source.syncIntervalMin).toLowerCase()}`}
          </p>
        </div>
        {!local && (
          <Switch
            checked={source.enabled}
            onCheckedChange={(v) =>
              void run(() => telephony.directorySetSource(source.id, source.name, v, source.syncIntervalMin))
            }
            aria-label={source.enabled ? `Disable ${source.name}` : `Enable ${source.name}`}
          />
        )}
      </div>

      {problem && source.lastError && (
        <Alert tone={source.state === "needsReauth" ? "warning" : "error"} className="mt-3 items-center">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="source-error">
            <span data-selectable>{source.lastError}</span>
            {failure.action !== "none" && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  if (failure.action === "retry") void run(() => telephony.directorySync(source.id));
                  else if (device) onAuthorize();
                  else onEdit(source);
                }}
              >
                {failure.label}
              </Button>
            )}
            {device && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void run(() => telephony.directoryOpenContactsPrivacySettings())}
              >
                Open settings
              </Button>
            )}
          </div>
        </Alert>
      )}
      {source.stale && !problem && (
        <Alert tone="warning" className="mt-3">
          The cache of this source could not be updated for a long time: it will be cleared after 30 days without
          syncing.
        </Alert>
      )}

      {!local && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {source.enabled && (
            <Button
              size="sm"
              variant="secondary"
              disabled={source.state === "syncing"}
              onClick={() => void run(() => telephony.directorySync(source.id))}
            >
              <RefreshCw className="size-4" aria-hidden /> Sync
            </Button>
          )}
          {!device && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(source)}>
              <Pencil className="size-4" aria-hidden /> Edit
            </Button>
          )}
          {microsoft && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(source)}>
              Reconnect
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onConfirm({ kind: "disconnect", source })}>
            <LogOut className="size-4" aria-hidden /> Disconnect
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onConfirm({ kind: "clear", source })}>
            Clear the cache
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onConfirm({ kind: "remove", source })}>
            <Trash2 className="text-destructive size-4" aria-hidden /> Delete
          </Button>
          <div className="basis-full sm:basis-auto">
            <Select
              value={String(source.syncIntervalMin)}
              onValueChange={(v) =>
                void run(() =>
                  telephony.directorySetSource(source.id, source.name, source.enabled, Number.parseInt(v, 10)),
                )
              }
            >
              <SelectTrigger aria-label={`Sync frequency of ${source.name}`} className="h-8 w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </li>
  );
}

/** Settings → Directory: where the company's contacts come from. */
export function DirectorySettings() {
  const sources = useDirectoryStore((s) => s.sources);
  const loaded = useDirectoryStore((s) => s.sourcesLoaded);
  const loadSources = useDirectoryStore((s) => s.loadSources);
  const setSection = useUiStore((s) => s.setSection);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [device, setDevice] = useState<SystemContactsInfo | null>(null);
  /** The system's question about the address book is on screen, waiting for the user. */
  const [asking, setAsking] = useState(false);
  /** Why connecting the address book failed (most often: the user said no). */

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  useEffect(() => {
    let cancelled = false;
    telephony
      .directorySystemContactsInfo()
      .then((info) => !cancelled && setDevice(info))
      .catch(() => !cancelled && setDevice(null));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Asks the user's permission (the system's own question), then reads the address book. Nothing is created if
   * the answer is no. */
  const connectDevice = async () => {
    setAsking(true);
    try {
      await telephony.directoryConnectSystemContacts();
      toast.success("Contacts connected: reading in progress");
    } catch (e) {
      toast.error(errorMessage(e), {
        action: {
          label: "Open settings",
          onClick: () =>
            void telephony.directoryOpenContactsPrivacySettings().catch((e2) => toast.error(errorMessage(e2))),
        },
      });
    } finally {
      setAsking(false);
      telephony
        .directorySystemContactsInfo()
        .then(setDevice)
        .catch(() => {});
    }
  };

  const edit = (s: SourceView) => {
    setEditor(
      s.kind === "ldap"
        ? { type: "ldap", source: s }
        : { type: "microsoft", kind: s.kind as "microsoftOrg" | "microsoftPersonal", source: s },
    );
  };

  const doConfirm = async () => {
    if (!confirm) return;
    const { kind, source } = confirm;
    setConfirm(null);
    try {
      if (kind === "disconnect") await telephony.directoryDisconnect(source.id);
      else if (kind === "clear") await telephony.directoryClearCache(source.id);
      else await telephony.directoryRemoveSource(source.id);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const text = confirm ? CONFIRM_TEXT[confirm.kind](confirm.source.name) : null;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Company directory"
        description="Find your colleagues and customers in the directory, with all their numbers, without retyping anything."
      >
        <div className="space-y-3 p-4">
          <ul className="space-y-3" aria-label="Contact sources">
            {!loaded && <li className="text-muted-foreground text-sm">Loading…</li>}
            {sources.map((s) => (
              <SourceCard
                key={s.id}
                source={s}
                onEdit={edit}
                onConfirm={setConfirm}
                onAuthorize={() => void connectDevice()}
              />
            ))}
          </ul>
          {loaded && sources.length <= 1 && (
            <EmptyState
              icon={Building2}
              title="No company directory connected"
              description="Connect an LDAP or Microsoft 365 directory: its contacts are added to your local contacts, read-only."
            />
          )}
          {asking && (
            <Alert tone="info">
              <span data-testid="contacts-asking">
                Waiting for your answer to the system question… Answer in the window that opened.
              </span>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu
              label="Add a source"
              icon={<Plus className="size-4" aria-hidden />}
              items={[
                {
                  label: "LDAP or Active Directory directory",
                  icon: <Server className="size-4" />,
                  onSelect: () => setEditor({ type: "ldap", source: null }),
                },
                {
                  label: "Microsoft 365: organization directory",
                  icon: <Building2 className="size-4" />,
                  onSelect: () => setEditor({ type: "microsoft", kind: "microsoftOrg", source: null }),
                  separatorBefore: true,
                },
                {
                  label: "Outlook: my personal contacts",
                  icon: <Cloud className="size-4" />,
                  onSelect: () => setEditor({ type: "microsoft", kind: "microsoftPersonal", source: null }),
                },
                // The device's own address book: only where there is one to read, and only once.
                ...(device?.available && !sources.some((s) => s.kind === "systemContacts")
                  ? [
                      {
                        label: `${device.name} (read-only)`,
                        icon: <UserRound className="size-4" />,
                        onSelect: () => void connectDevice(),
                        separatorBefore: true,
                      },
                    ]
                  : []),
              ]}
            />
            <Button variant="ghost" onClick={() => setSection("contacts")}>
              View the directory
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="How it works">
        <div className="text-muted-foreground space-y-2 p-4 text-sm">
          <p>
            Company records are <strong>read-only</strong>: they are edited in the original directory. Your favorites
            and your groups stay yours, separate from the synced data.
          </p>
          <p>
            Contacts are kept in memory on this computer so that the search stays instant and works even if the server
            is unreachable. An outage never erases the directory; a source's cache is cleared when it is disconnected,
            or after 30 days without a successful sync.
          </p>
          <p>
            Device contacts stay on this computer: ZePhone reads them after your permission, never modifies them, and
            you can withdraw the permission at any time in the system settings.
          </p>
          <p>Presence (available, online) is not shown: ZePhone does not receive it from these sources.</p>
        </div>
      </SettingsSection>

      {editor?.type === "ldap" && (
        <LdapSourceDialog open onOpenChange={(o) => !o && setEditor(null)} source={editor.source} />
      )}
      {editor?.type === "microsoft" && (
        <MicrosoftSourceDialog
          open
          onOpenChange={(o) => !o && setEditor(null)}
          kind={editor.kind}
          source={editor.source}
        />
      )}
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={text?.title ?? ""}
        description={text?.description ?? ""}
        confirmLabel={text?.label}
        onConfirm={() => void doConfirm()}
      />
    </div>
  );
}
