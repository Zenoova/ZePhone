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
        description="See the detected devices and those actually used, test the output and the ringtone, watch the microphone level, understand an error."
      >
        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <p className="text-muted-foreground text-sm">Nothing starts without your action, and never during a call.</p>
          <Button variant="secondary" onClick={() => setDiagOpen(true)}>
            Open the audio diagnostic
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Volumes"
        description="Incoming sound: what you hear. Outgoing sound: what your correspondent hears from your microphone. The setting applies at once, including during a call."
      >
        <VolumeSliders className="px-4 py-4" />
      </SettingsSection>

      <SettingsSection
        title="Call recording"
        description="Recordings stay on this Mac, in ZePhone's data folder. You will find them in the Recordings tab of the dock."
      >
        <SettingRow
          label="Record calls automatically"
          description="Each call is recorded as soon as it is answered. Turn it off if you do not want that: informing your correspondent may be a legal obligation."
        >
          <Switch
            checked={settings.recording.autoRecord}
            onCheckedChange={(v) => void update({ recording: { autoRecord: v } })}
            aria-label="Record calls automatically"
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Microphone permission">
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
                {mic === "authorized" && "Microphone access allowed"}
                {mic === "notDetermined" && "Permission not requested yet"}
                {mic === "denied" && "Microphone access denied"}
                {mic === "restricted" && "Access restricted by the system"}
                {mic === null && "Checking…"}
              </p>
              {mic === "denied" && (
                <p className="text-muted-foreground text-xs">
                  Allow ZePhone in System Settings › Privacy › Microphone.
                </p>
              )}
            </div>
          </div>
          {mic === "notDetermined" && <Button onClick={() => void requestMic()}>Allow the microphone</Button>}
          {(mic === "denied" || mic === "restricted") && (
            <Button variant="secondary" onClick={() => void telephony.openMicrophoneSettings()}>
              Open settings
            </Button>
          )}
        </div>
      </SettingsSection>

      <SettingsSection title="Audio codecs" description="Negotiated automatically with your correspondent.">
        <div className="space-y-3 px-4 py-3.5">
          <div className="flex flex-wrap gap-2">
            {codecs.length === 0 && <span className="text-muted-foreground text-sm">Engine not started</span>}
            {codecs.map((c) => (
              <Badge key={c} tone="neutral">
                {c}
              </Badge>
            ))}
          </div>
          {codecs.length > 0 && lacking.length > 0 && (
            <Alert>
              {lacking.map((c) => (c === "G722" ? "G.722" : "Opus")).join(" and ")} {lacking.length > 1 ? "are" : "is"}{" "}
              not included in this Baresip build (PCMA/PCMU are always available).
            </Alert>
          )}
        </div>
      </SettingsSection>
      <AudioDiagnostics open={diagOpen} onOpenChange={setDiagOpen} />
    </div>
  );
}
