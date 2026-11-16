import { useEffect, useState } from "react";

import { X } from "@/components/icons";
import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Switch } from "@/components/arc/switch/switch";
import { heldModifiers, recordKey, showModifiers } from "@/lib/accelerator";
import { useShortcutsStore } from "@/stores/shortcuts-store";
import type { BindingStatus, ShortcutAction, ShortcutItem } from "@/types/shortcuts";

import { Alert } from "./alert";
import { SettingRow, SettingsSection } from "./parts";

const STATUS: Record<BindingStatus["kind"], { label: string; tone: BadgeTone }> = {
  active: { label: "Actif", tone: "success" },
  disabled: { label: "Désactivé", tone: "neutral" },
  unassigned: { label: "Non attribué", tone: "neutral" },
  suspended: { label: "En pause", tone: "info" },
  failed: { label: "Non activé", tone: "danger" },
};

const IN_APP: ReadonlyArray<{ keys: string; what: string }> = [
  { keys: "⌘1 à ⌘4", what: "Changer de page (Clavier, Contacts, Historique, Paramètres)" },
  { keys: "/", what: "Chercher dans l'annuaire (page Contacts)" },
];

export function ShortcutsSettings() {
  const view = useShortcutsStore((s) => s.view);
  const load = useShortcutsStore((s) => s.load);
  const set = useShortcutsStore((s) => s.set);
  const setEnabled = useShortcutsStore((s) => s.setEnabled);
  const reset = useShortcutsStore((s) => s.reset);
  const capture = useShortcutsStore((s) => s.capture);
  const [recording, setRecording] = useState<ShortcutAction | null>(null);
  /** The modifiers held, or a remark, while a combination is being recorded. */
  const [hint, setHint] = useState("");
  /** What the backend answered when it refused a combination, per action. */
  const [refused, setRefused] = useState<Partial<Record<ShortcutAction, string>>>({});
  const mac = view?.mac ?? navigator.userAgent.includes("Mac");

  useEffect(() => {
    void load();
  }, [load]);

  const stop = () => {
    setRecording(null);
    setHint("");
  };

  const start = (action: ShortcutAction) => {
    setRefused((r) => ({ ...r, [action]: undefined }));
    setHint("");
    setRecording(action);
  };

  // Recording: the page reads the keys, nothing else does.
  useEffect(() => {
    if (!recording) return;
    const action = recording;
    // Nothing is registered while recording: pressing an existing combination must not run its action. Whatever
    // ends the recording (a key, Escape, the window losing focus, leaving the page) gives the shortcuts back.
    void capture(true);
    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat) return;
      const r = recordKey(e, mac);
      if (r.kind === "pending") return setHint(showModifiers(r.modifiers, mac));
      if (r.kind === "cancel") return stop();
      if (r.kind === "unsupported") return setHint("Cette touche ne peut pas faire partie d'un raccourci");
      const enabled = useShortcutsStore.getState().view?.items.find((i) => i.action === action)?.enabled ?? true;
      void (async () => {
        const reason = await set(action, r.accelerator, enabled);
        setRefused((p) => ({ ...p, [action]: reason ?? undefined }));
        stop();
      })();
    };
    const onKeyUp = (e: KeyboardEvent) => {
      e.preventDefault();
      setHint(showModifiers(heldModifiers(e, mac), mac));
    };
    // Leaving the window must not leave the shortcuts paused.
    const onBlur = () => stop();
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
      void capture(false);
    };
  }, [recording, mac, set, capture]);

  if (!view) return null;

  const change = async (item: ShortcutItem, patch: { accelerator?: string | null; enabled?: boolean }) => {
    const reason = await set(
      item.action,
      patch.accelerator === undefined ? item.accelerator : patch.accelerator,
      patch.enabled ?? item.enabled,
    );
    setRefused((p) => ({ ...p, [item.action]: reason ?? undefined }));
  };

  const allDefault = view.items.every((i) => i.isDefault);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Raccourcis globaux"
        description="Ils fonctionnent dans toutes les applications, même quand ZePhone est réduit, tant qu'il est lancé."
      >
        <SettingRow
          label="Activer les raccourcis globaux"
          description="Désactivé, aucune combinaison n'est réservée au système."
        >
          <Switch
            checked={view.enabled}
            onCheckedChange={(v) => void setEnabled(v)}
            aria-label="Activer les raccourcis globaux"
          />
        </SettingRow>
        <ul aria-label="Raccourcis" className="divide-y">
          {view.items.map((item) => (
            <ShortcutRow
              key={item.action}
              item={item}
              master={view.enabled}
              recording={recording === item.action}
              hint={hint}
              refused={refused[item.action]}
              onRecord={() => start(item.action)}
              onCancel={stop}
              onToggle={(enabled) => void change(item, { enabled })}
              onRemove={() => void change(item, { accelerator: null })}
              onReset={async () => {
                const reason = await reset(item.action);
                setRefused((p) => ({ ...p, [item.action]: reason ?? undefined }));
              }}
            />
          ))}
        </ul>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-muted-foreground text-xs">
            Une combinaison doit comporter au moins {mac ? "⌃, ⌥ ou ⌘" : "Ctrl, Alt ou Win"} : une touche seule se
            déclencherait pendant que vous écrivez ailleurs.
          </p>
          <Button
            variant="secondary"
            disabled={allDefault && view.enabled}
            onClick={() => {
              setRefused({});
              void reset();
            }}
          >
            Rétablir les réglages par défaut
          </Button>
        </div>
      </SettingsSection>

      <Alert>
        {mac
          ? "Sur macOS, ces raccourcis ne demandent aucune autorisation : ZePhone est seulement prévenu quand l'une de ces combinaisons est pressée, il ne lit pas le clavier. "
          : "Ces raccourcis ne demandent aucune autorisation particulière. "}
        {mac &&
          "macOS ne signale pas qu'une autre application utilise la même combinaison : si un raccourci actif ne réagit pas, changez-le. "}
        Pour les déclencher depuis un Stream Deck ou un autre outil, voir « Commande externe » dans la documentation
        (docs/CONTROL.md).
      </Alert>

      <SettingsSection
        title="Dans l'application seulement"
        description="Ces raccourcis ne marchent que lorsque la fenêtre de ZePhone est au premier plan."
      >
        {IN_APP.map((s) => (
          <SettingRow key={s.keys} label={s.what}>
            <kbd className="bg-muted rounded-md border px-2 py-1 font-mono text-xs">{s.keys}</kbd>
          </SettingRow>
        ))}
      </SettingsSection>
    </div>
  );
}

