import { Info } from "@/components/icons";

import { Switch } from "@/components/arc/switch/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSettingsStore } from "@/stores/settings-store";
import type { HeadsetMode, HeadsetSettings } from "@/types/audio";

import { Alert } from "./alert";
import { SettingRow, SettingsSection } from "./parts";

const MODES: Record<HeadsetMode, { label: string; help: string; disabled?: boolean }> = {
  auto: {
    label: "Automatique",
    help: "Le meilleur mécanisme que ce système offre : les commandes standard (HID téléphonie).",
  },
  system: {
    label: "Commandes standard du système",
    help: "Les rapports HID de la page téléphonie, sans autre intégration.",
  },
  vendor: {
    label: "Intégration du constructeur (non disponible)",
    help: "Aucune intégration constructeur n'est incluse : ce choix ne traite aucun bouton.",
    disabled: true,
  },
  off: { label: "Désactivées", help: "Les boutons du casque ne font rien dans ZePhone. L'audio n'est pas touché." },
};

export function HeadsetButtons() {
  const headset = useSettingsStore((s) => s.settings.audio.headset);
  const update = useSettingsStore((s) => s.update);
  const set = (patch: Partial<HeadsetSettings>) => void update({ audio: { headset: { ...headset, ...patch } } });
  const off = headset.mode === "off" || headset.mode === "vendor";

  return (
    <SettingsSection
      title="Boutons du casque"
      description="Décrocher, raccrocher et couper le micro depuis le casque. Un casque peut très bien servir pour l'audio sans que ses boutons soient pris en charge : le diagnostic le dit casque par casque."
    >
      <SettingRow label="Gestion des boutons" htmlFor="headset-mode" stacked>
        <div className="space-y-1.5">
          <Select value={headset.mode} onValueChange={(v) => set({ mode: v as HeadsetMode })}>
            <SelectTrigger id="headset-mode" aria-label="Gestion des boutons du casque" className="w-80 max-w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(MODES) as HeadsetMode[]).map((m) => (
                <SelectItem key={m} value={m} disabled={MODES[m].disabled && headset.mode !== m}>
                  {MODES[m].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-muted-foreground text-xs">{MODES[headset.mode].help}</p>
        </div>
      </SettingRow>
      <SettingRow
        label="Le bouton d'appel décroche"
        description="Un appel qui sonne seulement. Il ne refuse jamais un appel et ne compose jamais."
      >
        <Switch
          checked={headset.answer}
          disabled={off}
          onCheckedChange={(v) => set({ answer: v })}
          aria-label="Décrocher avec le casque"
        />
      </SettingRow>
      <SettingRow
        label="Raccrocher avec le casque"
        description="Le bouton d'appel (ou de fin) termine l'appel en cours. Poser le casque sur son socle ne fait rien si le casque ne l'annonce pas comme un raccrochage standard."
      >
        <Switch
          checked={headset.hangUp}
          disabled={off}
          onCheckedChange={(v) => set({ hangUp: v })}
          aria-label="Raccrocher avec le casque"
        />
      </SettingRow>
      <SettingRow label="Couper le micro avec le casque" description="Appui court. Un appui long est ignoré.">
        <Switch
          checked={headset.mute}
          disabled={off}
          onCheckedChange={(v) => set({ mute: v })}
          aria-label="Couper le micro avec le casque"
        />
      </SettingRow>
      <SettingRow label="Mettre en attente avec le casque" description="Seulement si le casque a un bouton d'attente.">
        <Switch
          checked={headset.hold}
          disabled={off}
          onCheckedChange={(v) => set({ hold: v })}
          aria-label="Attente avec le casque"
        />
      </SettingRow>
      <SettingRow
        label="Seulement le casque utilisé par ZePhone"
        description="Ignore les boutons d'un autre casque, ou d'un casque qu'une autre application (Teams…) utilise pour ses appels."
      >
        <Switch
          checked={headset.onlySelectedDevice}
          disabled={off}
          onCheckedChange={(v) => set({ onlySelectedDevice: v })}
          aria-label="Seulement le casque utilisé"
        />
      </SettingRow>
      <div className="space-y-2 px-4 py-3">
        <Alert>
          ZePhone n'agit sur les boutons que s'il a lui-même un appel (qui sonne ou en cours) : ouvert sans appel, il ne
          réagit à rien. Il n'accapare pas les boutons : si Teams écoute le même casque, elle réagira aussi. macOS
          n'attribue pas les boutons d'un casque à une application précise ; pour éviter qu'ils servent deux
          applications, fermez l'autre application ou choisissez « Désactivées » dans l'une des deux.
        </Alert>
        <p className="text-muted-foreground flex items-start gap-2 text-xs">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Si le casque a une coupure du micro matérielle, ZePhone ne peut ni la commander ni l'observer : l'indicateur «
          Micro coupé » de ZePhone ne la reflète pas.
        </p>
      </div>
    </SettingsSection>
  );
}
