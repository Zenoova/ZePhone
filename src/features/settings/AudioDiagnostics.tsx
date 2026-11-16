import { useEffect, useState } from "react";

import { Mic, TriangleAlert } from "@/components/icons";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { ROLE_LABEL, SOURCE_LABEL, TRANSPORT_LABEL, noticeDetail, noticeTitle, problemText } from "@/lib/audio";
import { telephony } from "@/services/telephony";
import { useAudioStore } from "@/stores/audio-store";
import { useSettingsStore } from "@/stores/settings-store";
import type { HeadsetButton, Reading } from "@/types/audio";

import { Alert } from "./alert";

const BUTTON_LABEL: Record<string, string> = {
  hookSwitch: "Answer / hang up",
  phoneMute: "Mute the microphone",
  hold: "Hold",
  drop: "Hang up",
  flash: "Flash (not used)",
};

function buttonName(b: HeadsetButton): string {
  return typeof b === "string" ? (BUTTON_LABEL[b] ?? b) : "Other";
}

function readingText(r: Reading | undefined): string {
  switch (r?.kind) {
    case "listening":
      return "Reading of the headset commands is active";
    case "permissionNeeded":
      return "macOS asks for a permission (“Input Monitoring”) before letting ZePhone read the buttons";
    case "unavailable":
      return r.message;
    default:
      return "Reading of the headset commands is inactive (disabled in the settings)";
  }
}

/** Where the level bar sits: −60 dBFS (nearly silence) to 0. */
const levelPct = (db: number | null) => (db === null ? 0 : Math.max(0, Math.min(100, ((db + 60) / 60) * 100)));