function ShortcutRow({
  item,
  master,
  recording,
  hint,
  refused,
  onRecord,
  onCancel,
  onToggle,
  onRemove,
  onReset,
}: {
  item: ShortcutItem;
  master: boolean;
  recording: boolean;
  hint: string;
  refused?: string;
  onRecord: () => void;
  onCancel: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  const status = STATUS[item.status.kind];
  const problem = item.status.kind === "failed" ? item.status.message : refused;
  return (
    <li className="px-4 py-3" data-testid={`shortcut-${item.action}`}>
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{item.label}</span>
            <Badge tone={status.tone} dot>
              {status.label}
            </Badge>
            <span className="text-muted-foreground text-xs">Global</span>
          </div>
        </div>
        {recording ? (
          <div className="flex items-center gap-2">
            <span
              role="status"
              aria-live="polite"
              className="border-primary bg-primary/10 text-primary min-w-40 rounded-lg border px-3 py-1.5 text-center text-sm"
            >
              {hint || "Appuyez sur la combinaison…"}
            </span>
            <Button variant="ghost" onClick={onCancel}>
              Annuler
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              className="min-w-28 font-mono"
              aria-label={`Modifier le raccourci : ${item.label}`}
              onClick={onRecord}
            >
              {item.display ?? "Aucun"}
            </Button>
            {item.accelerator && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Supprimer le raccourci : ${item.label}`}
                onClick={onRemove}
              >
                <X className="size-4" />
              </Button>
            )}
            {!item.isDefault && (
              <Button variant="ghost" aria-label={`Rétablir le raccourci par défaut : ${item.label}`} onClick={onReset}>
                Rétablir
              </Button>
            )}
            <Switch
              checked={item.enabled}
              disabled={!master || !item.accelerator}
              onCheckedChange={onToggle}
              aria-label={`Activer le raccourci : ${item.label}`}
            />
          </div>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-destructive mt-1.5 text-xs">
          {problem}
        </p>
      )}
    </li>
  );
}
