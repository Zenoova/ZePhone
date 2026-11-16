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
  idle: "Connectée",
  syncing: "Synchronisation…",
  error: "Erreur",
  needsReauth: "À reconnecter",
  disabled: "Déconnectée",
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
    title: "Déconnecter cette source ?",
    description: `« ${n} » est déconnectée : le mot de passe ou l'autorisation enregistré et les contacts gardés en mémoire sont effacés. Vos favoris et vos groupes sont conservés pour une prochaine connexion.`,
    label: "Déconnecter",
  }),
  clear: (n) => ({
    title: "Effacer la mémoire de cette source ?",
    description: `Les contacts de « ${n} » gardés en mémoire sont effacés ; la source reste connectée et sera relue à la prochaine synchronisation. Vos favoris et vos groupes sont conservés.`,
    label: "Effacer la mémoire",
  }),
  remove: (n) => ({
    title: "Supprimer cette source ?",
    description: `« ${n} » est supprimée, avec son mot de passe ou son autorisation, ses contacts en mémoire, et les favoris et groupes qui ne concernaient que ses contacts.`,
    label: "Supprimer la source",
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
              {local ? "Toujours disponible" : STATE_LABEL[source.state]}
            </Badge>
            {!local && (
              <Badge tone="neutral" size="sm">
                Lecture seule
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
            aria-label={source.enabled ? `Désactiver ${source.name}` : `Activer ${source.name}`}
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
                Ouvrir les réglages
              </Button>
            )}
          </div>
        </Alert>
      )}
      {source.stale && !problem && (
        <Alert tone="warning" className="mt-3">
          La mémoire de cette source n'a pas pu être mise à jour depuis longtemps : elle sera effacée après 30 jours
          sans synchronisation.
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
              <RefreshCw className="size-4" aria-hidden /> Synchroniser
            </Button>
          )}
          {!device && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(source)}>
              <Pencil className="size-4" aria-hidden /> Modifier
            </Button>
          )}
          {microsoft && (
            <Button size="sm" variant="ghost" onClick={() => onEdit(source)}>
              Reconnecter
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => onConfirm({ kind: "disconnect", source })}>
            <LogOut className="size-4" aria-hidden /> Se déconnecter
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onConfirm({ kind: "clear", source })}>
            Effacer la mémoire
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => onConfirm({ kind: "remove", source })}>
            <Trash2 className="text-destructive size-4" aria-hidden /> Supprimer
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
              <SelectTrigger aria-label={`Fréquence de synchronisation de ${source.name}`} className="h-8 w-60">
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

/** Settings → Annuaire: where the company's contacts come from. */
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
  const [deviceError, setDeviceError] = useState<string | null>(null);

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
    setDeviceError(null);
    setAsking(true);
    try {
      await telephony.directoryConnectSystemContacts();
      toast.success("Contacts connectés : lecture en cours");
    } catch (e) {
      setDeviceError(errorMessage(e));
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
        title="Annuaire d'entreprise"
        description="Retrouvez vos collègues et vos clients dans l'annuaire, avec tous leurs numéros, sans rien recopier."
      >
        <div className="space-y-3 p-4">
          <ul className="space-y-3" aria-label="Sources de contacts">
            {!loaded && <li className="text-muted-foreground text-sm">Chargement…</li>}
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
              title="Aucun annuaire d'entreprise connecté"
              description="Connectez un annuaire LDAP ou Microsoft 365 : ses contacts s'ajoutent à vos contacts locaux, en lecture seule."
            />
          )}
          {asking && (
            <Alert tone="info">
              <span data-testid="contacts-asking">
                En attente de votre réponse à la question du système… Répondez dans la fenêtre qui s'est ouverte.
              </span>
            </Alert>
          )}
          {deviceError && (
            <Alert tone="error" className="items-center">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="contacts-error">
                <span>{deviceError}</span>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    void telephony.directoryOpenContactsPrivacySettings().catch((e) => toast.error(errorMessage(e)))
                  }
                >
                  Ouvrir les réglages
                </Button>
              </div>
            </Alert>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <DropdownMenu
              label="Ajouter une source"
              icon={<Plus className="size-4" aria-hidden />}
              items={[
                {
                  label: "Annuaire LDAP ou Active Directory",
                  icon: <Server className="size-4" />,
                  onSelect: () => setEditor({ type: "ldap", source: null }),
                },
                {
                  label: "Microsoft 365 : annuaire de l'organisation",
                  icon: <Building2 className="size-4" />,
                  onSelect: () => setEditor({ type: "microsoft", kind: "microsoftOrg", source: null }),
                  separatorBefore: true,
                },
                {
                  label: "Outlook : mes contacts personnels",
                  icon: <Cloud className="size-4" />,
                  onSelect: () => setEditor({ type: "microsoft", kind: "microsoftPersonal", source: null }),
                },
                // The device's own address book: only where there is one to read, and only once.
                ...(device?.available && !sources.some((s) => s.kind === "systemContacts")
                  ? [
                      {
                        label: `${device.name} (lecture seule)`,
                        icon: <UserRound className="size-4" />,
                        onSelect: () => void connectDevice(),
                        separatorBefore: true,
                      },
                    ]
                  : []),
              ]}
            />
            <Button variant="ghost" onClick={() => setSection("contacts")}>
              Voir l'annuaire
            </Button>
          </div>
        </div>
      </SettingsSection>

      <SettingsSection title="Comment ça marche">
        <div className="text-muted-foreground space-y-2 p-4 text-sm">
          <p>
            Les fiches de l'entreprise sont en <strong>lecture seule</strong> : elles se modifient dans l'annuaire
            d'origine. Vos favoris et vos groupes restent à vous, séparés des données synchronisées.
          </p>
          <p>
            Les contacts sont gardés en mémoire sur cet ordinateur pour que la recherche reste instantanée et fonctionne
            même si le serveur est injoignable. Une panne n'efface jamais l'annuaire ; la mémoire d'une source est
            effacée à sa déconnexion, ou après 30 jours sans synchronisation réussie.
          </p>
          <p>
            Les contacts de l'appareil restent sur cet ordinateur : ZePhone les lit après votre autorisation, ne les
            modifie jamais, et vous pouvez retirer l'autorisation à tout moment dans les réglages du système.
          </p>
          <p>La présence (disponible, en ligne) n'est pas affichée : ZePhone ne la reçoit pas de ces sources.</p>
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
