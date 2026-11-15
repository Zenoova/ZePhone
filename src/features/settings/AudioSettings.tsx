import { TriangleAlert, CircleCheck, Mic, RefreshCw } from "@/components/icons";
import { useEffect } from "react";

import { Alert } from "@/features/settings/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { VolumeSliders } from "@/components/VolumeSliders";
import { telephony } from "@/services/telephony";
import { useEngineStore } from "@/stores/engine-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { AudioDevice } from "@/types/telephony";

import { SettingRow, SettingsSection } from "./parts";

const SYSTEM_DEFAULT = "__system__";
/** A selector must return the same value while nothing changes: a fresh `[]` each time would loop. */
const NO_CODECS: string[] = [];

function DeviceSelect({
  id,
  label,
  value,
  devices,
  onChange,
}: {
  id: string;
  label: string;
  value: string | null;
  devices: AudioDevice[] | undefined;
  onChange: (v: string | null) => void;
}) {
  const known = devices?.some((d) => d.name === value);
  return (
    <Select value={value ?? SYSTEM_DEFAULT} onValueChange={(v) => onChange(v === SYSTEM_DEFAULT ? null : v)}>
      <SelectTrigger id={id} aria-label={label} className="w-72 max-w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={SYSTEM_DEFAULT}>Par défaut du système</SelectItem>
        {value && !known && (
          <SelectItem value={value} disabled>
            {value} (non branché)
          </SelectItem>
        )}
        {devices?.map((d) => (
          <SelectItem key={d.name} value={d.name} disabled={!d.selectable}>
            {d.name}
            {d.isDefault && " · défaut"}
            {!d.selectable && " (nom non pris en charge)"}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AudioSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const devices = useSettingsStore((s) => s.devices);
  const mic = useSettingsStore((s) => s.micPermission);
  const { update, loadDevices, refreshMic, requestMic } = useSettingsStore.getState();
  const codecs = useEngineStore((s) => s.info?.codecs ?? NO_CODECS);

  useEffect(() => {
    void loadDevices();
    void refreshMic();
  }, [loadDevices, refreshMic]);

  const lacking = ["G722", "opus"].filter((c) => !codecs.some((x) => x.toLowerCase() === c.toLowerCase()));

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Périphériques audio"
        description="Microphone et sortie (haut-parleurs, casque USB ou Bluetooth). Le changement s'applique à l'appel suivant."
      >
        <SettingRow label="Microphone" htmlFor="audio-in">
          <DeviceSelect
            id="audio-in"
            label="Microphone"
            value={settings.audio.inputDevice}
            devices={devices?.inputs}
            onChange={(v) => void update({ audio: { inputDevice: v } })}
          />
        </SettingRow>
        <SettingRow label="Sortie audio" htmlFor="audio-out">
          <DeviceSelect
            id="audio-out"
            label="Sortie audio"
            value={settings.audio.outputDevice}
            devices={devices?.outputs}
            onChange={(v) => void update({ audio: { outputDevice: v } })}
          />
        </SettingRow>
        <SettingRow label="Actualiser la liste" description="Après avoir branché un casque ou un micro">
          <Button variant="outline" size="sm" onClick={() => void loadDevices()}>
            <RefreshCw className="size-4" aria-hidden /> Actualiser
          </Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="Volumes"
        description="Son entrant : ce que vous entendez. Son sortant : ce que votre correspondant entend de votre micro. Le réglage s'applique tout de suite, y compris pendant un appel."
      >
        <VolumeSliders className="px-4 py-4" />
      </SettingsSection>

      <SettingsSection
        title="Enregistrement des appels"
        description="Les enregistrements restent sur ce Mac, dans le dossier de données de ZePhone. Vous les retrouvez dans l'onglet Enregistrements."
      >
        <SettingRow
          label="Enregistrer tous les appels"
          description="Dès qu'un appel est décroché. Informez votre correspondant : la loi peut exiger son accord."
        >
          <Switch
            checked={settings.recording.autoRecord}
            onCheckedChange={(v) => void update({ recording: { autoRecord: v } })}
            aria-label="Enregistrer tous les appels"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Autorisation du microphone">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <div className="flex items-center gap-3">
            {mic === "authorized" ? (
              <CircleCheck className="text-success size-5" aria-hidden />
            ) : mic === null ? (
              <Mic className="text-muted-foreground size-5" aria-hidden />
            ) : (
              <TriangleAlert className="text-warning size-5" aria-hidden />
            )}
            <div>
              <p className="text-sm font-medium" data-testid="mic-status">
                {mic === "authorized" && "Accès au microphone autorisé"}
                {mic === "notDetermined" && "Autorisation non encore demandée"}
                {mic === "denied" && "Accès au microphone refusé"}
                {mic === "restricted" && "Accès restreint par le système"}
                {mic === null && "Vérification…"}
              </p>
              {mic === "denied" && (
                <p className="text-muted-foreground text-xs">
                  Autorisez ZePhone dans Réglages Système › Confidentialité › Microphone.
                </p>
              )}
            </div>
          </div>
          {mic === "notDetermined" && <Button onClick={() => void requestMic()}>Autoriser le microphone</Button>}
          {(mic === "denied" || mic === "restricted") && (
            <Button variant="outline" onClick={() => void telephony.openMicrophoneSettings()}>
              Ouvrir les réglages
            </Button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Codecs audio" description="Négociés automatiquement avec votre correspondant.">
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap gap-2">
            {codecs.length === 0 && <span className="text-muted-foreground text-sm">Moteur non démarré</span>}
            {codecs.map((c) => (
              <Badge key={c} tone="neutral">
                {c}
              </Badge>
            ))}
          </div>
          {codecs.length > 0 && lacking.length > 0 && (
            <Alert>
              {lacking.map((c) => (c === "G722" ? "G.722" : "Opus")).join(" et ")}{" "}
              {lacking.length > 1 ? "ne sont" : "n'est"} pas inclus dans cette build de Baresip (PCMA/PCMU sont toujours
              disponibles).
            </Alert>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
