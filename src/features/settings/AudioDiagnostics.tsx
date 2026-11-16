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
  hookSwitch: "Décrocher / raccrocher",
  phoneMute: "Couper le micro",
  hold: "Attente",
  drop: "Raccrocher",
  flash: "Flash (non utilisé)",
};

function buttonName(b: HeadsetButton): string {
  return typeof b === "string" ? (BUTTON_LABEL[b] ?? b) : "Autre";
}

function readingText(r: Reading | undefined): string {
  switch (r?.kind) {
    case "listening":
      return "Lecture des commandes du casque active";
    case "permissionNeeded":
      return "macOS demande une autorisation (« Surveillance de l'entrée ») avant de laisser ZePhone lire les boutons";
    case "unavailable":
      return r.message;
    default:
      return "Lecture des commandes du casque inactive (désactivée dans les réglages)";
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
        description="Les tests ne démarrent que si vous les lancez. Ils jouent le son directement sur le périphérique : votre correspondant ne les entend jamais."
        className="max-w-3xl"
      >
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1" data-testid="audio-diagnostics">
          {inCall && (
            <Alert tone="warning">
              Un appel est en cours : les tests sont désactivés pour ne pas le perturber. Le niveau du micro de l'appel
              s'affiche sur l'écran d'appel.
            </Alert>
          )}

          <section aria-label="Périphériques détectés" className="space-y-2">
            <h3 className="text-sm font-semibold">Périphériques détectés</h3>
            <div className="divide-y rounded-xl border text-sm">
              {state.snapshot.devices.map((d) => {
                const uses = usedFor(d.uid);
                return (
                  <div key={d.uid} className="flex flex-wrap items-center gap-2 px-3 py-2" data-testid="diag-device">
                    <span className="font-medium">{d.name}</span>
                    <Badge tone="neutral">{TRANSPORT_LABEL[d.transport]}</Badge>
                    <span className="text-muted-foreground text-xs">
                      {[d.inputChannels > 0 && "entrée", d.outputChannels > 0 && "sortie"].filter(Boolean).join(" + ")}
                    </span>
                    {(d.uid === state.snapshot.defaultInput || d.uid === state.snapshot.defaultOutput) && (
                      <Badge tone="info">Défaut du système</Badge>
                    )}
                    {d.publicSpeaker && <Badge tone="warning">Haut-parleur public</Badge>}
                    {d.inUseElsewhere && <Badge tone="neutral">Utilisé par une application</Badge>}
                    {uses.map((u) => (
                      <Badge key={u} tone="success">
                        Utilisé : {u}
                      </Badge>
                    ))}
                    {!d.selectable && <Badge tone="danger">Nom non pris en charge</Badge>}
                    {d.duplicateName && <Badge tone="warning">Nom en double</Badge>}
                  </div>
                );
              })}
              {state.snapshot.devices.length === 0 && (
                <p className="text-muted-foreground px-3 py-2">Aucun périphérique audio.</p>
              )}
            </div>
          </section>

          <section aria-label="Ce que ZePhone utilise" className="space-y-2">
            <h3 className="text-sm font-semibold">Ce que ZePhone utilise</h3>
            <ul className="space-y-1.5 text-sm">
              {state.roles.map((r) => (
                <li key={r.role} className="flex flex-wrap items-center gap-2">
                  <span className="w-44 shrink-0 font-medium">{ROLE_LABEL[r.role]}</span>
                  <span>{(r.inUse ?? r.resolution.used)?.name ?? "aucun"}</span>
                  <Badge
                    tone={
                      r.resolution.source === "chosen" || r.resolution.source === "following" ? "neutral" : "warning"
                    }
                  >
                    {SOURCE_LABEL[r.resolution.source]}
                  </Badge>
                  {r.refused && <span className="text-destructive text-xs">Refusé par le moteur : {r.refused}</span>}
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

          <section aria-label="Permission du microphone" className="space-y-2">
            <h3 className="text-sm font-semibold">Permission du microphone</h3>
            <p className="flex flex-wrap items-center gap-2 text-sm" data-testid="diag-mic-permission">
              <Mic className="size-4" aria-hidden />
              {mic === "authorized" && "Accès au microphone autorisé"}
              {mic === "notDetermined" && "Pas encore demandée : ZePhone la demandera au premier appel"}
              {mic === "denied" && "Refusée : ZePhone n'entendra rien, et vous non plus vous ne le saurez qu'en appel"}
              {mic === "restricted" && "Restreinte par le système (profil de gestion)"}
              {mic === null && "Vérification…"}
              {(mic === "denied" || mic === "restricted") && (
                <Button size="sm" variant="secondary" onClick={() => void telephony.openMicrophoneSettings()}>
                  Ouvrir les réglages
                </Button>
              )}
            </p>
          </section>

          <section aria-label="Tests" className="space-y-2">
            <h3 className="text-sm font-semibold">Tests</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="secondary" disabled={inCall || busy !== null} onClick={() => void run("speaker")}>
                {busy === "speaker" ? "Lecture…" : "Tester la sortie"}
              </Button>
              <Button variant="secondary" disabled={inCall || busy !== null} onClick={() => void run("ringtone")}>
                {busy === "ringtone" ? "Lecture…" : "Tester la sonnerie"}
              </Button>
              <Button
                variant={metering ? "primary" : "secondary"}
                disabled={inCall}
                onClick={() => void meter(!metering)}
                aria-pressed={metering}
              >
                {metering ? "Arrêter le niveau du micro" : "Voir le niveau du micro"}
              </Button>
            </div>
            {metering && (
              <div
                role="meter"
                aria-label="Niveau du microphone"
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
              Le test de sortie joue une courte tonalité sur « {state.roles[1]?.resolution.used?.name ?? "—"} », celui
              de la sonnerie la vraie sonnerie sur « {state.roles[2]?.resolution.used?.name ?? "—"} ». Aucun
              enregistrement n'est fait.
            </p>
          </section>

          <section aria-label="Boutons du casque" className="space-y-2">
            <h3 className="text-sm font-semibold">Boutons du casque</h3>
            <p className="text-sm" data-testid="diag-headset-reading">
              {readingText(headset?.reading)}
            </p>
            {headset?.reading.kind === "permissionNeeded" && (
              <Alert tone="warning">
                Réglages Système › Confidentialité et sécurité › Surveillance de l'entrée : autorisez ZePhone, puis
                relancez-le. Sans cela, l'audio du casque fonctionne, mais pas ses boutons.
              </Alert>
            )}
            {headset && headset.devices.length === 0 && headset.reading.kind === "listening" && (
              <p className="text-muted-foreground text-sm">
                Aucun casque n'expose de commandes téléphonie standard. Un casque peut servir pour l'audio sans que ses
                boutons soient lisibles par ZePhone (Bluetooth, boutons réservés au constructeur).
              </p>
            )}
            {headset?.devices.map((d) => (
              <div key={d.id} className="rounded-xl border px-3 py-2 text-sm" data-testid="diag-headset-device">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{d.product}</span>
                  {d.manufacturer && <span className="text-muted-foreground text-xs">{d.manufacturer}</span>}
                  <Badge tone="neutral">{d.transport || "HID"}</Badge>
                  <Badge tone={d.inUse ? "success" : "neutral"}>
                    {d.inUse ? "Casque utilisé" : "Pas celui de ZePhone"}
                  </Badge>
                </div>
                <p className="text-muted-foreground mt-1 text-xs">
                  Boutons déclarés :{" "}
                  {d.buttons.length ? d.buttons.map(buttonName).join(", ") : "aucun bouton téléphonie standard"}.{" "}
                  {headset.settings.mode === "auto" || headset.settings.mode === "system"
                    ? "Commandes activées."
                    : "Commandes désactivées."}
                </p>
              </div>
            ))}
            {headset && headset.log.length > 0 && (
              <div className="divide-y rounded-xl border text-xs" aria-label="Derniers événements du casque">
                {[...headset.log].reverse().map((e, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                    <span className="text-muted-foreground tabular-nums">
                      {new Date(e.at).toLocaleTimeString("fr-FR")}
                    </span>
                    <span>{e.button}</span>
                    <Badge tone={e.acted ? "success" : "neutral"}>{e.acted ? "Action" : "Ignoré"}</Badge>
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
