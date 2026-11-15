import { Badge } from "@/components/arc/badge/badge";
import { useEngineStore } from "@/stores/engine-store";

import { SettingsSection } from "./parts";

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-4 py-3 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className="min-w-0 text-right font-medium break-all" data-selectable>
        {v}
      </span>
    </div>
  );
}

export function AboutSettings() {
  const app = useEngineStore((s) => s.appInfo);
  const engine = useEngineStore((s) => s.info);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="bg-primary text-primary-foreground flex size-14 items-center justify-center rounded-2xl text-2xl font-bold">
          Z
        </div>
        <div>
          <h2 className="text-xl font-semibold">ZePhone</h2>
          <p className="text-muted-foreground text-sm">Softphone SIP universel · version {app?.version ?? "—"}</p>
        </div>
      </div>

      <SettingsSection title="Application">
        <Row k="Version" v={app?.version ?? "—"} />
        <Row k="Système" v={app ? `${app.os} (${app.arch})` : "—"} />
        <Row k="Tauri" v={app?.tauriVersion ?? "—"} />
        <Row k="Dossier de données" v={app?.dataDir ?? "—"} />
      </SettingsSection>

      <SettingsSection title="Moteur SIP">
        <Row k="Moteur" v={engine ? `${engine.name} ${engine.version ?? ""}` : "—"} />
        <Row k="État" v={<Badge tone="neutral">{engine?.state ?? "—"}</Badge>} />
        {engine && "reason" in engine && <Row k="Détail" v={engine.reason} />}
        <Row k="Codecs" v={engine?.codecs.join(", ") || "—"} />
      </SettingsSection>

      <p className="text-muted-foreground text-xs leading-relaxed">
        ZePhone s'appuie sur Baresip (BSD-3-Clause) et libre (BSD-3-Clause), embarqués avec l'application. Aucune
        télémétrie n'est envoyée. Les mots de passe SIP sont stockés dans le trousseau du système.
      </p>
    </div>
  );
}
