import { CircleCheck, Info, TriangleAlert } from "@/components/icons";
import { useEffect } from "react";

import { Badge } from "@/components/arc/badge/badge";
import { Switch } from "@/components/arc/switch/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  FOLLOW_ALERTS,
  FOLLOW_DEFAULT,
  NO_FALLBACK,
  ROLE_LABEL,
  SOURCE_LABEL,
  TRANSPORT_LABEL,
  bluetoothNote,
  choiceWith,
  fallbackWith,
  problemText,
  selectionValue,
} from "@/lib/audio";
import { useAudioStore } from "@/stores/audio-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { DeviceInfo, LostPolicy, RoleState, Role, Routing } from "@/types/audio";

import { Alert } from "./alert";
import { SettingRow, SettingsSection } from "./parts";

const POLICIES: Record<LostPolicy, { label: string; help: string }> = {
  ask: { label: "Ask me", help: "The call stays open and ZePhone offers to choose another device." },
  useFallback: {
    label: "Use the backup device",
    help: "If you configured one for the function; otherwise ZePhone asks you.",
  },
  useSystemDefault: {
    label: "Follow the system's default device",
    help: "The sound goes to whatever the system uses at that moment.",
  },
};

function deviceLabel(d: DeviceInfo, snap: { defaultInput: string | null; defaultOutput: string | null }): string {
  const isDefault = d.uid === snap.defaultInput || d.uid === snap.defaultOutput;
  return `${d.name} · ${TRANSPORT_LABEL[d.transport]}${isDefault ? " · system default" : ""}`;
}

function RoleControls({ rs, routing, devices }: { rs: RoleState; routing: Routing; devices: DeviceInfo[] }) {
  const update = useSettingsStore((s) => s.update);
  const choice = rs.choice;
  const saved = choice.selection.kind === "explicit" ? choice.selection.device : null;
  const savedPresent = saved
    ? rs.choices.some((d) => d.uid === saved.uid || (!saved.uid && d.name === saved.name))
    : true;
  const snap = useAudioStore.getState().state?.snapshot ?? { defaultInput: null, defaultOutput: null };
  const save = (role: Role, next: typeof choice) => void update({ audio: { routing: { ...routing, [role]: next } } });

  const used = rs.inUse ?? rs.resolution.used;
  const pending = rs.resolution.used && rs.inUse && rs.resolution.used.uid !== rs.inUse.uid;
  const note = bluetoothNote(used);

  return (
    <div className="space-y-2.5">
      <Select
        value={selectionValue(choice.selection)}
        onValueChange={(v) => save(rs.role, choiceWith(choice, v, devices))}
      >
        <SelectTrigger aria-label={ROLE_LABEL[rs.role]} className="w-80 max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW_DEFAULT}>Follow the system's choice</SelectItem>
          {rs.role === "ringer" && <SelectItem value={FOLLOW_ALERTS}>Follow the system's alert output</SelectItem>}
          {saved && !savedPresent && (
            <SelectItem value={selectionValue(choice.selection)} disabled>
              {saved.name} (not plugged in)
            </SelectItem>
          )}
          {rs.choices.map((d) => (
            <SelectItem key={d.uid} value={`dev:${d.uid}`} disabled={!d.selectable}>
              {deviceLabel(d, snap)}
              {!d.selectable && " (name not supported)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {saved && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Backup device</span>
          <Select
            value={choice.fallback?.uid ?? NO_FALLBACK}
            onValueChange={(v) => save(rs.role, fallbackWith(choice, v, devices))}
          >
            <SelectTrigger aria-label={`Backup device: ${ROLE_LABEL[rs.role]}`} className="w-72 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FALLBACK}>None</SelectItem>
              {rs.choices
                .filter((d) => d.uid !== saved.uid)
                .map((d) => (
                  <SelectItem key={d.uid} value={d.uid}>
                    {deviceLabel(d, snap)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <p className="flex flex-wrap items-center gap-2 text-sm" data-testid={`in-use-${rs.role}`}>
        {used ? (
          <CircleCheck className="text-success size-4" aria-hidden />
        ) : (
          <TriangleAlert className="text-warning size-4" aria-hidden />
        )}
        <span>
          <span className="text-muted-foreground">In use: </span>
          <span className="font-medium">{used ? used.name : "no device"}</span>
        </span>
        <Badge tone={rs.resolution.source === "chosen" || rs.resolution.source === "following" ? "neutral" : "warning"}>
          {SOURCE_LABEL[rs.resolution.source]}
        </Badge>
        {used && <Badge tone="neutral">{TRANSPORT_LABEL[used.transport]}</Badge>}
        {used?.inUseElsewhere && <Badge tone="info">Also used by an application</Badge>}
      </p>

      {pending && (
        <Alert tone="warning">
          This choice should use “{rs.resolution.used?.name}”, but the audio engine is still using “{rs.inUse?.name}”
          {rs.refused ? `: ${rs.refused}` : " (change pending)"}.
        </Alert>
      )}
      {rs.resolution.problems
        .filter((p) => p.kind !== "noDevice" || !used)
        .map((p, i) => (
          <Alert key={i} tone={p.kind === "chosenUnavailable" ? "warning" : "info"}>
            {problemText(p)}
          </Alert>
        ))}
      {note && <Alert>{note}</Alert>}
    </div>
  );
}

export function AudioDevices() {
  const state = useAudioStore((s) => s.state);
  const load = useAudioStore((s) => s.load);
  const update = useSettingsStore((s) => s.update);

  useEffect(() => {
    void load();
  }, [load]);

  if (!state) return null;
  const { routing } = state;
  const devicesFor = (role: Role) => state.roles.find((r) => r.role === role)?.choices ?? [];

  return (
    <>
      <SettingsSection
        title="Audio devices"
        description="Three separate choices. “Follow the system” takes whatever macOS uses, and changes with it. An explicit choice comes back by itself when the same device is plugged in again."
      >
        {state.roles.map((rs) => (
          <SettingRow key={rs.role} label={ROLE_LABEL[rs.role]} stacked>
            <RoleControls rs={rs} routing={routing} devices={devicesFor(rs.role)} />
          </SettingRow>
        ))}
        {!state.supportsCommunicationDefault && (
          <div className="text-muted-foreground flex items-start gap-2 px-4 py-3 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            macOS has no “communication” device separate from the default device: ZePhone therefore follows the default
            device (and, for the ringtone, the alert output).
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="If a device disappears during a call"
        description="The SIP session stays open and the call is never cut. Very brief unplugs (a few seconds) are ignored."
      >
        <SettingRow label="What to do" htmlFor="lost-policy" stacked>
          <div className="space-y-1.5">
            <Select
              value={routing.lostPolicy}
              onValueChange={(v) => void update({ audio: { routing: { ...routing, lostPolicy: v as LostPolicy } } })}
            >
              <SelectTrigger id="lost-policy" aria-label="If a device disappears" className="w-80 max-w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(POLICIES) as LostPolicy[]).map((p) => (
                  <SelectItem key={p} value={p}>
                    {POLICIES[p].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-xs">{POLICIES[routing.lostPolicy].help}</p>
          </div>
        </SettingRow>
        <SettingRow
          label="Allow automatic switching to loudspeakers"
          description="Speakers of the computer or of a screen: the whole room hears the call. Off, the conversation never moves to public speakers by itself."
        >
          <Switch
            checked={routing.allowPublicSpeaker}
            onCheckedChange={(v) => void update({ audio: { routing: { ...routing, allowPublicSpeaker: v } } })}
            aria-label="Allow automatic switching to loudspeakers"
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
