import { RefreshCw, ScrollText } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
      toast.success("Moteur SIP redémarré");
    }
  };

  return (
    <div className="space-y-6">
      {restartRequired && (
        <Alert tone="warning" className="items-center">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span>Un redémarrage du moteur SIP est nécessaire pour appliquer ces changements.</span>
            <Button size="sm" onClick={() => void doRestart()} disabled={restarting}>
              <RefreshCw className="size-4" aria-hidden /> Redémarrer maintenant
            </Button>
          </div>
        </Alert>
      )}

      <SettingsSection
        title="Réseau et transport SIP"
        description="Le transport (UDP, TCP, TLS) et le port du serveur se règlent compte par compte."
      >
        <SettingRow
          label="Port SIP local"
          htmlFor="net-port"
          description="Vide = choisi automatiquement. Utile derrière un pare-feu."
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
          label="Interface ou adresse locale"
          htmlFor="net-iface"
          description="Exemple : en0 ou 192.168.1.20. Vide = automatique."
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
        title="Certificats TLS"
        description="Les certificats des serveurs sont toujours vérifiés avec les autorités du système."
      >
        <SettingRow
          label="Fichier d'autorités de certification (PEM)"
          htmlFor="net-ca"
          description="Facultatif : pour un PBX utilisant une autorité privée."
          stacked
        >
          <Input
            id="net-ca"
            placeholder="/chemin/vers/ca.pem"
            value={ca}
            onChange={(e) => setCa(e.target.value)}
            onBlur={commit}
            onKeyDown={onEnter}
            autoCapitalize="off"
            spellCheck={false}
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Diagnostic" description="Pour comprendre un problème de connexion avec votre serveur.">
        <SettingRow
          label="Tracer les messages SIP"
          description="Affiche les échanges SIP dans le journal du moteur (redémarrage requis)."
        >
          <Switch
            checked={net.sipTrace}
            onCheckedChange={(v) => void update({ network: { sipTrace: v } })}
            aria-label="Tracer les messages SIP"
          />
        </SettingRow>
        <SettingRow
          label="Journal du moteur SIP"
          description="Dernières lignes de sortie de Baresip (mots de passe masqués)."
        >
          <Button
            variant="outline"
            size="sm"
            onClick={async () => {
              try {
                setLog(await telephony.getEngineLog(300));
                setLogOpen(true);
              } catch {
                toast.error("Journal indisponible");
              }
            }}
          >
            <ScrollText className="size-4" aria-hidden /> Afficher
          </Button>
        </SettingRow>
        <SettingRow
          label="Moteur SIP"
          description={engine ? `${engine.name} ${engine.version ?? ""} — ${engine.state}` : "Indisponible"}
        >
          <Button variant="outline" size="sm" onClick={() => void doRestart()} disabled={restarting}>
            <RefreshCw className="size-4" aria-hidden /> Redémarrer
          </Button>
        </SettingRow>
      </SettingsSection>

      <Dialog open={logOpen} onOpenChange={setLogOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Journal du moteur SIP</DialogTitle>
            <DialogDescription>Les mots de passe sont masqués automatiquement.</DialogDescription>
          </DialogHeader>
          <pre
            data-selectable
            className="bg-muted max-h-96 overflow-auto rounded-lg p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
          >
            {log.length ? log.join("\n") : "(vide)"}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
