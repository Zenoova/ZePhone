import { toast } from "@yusufceng1z/ding-react";
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
  active: { label: "Active", tone: "success" },
  disabled: { label: "Disabled", tone: "neutral" },
  unassigned: { label: "Unassigned", tone: "neutral" },
  suspended: { label: "Paused", tone: "info" },
  failed: { label: "Not activated", tone: "danger" },
};

const inApp = (mac: boolean): ReadonlyArray<{ keys: string; what: string }> => [
  { keys: mac ? "⌘1 to ⌘4" : "Ctrl+1 to Ctrl+4", what: "Switch page (Keypad, Contacts, History, Settings)" },
  { keys: "/", what: "Search the directory (Contacts page)" },
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
  const mac = view?.mac ?? navigator.userAgent.includes("Mac");
  /** The backend refused a combination (taken by the system, by another application…): say so, with its reason. */
  const refuse = (reason: string | null | undefined) => {
    if (reason) toast.error(reason);
  };

  useEffect(() => {
    void load();
  }, [load]);

  const stop = () => {
    setRecording(null);
    setHint("");
  };

  const start = (action: ShortcutAction) => {
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
      if (r.kind === "unsupported") return setHint("This key cannot be part of a shortcut");
      const enabled = useShortcutsStore.getState().view?.items.find((i) => i.action === action)?.enabled ?? true;
      void (async () => {
        const reason = await set(action, r.accelerator, enabled);
        refuse(reason);
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
    refuse(reason);
  };

  const allDefault = view.items.every((i) => i.isDefault);

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Global shortcuts"
        description="They work in all applications, even when ZePhone is minimized, as long as it is running."
      >
        <SettingRow label="Enable global shortcuts" description="Off, no combination is reserved with the system.">
          <Switch
            checked={view.enabled}
            onCheckedChange={(v) => void setEnabled(v)}
            aria-label="Enable global shortcuts"
          />
        </SettingRow>
        <ul aria-label="Shortcuts" className="divide-y">
          {view.items.map((item) => (
            <ShortcutRow
              key={item.action}
              item={item}
              master={view.enabled}
              recording={recording === item.action}
              hint={hint}
              onRecord={() => start(item.action)}
              onCancel={stop}
              onToggle={(enabled) => void change(item, { enabled })}
              onRemove={() => void change(item, { accelerator: null })}
              onReset={async () => {
                refuse(await reset(item.action));
              }}
            />
          ))}
        </ul>
        <div className="flex items-center justify-between gap-4 px-4 py-3">
          <p className="text-muted-foreground text-xs">
            A combination must include at least {mac ? "⌃, ⌥ or ⌘" : "Ctrl, Alt or Win"}: a bare key would fire while
            you are typing elsewhere.
          </p>
          <Button
            variant="secondary"
            disabled={allDefault && view.enabled}
            onClick={() => {
              void reset().then(refuse);
            }}
          >
            Restore the default settings
          </Button>
        </div>
      </SettingsSection>

      <Alert>
        {mac
          ? "On macOS, these shortcuts do not need any permission: ZePhone is only told when one of these combinations is pressed, it does not read the keyboard. "
          : "These shortcuts do not need any particular permission. "}
        {mac &&
          "macOS does not report that another application uses the same combination: if an active shortcut does not react, change it. "}
        To trigger them from a Stream Deck or another tool, see “External command” in the documentation
        (docs/CONTROL.md).
      </Alert>

      <SettingsSection
        title="In the application only"
        description="These shortcuts only work while the ZePhone window is in the foreground."
      >
        {inApp(mac).map((s) => (
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
  onRecord: () => void;
  onCancel: () => void;
  onToggle: (enabled: boolean) => void;
  onRemove: () => void;
  onReset: () => void;
}) {
  const status = STATUS[item.status.kind];
  const problem = item.status.kind === "failed" ? item.status.message : null;
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
              {hint || "Press the combination…"}
            </span>
            <Button variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <Button
              variant="secondary"
              className="min-w-28 font-mono"
              aria-label={`Edit the shortcut: ${item.label}`}
              onClick={onRecord}
            >
              {item.display ?? "None"}
            </Button>
            {item.accelerator && (
              <Button variant="ghost" size="sm" aria-label={`Delete the shortcut: ${item.label}`} onClick={onRemove}>
                <X className="size-4" />
              </Button>
            )}
            {!item.isDefault && (
              <Button variant="ghost" aria-label={`Restore the default shortcut: ${item.label}`} onClick={onReset}>
                Restore
              </Button>
            )}
            <Switch
              checked={item.enabled}
              disabled={!master || !item.accelerator}
              onCheckedChange={onToggle}
              aria-label={`Enable the shortcut: ${item.label}`}
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
