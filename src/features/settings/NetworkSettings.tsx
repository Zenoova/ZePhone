import { RefreshCw, ScrollText } from "@/components/icons";
import { useState } from "react";
import { toast } from "@yusufceng1z/ding-react";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { telephony } from "@/services/telephony";
import { useEngineStore } from "@/stores/engine-store";
import { useSettingsStore } from "@/stores/settings-store";

import { Alert } from "./alert";
import { SettingRow, SettingsSection } from "./parts";

export function NetworkSettings() {
  const net = useSettingsStore((s) => s.settings.network);
  const restartRequired = useSettingsStore((s) => s.restartRequired);
  const { update, clearRestartRequired } = useSettingsStore.getState();
  const restart = useEngineStore((s) => s.restart);
  const restarting = useEngineStore((s) => s.restarting);
  const engine = useEngineStore((s) => s.info);

  // Text fields are applied on blur / Enter, not on every keystroke.
  const [port, setPort] = useState(net.localSipPort ? String(net.localSipPort) : "");
  const [iface, setIface] = useState(net.netInterface ?? "");
  const [ca, setCa] = useState(net.customCaFile ?? "");
  const [logOpen, setLogOpen] = useState(false);
  const [log, setLog] = useState<string[]>([]);

  const commit = () =>
    void update({
      network: {
        localSipPort: port.trim() === "" ? null : Number(port),
        netInterface: iface.trim() === "" ? null : iface.trim(),
        customCaFile: ca.trim() === "" ? null : ca.trim(),
      },
    });
  const onEnter = (e: React.KeyboardEvent) => e.key === "Enter" && commit();

  const doRestart = async () => {
    const err = await restart();
    if (err) toast.error(err);
    else {
      clearRestartRequired();
      toast.success("SIP engine restarted");
    }
  };

  return (
    <div className="space-y-6">
      {restartRequired && (
        <Alert tone="warning" className="items-center">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>A SIP engine restart is required to apply these changes.</span>
            <Button size="sm" onClick={() => void doRestart()} disabled={restarting}>
              <RefreshCw className="size-4" aria-hidden /> Restart now
            </Button>
          </div>
        </Alert>
      )}

      <SettingsSection
        title="Network and SIP transport"
        description="The transport (UDP, TCP, TLS) and the server port are set per account."
      >
        <SettingRow
          label="Local SIP port"
          htmlFor="net-port"
          description="Empty = chosen automatically. Useful behind a firewall."
        >
          <Input
            id="net-port"
            className="w-32"
            inputMode="numeric"
            placeholder="Auto"
            value={port}
            onChange={(e) => setPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
            onBlur={commit}
            onKeyDown={onEnter}
          />
        </SettingRow>
        <SettingRow
          label="Local interface or address"
          htmlFor="net-iface"
          description="Example: en0 or 192.168.1.20. Empty = automatic."
        >
          <Input
            id="net-iface"
            className="w-48"
            placeholder="Auto"
            value={iface}
            onChange={(e) => setIface(e.target.value)}
            onBlur={commit}
            onKeyDown={onEnter}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection
        title="TLS certificates"
        description="Server certificates are always verified with the system's authorities."
      >
        <SettingRow
          label="Certificate authority file (PEM)"
          htmlFor="net-ca"
          description="Optional: for a PBX that uses a private authority."
          stacked
        >
          <Input
            id="net-ca"
            placeholder="/path/to/ca.pem"
            value={ca}
            onChange={(e) => setCa(e.target.value)}
            onBlur={commit}
            onKeyDown={onEnter}
            autoCapitalize="off"
            spellCheck={false}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Diagnostic" description="To understand a connection problem with your server.">
        <SettingRow
          label="Trace SIP messages"
          description="Shows the SIP exchanges in the engine log (restart required)."
        >
          <Switch
            checked={net.sipTrace}
            onCheckedChange={(v) => void update({ network: { sipTrace: v } })}
            aria-label="Trace SIP messages"
          />
        </SettingRow>
        <SettingRow label="SIP engine log" description="Latest lines of Baresip output (passwords masked).">
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => {
              try {
                setLog(await telephony.getEngineLog(300));
                setLogOpen(true);
              } catch {
                toast.error("Log unavailable");
              }
            }}
          >
            <ScrollText className="size-4" aria-hidden /> Show
          </Button>
        </SettingRow>
        <SettingRow
          label="SIP engine"
          description={engine ? `${engine.name} ${engine.version ?? ""} — ${engine.state}` : "Unavailable"}
        >
          <Button variant="secondary" size="sm" onClick={() => void doRestart()} disabled={restarting}>
            <RefreshCw className="size-4" aria-hidden /> Restart
          </Button>
        </SettingRow>
      </SettingsSection>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent
          title="SIP engine log"
          description="Passwords are masked automatically."
          style={{ width: "min(calc(100vw - 2rem), 720px)" }}
        >
          <pre
            data-selectable
            className="bg-muted max-h-96 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
          >
            {log.length ? log.join("\n") : "(empty)"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