export function AudioDiagnostics({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const state = useAudioStore((s) => s.state);
  const headset = useAudioStore((s) => s.headset);
  const level = useAudioStore((s) => s.level);
  const metering = useAudioStore((s) => s.metering);
  const { load, test, meter } = useAudioStore.getState();
  const mic = useSettingsStore((s) => s.micPermission);
  const [busy, setBusy] = useState<"speaker" | "ringtone" | null>(null);

  useEffect(() => {
    if (open) void load();
    // Leaving the dialog never leaves the microphone open.
    return () => void useAudioStore.getState().meter(false);
  }, [open, load]);

  if (!state) return null;
  const inCall = state.inCall;
  const usedFor = (uid: string) =>
    state.roles.filter((r) => (r.inUse ?? r.resolution.used)?.uid === uid).map((r) => ROLE_LABEL[r.role]);
  const notices = state.roles.filter((r) => r.notice);

  const run = async (kind: "speaker" | "ringtone") => {
    setBusy(kind);
    await test(kind);
    setBusy(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title="Diagnostic audio"
        description="Tests only start when you launch them. They play the sound directly on the device: your correspondent never hears them."
        className="max-w-3xl"
      >
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1" data-testid="audio-diagnostics">
          {inCall && (
            <Alert tone="warning">
              A call is in progress: the tests are disabled so as not to disturb it. The call's microphone level is
              shown on the call screen.
            </Alert>
          )}

          <section aria-label="Detected devices" className="space-y-2">
            <h3 className="text-sm font-semibold">Detected devices</h3>
            <div className="divide-y rounded-xl border text-sm">
              {state.snapshot.devices.map((d) => {
                const uses = usedFor(d.uid);
                return (
                  <div key={d.uid} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="diag-device">
                    <span className="font-medium">{d.name}</span>
                    <Badge tone="neutral">{TRANSPORT_LABEL[d.transport]}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {[d.inputChannels > 0 && "input", d.outputChannels > 0 && "sortie"].filter(Boolean).join(" + ")}
                    </span>
                    {(d.uid === state.snapshot.defaultInput || d.uid === state.snapshot.defaultOutput) && (
                      <Badge tone="info">System default</Badge>
                    )}
                    {d.publicSpeaker && <Badge tone="warning">Public speaker</Badge>}
                    {d.inUseElsewhere && <Badge tone="neutral">Used by an application</Badge>}
                    {uses.map((u) => (
                      <Badge key={u} tone="success">
                        In use: {u}
                      </Badge>
                    ))}
                    {!d.selectable && <Badge tone="danger">Name not supported</Badge>}
                    {d.duplicateName && <Badge tone="warning">Duplicate name</Badge>}
                  </div>
                );
              })}
              {state.snapshot.devices.length === 0 && (
                <p className="text-muted-foreground px-3 py-2">No audio device.</p>
              )}
            </div>
          </section>

          <section aria-label="What ZePhone uses" className="space-y-2">
            <h3 className="text-sm font-semibold">What ZePhone uses</h3>
            <ul className="space-y-1.5 text-sm">
              {state.roles.map((r) => (
                <li key={r.role} className="flex flex-wrap items-center gap-2">
                  <span className="w-44 shrink-0 font-medium">{ROLE_LABEL[r.role]}</span>
                  <span>{(r.inUse ?? r.resolution.used)?.name ?? "none"}</span>
                  <Badge
                    tone={
                      r.resolution.source === "chosen" || r.resolution.source === "following" ? "neutral" : "warning"
                    }
                  >
                    {SOURCE_LABEL[r.resolution.source]}
                  </Badge>
                  {r.refused && <span className="text-destructive text-xs">Refused by the engine: {r.refused}</span>}
                </li>
              ))}
            </ul>
            {state.roles
              .flatMap((r) => r.resolution.problems.map((p) => ({ r, p })))
              .map(({ r, p }, i) => (
                <p key={i} className="text-muted-foreground flex items-start gap-2 text-xs">
                  <TriangleAlert className="text-warning mt-0.5 size-3.5 shrink-0" aria-hidden />
                  <span>
                    <strong>{ROLE_LABEL[r.role]}</strong> — {problemText(p)}
                  </span>
                </p>
              ))}
            {notices.map((r) => (
              <Alert key={r.role} tone="warning">
                <strong>{noticeTitle(r.notice!)}.</strong> {noticeDetail(r.notice!)}
              </Alert>
            ))}
          </section>

          <section aria-label="Microphone permission" className="space-y-2">
            <h3 className="text-sm font-semibold">Microphone permission</h3>
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="diag-mic-permission">
              <Mic className="size-4" aria-hidden />
              {mic === "authorized" && "Microphone access allowed"}
              {mic === "notDetermined" && "Not requested yet: ZePhone will ask at the first call"}
              {mic === "denied" && "Denied: ZePhone will hear nothing, and you will only notice it during a call"}
              {mic === "restricted" && "Restricted by the system (management profile)"}
              {mic === null && "Checking…"}
              {(mic === "denied" || mic === "restricted") && (
                <Button size="sm" variant="secondary" onClick={() => void telephony.openMicrophoneSettings()}>
                  Open settings
                </Button>
              )}
            </p>
          </section>

          <section aria-label="Tests" className="space-y-2">
            <h3 className="text-sm font-semibold">Tests</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={inCall || busy !== null} onClick={() => void run("speaker")}>
                {busy === "speaker" ? "Playing…" : "Test the output"}
              </Button>
              <Button variant="secondary" disabled={inCall || busy !== null} onClick={() => void run("ringtone")}>
                {busy === "ringtone" ? "Playing…" : "Test the ringtone"}
              </Button>
              <Button
                variant={metering ? "primary" : "secondary"}
                disabled={inCall}
                onClick={() => void meter(!metering)}
                aria-pressed={metering}
              >
                {metering ? "Stop the microphone level" : "See the microphone level"}
              </Button>
            </div>
            {metering && (
              <div
                role="meter"
                aria-label="Microphone level"
                aria-valuemin={-60}
                aria-valuemax={0}
                aria-valuenow={level ?? -60}
                className="bg-muted h-3 w-full max-w-md overflow-hidden rounded-full"
              >
                <div
                  className="bg-success h-full transition-[width] duration-75"
                  style={{ width: `${levelPct(level)}%` }}
                />
              </div>
            )}
            <p className="text-muted-foreground text-xs">
              The output test plays a short tone on “{state.roles[1]?.resolution.used?.name ?? "—"}”, the ringtone test
              the real ringtone on “{state.roles[2]?.resolution.used?.name ?? "—"}”. No recording is made.
            </p>
          </section>

          <section aria-label="Headset buttons" className="space-y-2">
            <h3 className="text-sm font-semibold">Headset buttons</h3>
            <p className="text-sm" data-testid="diag-headset-reading">
              {readingText(headset?.reading)}
            </p>
            {headset?.reading.kind === "permissionNeeded" && (
              <Alert tone="warning">
                System Settings › Privacy & Security › Input Monitoring: allow ZePhone, then relaunch it. Without it,
                the headset audio works, but not its buttons.
              </Alert>
            )}
            {headset && headset.devices.length === 0 && headset.reading.kind === "listening" && (
              <p className="text-muted-foreground text-sm">
                No headset exposes standard telephony commands. A headset can be used for audio without its buttons
                readable by ZePhone (Bluetooth, buttons reserved for the manufacturer).
              </p>
            )}
            {headset?.devices.map((d) => (
              <div key={d.id} className="rounded-xl border px-3 py-2 text-sm" data-testid="diag-headset-device">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.product}</span>
                  {d.manufacturer && <span className="text-muted-foreground text-xs">{d.manufacturer}</span>}
                  <Badge tone="neutral">{d.transport || "HID"}</Badge>
                  <Badge tone={d.inUse ? "success" : "neutral"}>
                    {d.inUse ? "Headset in use" : "Not the one ZePhone uses"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Declared buttons:{" "}
                  {d.buttons.length ? d.buttons.map(buttonName).join(", ") : "no standard telephony button"}.{" "}
                  {headset.settings.mode === "auto" || headset.settings.mode === "system"
                    ? "Commands enabled."
                    : "Commands disabled."}
                </p>
              </div>
            ))}
            {headset && headset.log.length > 0 && (
              <div className="divide-y rounded-xl border text-xs" aria-label="Latest headset events">
                {[...headset.log].reverse().map((e, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-muted-foreground tabular-nums">
                      {new Date(e.at).toLocaleTimeString("en-US")}
                    </span>
                    <span>{e.button}</span>
                    <Badge tone={e.acted ? "success" : "neutral"}>{e.acted ? "Action" : "Ignored"}</Badge>
                    <span className="text-muted-foreground">{e.result}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
