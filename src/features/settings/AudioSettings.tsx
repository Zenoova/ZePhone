import { TriangleAlert, CircleCheck, Mic } from "@/components/icons";
import { useEffect, useState } from "react";

import { Alert } from "@/features/settings/alert";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Switch } from "@/components/ui/switch";
import { VolumeSliders } from "@/components/VolumeSliders";
import { telephony } from "@/services/telephony";
import { useEngineStore } from "@/stores/engine-store";
import { useSettingsStore } from "@/stores/settings-store";

import { AudioDevices } from "./AudioDevices";
import { AudioDiagnostics } from "./AudioDiagnostics";
import { HeadsetButtons } from "./HeadsetButtons";
import { SettingRow, SettingsSection } from "./parts";

/** A selector must return the same value while nothing changes: a fresh `[]` each time would loop. */
const NO_CODECS: string[] = [];

export function AudioSettings() {
  const settings = useSettingsStore((s) => s.settings);
  const [diagOpen, setDiagOpen] = useState(false);
  const mic = useSettingsStore((s) => s.micPermission);
  const { update, refreshMic, requestMic } = useSettingsStore.getState();
  const codecs = useEngineStore((s) => s.info?.codecs ?? NO_CODECS);

  useEffect(() => {
    void refreshMic();
  }, [refreshMic]);

  const lacking = ["G722", "opus"].filter((c) => !codecs.some((x) => x.toLowerCase() === c.toLowerCase()));

  return (
    <div className="space-y-6">
      <AudioDevices />

      <HeadsetButtons />

      <SettingsSection
        title="Diagnostic"
        description="Voir les périphériques détectés et ceux réellement utilisés, tester la sortie et la sonnerie, regarder le niveau du micro, comprendre une erreur."
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <p className="text-muted-foreground text-sm">
            Rien ne démarre sans votre action, et jamais pendant un appel.
          </p>
          <Button variant="secondary" onClick={() => setDiagOpen(true)}>
            Ouvrir le diagnostic audio
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Volumes"
        description="Son entrant : ce que vous entendez. Son sortant : ce que votre correspondant entend de votre micro. Le réglage s'applique tout de suite, y compris pendant un appel."
      >
        <VolumeSliders className="px-4 py-4" />
      </SettingsSection>

      <SettingsSection
        title="Enregistrement des appels"
        description="Les enregistrements restent sur ce Mac, dans le dossier de données de ZePhone. Vous les retrouvez dans l'onglet Enregistrements du dock."
      >
        <SettingRow
          label="Enregistrer automatiquement les appels"
          description="Chaque appel est enregistré dès qu'il est décroché. Désactivez-le si vous ne le souhaitez pas : informer votre correspondant peut être une obligation légale."
        >
          <Switch
            checked={settings.recording.autoRecord}
            onCheckedChange={(v) => void update({ recording: { autoRecord: v } })}
            aria-label="Enregistrer automatiquement les appels"
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
            <Button variant="secondary" onClick={() => void telephony.openMicrophoneSettings()}>
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
      <AudioDiagnostics open={diagOpen} onOpenChange={setDiagOpen} />
    </div>
  );
}
