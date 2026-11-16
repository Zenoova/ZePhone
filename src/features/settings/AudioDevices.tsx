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
  ask: { label: "Me demander", help: "L'appel reste ouvert et ZePhone vous propose de choisir un autre périphérique." },
  useFallback: {
    label: "Utiliser le périphérique de secours",
    help: "Si vous en avez configuré un pour la fonction ; sinon, ZePhone vous demande.",
  },
  useSystemDefault: {
    label: "Suivre le périphérique par défaut du système",
    help: "Le son passe sur ce que le système utilise alors.",
  },
};

function deviceLabel(d: DeviceInfo, snap: { defaultInput: string | null; defaultOutput: string | null }): string {
  const isDefault = d.uid === snap.defaultInput || d.uid === snap.defaultOutput;
  return `${d.name} · ${TRANSPORT_LABEL[d.transport]}${isDefault ? " · défaut du système" : ""}`;
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
          <SelectItem value={FOLLOW_DEFAULT}>Suivre le choix du système</SelectItem>
          {rs.role === "ringer" && (
            <SelectItem value={FOLLOW_ALERTS}>Suivre la sortie des alertes du système</SelectItem>
          )}
          {saved && !savedPresent && (
            <SelectItem value={selectionValue(choice.selection)} disabled>
              {saved.name} (non branché)
            </SelectItem>
          )}
          {rs.choices.map((d) => (
            <SelectItem key={d.uid} value={`dev:${d.uid}`} disabled={!d.selectable}>
              {deviceLabel(d, snap)}
              {!d.selectable && " (nom non pris en charge)"}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {saved && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Périphérique de secours</span>
          <Select
            value={choice.fallback?.uid ?? NO_FALLBACK}
            onValueChange={(v) => save(rs.role, fallbackWith(choice, v, devices))}
          >
            <SelectTrigger aria-label={`Périphérique de secours : ${ROLE_LABEL[rs.role]}`} className="w-72 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FALLBACK}>Aucun</SelectItem>
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
          <span className="text-muted-foreground">Utilisé : </span>
          <span className="font-medium">{used ? used.name : "aucun périphérique"}</span>
        </span>
        <Badge tone={rs.resolution.source === "chosen" || rs.resolution.source === "following" ? "neutral" : "warning"}>
          {SOURCE_LABEL[rs.resolution.source]}
        </Badge>
        {used && <Badge tone="neutral">{TRANSPORT_LABEL[used.transport]}</Badge>}
        {used?.inUseElsewhere && <Badge tone="info">Utilisé aussi par une application</Badge>}
      </p>

      {pending && (
        <Alert tone="warning">
          Ce choix devrait utiliser « {rs.resolution.used?.name} », mais le moteur audio utilise encore «{" "}
          {rs.inUse?.name} »{rs.refused ? ` : ${rs.refused}` : " (changement en attente)"}.
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
        title="Périphériques audio"
        description="Trois choix séparés. « Suivre le système » reprend ce que macOS utilise, et change avec lui. Un choix explicite revient tout seul quand le même périphérique est rebranché."
      >
        {state.roles.map((rs) => (
          <SettingRow key={rs.role} label={ROLE_LABEL[rs.role]} stacked>
            <RoleControls rs={rs} routing={routing} devices={devicesFor(rs.role)} />
          </SettingRow>
        ))}
        {!state.supportsCommunicationDefault && (
          <div className="text-muted-foreground flex items-start gap-2 px-4 py-3 text-xs">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            macOS n'a pas de périphérique « communication » séparé du périphérique par défaut : ZePhone suit donc le
            périphérique par défaut (et, pour la sonnerie, la sortie des alertes).
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Si un périphérique disparaît pendant un appel"
        description="La session SIP reste ouverte et l'appel n'est jamais coupé. Les débranchements très brefs (quelques secondes) sont ignorés."
      >
        <SettingRow label="Que faire" htmlFor="lost-policy" stacked>
          <div className="space-y-1.5">
            <Select
              value={routing.lostPolicy}
              onValueChange={(v) => void update({ audio: { routing: { ...routing, lostPolicy: v as LostPolicy } } })}
            >
              <SelectTrigger id="lost-policy" aria-label="Si un périphérique disparaît" className="w-80 max-w-full">
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
          label="Autoriser le passage automatique sur des haut-parleurs"
          description="Haut-parleurs de l'ordinateur ou d'un écran : toute la pièce entend l'appel. Désactivé, la conversation ne passe jamais toute seule sur des haut-parleurs publics."
        >
          <Switch
            checked={routing.allowPublicSpeaker}
            onCheckedChange={(v) => void update({ audio: { routing: { ...routing, allowPublicSpeaker: v } } })}
            aria-label="Autoriser le passage automatique sur des haut-parleurs"
          />
        </SettingRow>
      </SettingsSection>
    </>
  );
}
