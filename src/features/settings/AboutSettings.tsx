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
        <img src="/zephone-icon.svg" alt="ZePhone logo" width={56} height={56} className="size-14 shrink-0" />
        <div>
          <h2 className="text-xl font-semibold">ZePhone</h2>
          <p className="text-muted-foreground text-sm">Universal SIP softphone · version {app?.version ?? "—"}</p>
        </div>
      </div>

      <SettingsSection title="Application">
        <Row k="Version" v={app?.version ?? "—"} />
        <Row k="System" v={app ? `${app.os} (${app.arch})` : "—"} />
        <Row k="Tauri" v={app?.tauriVersion ?? "—"} />
        <Row k="Data folder" v={app?.dataDir ?? "—"} />
      </SettingsSection>

      <SettingsSection title="SIP engine">
        <Row k="Engine" v={engine ? `${engine.name} ${engine.version ?? ""}` : "—"} />
        <Row k="State" v={<Badge tone="neutral">{engine?.state ?? "—"}</Badge>} />
        {engine && "reason" in engine && <Row k="Details" v={engine.reason} />}
        <Row k="Codecs" v={engine?.codecs.join(", ") || "—"} />
      </SettingsSection>

      <p className="text-muted-foreground text-xs leading-relaxed">
        ZePhone relies on Baresip (BSD-3-Clause) and libre (BSD-3-Clause), shipped with the application. SIP passwords
        are stored in the system keychain.
      </p>
    </div>
  );
}
