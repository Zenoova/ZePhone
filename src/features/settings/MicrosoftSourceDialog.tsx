import { toast } from "@yusufceng1z/ding-react";
import { useState } from "react";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERVAL_OPTIONS } from "@/lib/directory";
import { errorMessage, telephony } from "@/services/telephony";
import type { MicrosoftConfig, MicrosoftLevel, SourceView } from "@/types/directory";

import { Alert } from "./alert";

type Kind = "microsoftOrg" | "microsoftPersonal";

const CUSTOM = "custom";
const TENANTS: Record<string, string> = {
  organizations: "Comptes professionnels ou scolaires (organizations)",
  common: "Comptes professionnels et personnels (common)",
  [CUSTOM]: "Un tenant précis (identifiant ou domaine)",
};

/** The permissions each source asks for, in Microsoft's own words, and what they allow. */
function permissions(kind: Kind, level: MicrosoftLevel): Array<[string, string]> {
  if (kind === "microsoftPersonal") {
    return [
      ["Contacts.Read", "lire vos contacts Outlook (jamais les modifier)"],
      ["offline_access", "rester connecté sans vous redemander votre mot de passe"],
    ];
  }
  return [
    level === "full"
      ? [
          "User.Read.All",
          "lire le profil des personnes de l'annuaire : e-mail, fonction, service, numéros. Exige le consentement d'un administrateur.",
        ]
      : ["User.ReadBasic.All", "lire le nom et l'e-mail des personnes de l'annuaire, sans numéro de téléphone."],
    ["offline_access", "rester connecté sans vous redemander votre mot de passe"],
  ];
}

/**
 * Connects Microsoft 365. The two sources it can create are different things and are never mixed: the organisation's
 * directory (everybody in the company) and the user's own Outlook contacts (private). Signing in happens in the
 * user's browser, on Microsoft's own page: ZePhone never sees the password.
 */
export function MicrosoftSourceDialog({
  open,
  onOpenChange,
  kind,
  source,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  kind: Kind;
  source: SourceView | null;
}) {
  const org = kind === "microsoftOrg";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={
          source
            ? `Reconnecter ${source.name}`
            : org
              ? "Connecter l'annuaire de l'organisation"
              : "Connecter vos contacts Outlook"
        }
        description={
          org
            ? "Microsoft 365 · les personnes de votre organisation (Microsoft Entra ID). Ce ne sont pas vos contacts Outlook personnels."
            : "Outlook · vos contacts personnels. Ce n'est pas l'annuaire de votre organisation."
        }
        style={{ width: "min(calc(100vw - 2rem), 600px)" }}
      >
        <MicrosoftForm key={source?.id ?? kind} kind={kind} source={source} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function MicrosoftForm({ kind, source, onDone }: { kind: Kind; source: SourceView | null; onDone: () => void }) {
  const org = kind === "microsoftOrg";
  const saved = (source?.config ?? {}) as Partial<MicrosoftConfig>;
  const [name, setName] = useState(source?.name ?? (org ? "Annuaire Microsoft 365" : "Contacts Outlook"));
  const [clientId, setClientId] = useState(saved.clientId ?? "");
  const [tenantChoice, setTenantChoice] = useState(
    saved.tenant && saved.tenant !== "organizations" && saved.tenant !== "common"
      ? CUSTOM
      : (saved.tenant ?? (org ? "organizations" : "common")),
  );
  const [customTenant, setCustomTenant] = useState(tenantChoice === CUSTOM ? (saved.tenant ?? "") : "");
  const [level, setLevel] = useState<MicrosoftLevel>(saved.level ?? "full");
  const [interval, setInterval] = useState(String(source?.syncIntervalMin ?? 360));
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenant = tenantChoice === CUSTOM ? customTenant.trim() : tenantChoice;
  const ready = clientId.trim() !== "" && tenant !== "";

  const connect = async () => {
    setError(null);
    setWaiting(true);
    try {
      await telephony.directoryConnectMicrosoft({
        sourceId: source?.id,
        kind,
        name: name.trim() || (org ? "Annuaire Microsoft 365" : "Contacts Outlook"),
        config: { clientId: clientId.trim(), tenant, level: org ? level : "full" },
        syncIntervalMin: Number.parseInt(interval, 10),
      });
      toast.success("Microsoft connecté : synchronisation en cours");
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setWaiting(false);
    }
  };

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (ready && !waiting) void connect();
      }}
    >
      <div className="space-y-1.5">
        <Label htmlFor="ms-name">Nom affiché</Label>
        <Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ms-client">Identifiant d'application (client ID)</Label>
          <Input
            id="ms-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">
            Ce n'est pas un secret : l'application n'a pas de mot de passe.
          </p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ms-tenant">Tenant</Label>
          <Select value={tenantChoice} onValueChange={setTenantChoice}>
            <SelectTrigger id="ms-tenant" aria-label="Tenant" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.entries(TENANTS).map(([k, label]) => (
                <SelectItem key={k} value={k}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {tenantChoice === CUSTOM && (
            <Input
              aria-label="Identifiant ou domaine du tenant"
              value={customTenant}
              onChange={(e) => setCustomTenant(e.target.value)}
              placeholder="contoso.onmicrosoft.com"
              spellCheck={false}
            />
          )}
        </div>
      </div>

      {org && (
        <div className="space-y-1.5">
          <Label htmlFor="ms-level">Niveau de détail</Label>
          <Select value={level} onValueChange={(v) => setLevel(v as MicrosoftLevel)}>
            <SelectTrigger id="ms-level" aria-label="Niveau de détail" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Complet : numéros, fonction, service (consentement administrateur)</SelectItem>
              <SelectItem value="basic">Basique : nom et e-mail seulement (sans numéros)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="ms-interval">Synchronisation automatique</Label>
        <Select value={interval} onValueChange={setInterval}>
          <SelectTrigger id="ms-interval" aria-label="Synchronisation automatique" className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INTERVAL_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="bg-muted/50 space-y-2 rounded-xl p-3 text-xs" aria-label="Autorisations demandées">
        <p className="text-sm font-medium">Autorisations demandées (lecture seule)</p>
        <ul className="space-y-1">
          {permissions(kind, level).map(([scope, what]) => (
            <li key={scope}>
              <code className="font-mono">{scope}</code> — {what}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          {org
            ? "Selon votre organisation, un administrateur doit peut-être approuver l'application pour tous, ou une règle d'accès conditionnel peut bloquer la connexion. ZePhone vous l'indique alors, avec ce qu'il faut demander."
            : "Aucune autorisation d'administrateur n'est nécessaire pour vos contacts personnels."}{" "}
          Vous vous connectez sur la page de Microsoft, dans votre navigateur : ZePhone ne voit jamais votre mot de
          passe.
        </p>
      </section>

      <details className="rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer text-sm font-medium select-none">
          Où trouver l'identifiant d'application ?
        </summary>
        <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-4">
          <li>Dans le centre d'administration Microsoft Entra : Inscriptions d'applications → Nouvelle inscription.</li>
          <li>
            Types de comptes pris en charge :{" "}
            {org
              ? "« Comptes de cet annuaire organisationnel uniquement »"
              : "« Comptes dans un annuaire organisationnel et comptes Microsoft personnels »"}
            .
          </li>
          <li>
            URI de redirection : plateforme « Application mobile et de bureau », valeur{" "}
            <code className="font-mono">http://localhost</code>.
          </li>
          <li>Authentification → « Autoriser les flux clients publics » : Oui.</li>
          <li>
            Autorisations d'API → Microsoft Graph → Déléguées :{" "}
            {permissions(kind, level)
              .map(([s]) => s)
              .join(", ")}
            {org && level === "full" ? ", puis « Accorder le consentement de l'administrateur »" : ""}.
          </li>
          <li>
            Copiez l'identifiant d'application (client) ci-dessus ; le tenant est l'identifiant d'annuaire (ou «
            organizations »).
          </li>
        </ol>
      </details>

      {error && (
        <Alert tone="error" className="items-start">
          <div data-testid="ms-error">{error}</div>
        </Alert>
      )}
      {waiting && (
        <Alert tone="info">
          <span data-testid="ms-waiting">
            En attente de la connexion dans votre navigateur… Terminez-la sur la page de Microsoft, puis revenez ici.
          </span>
        </Alert>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            if (waiting) void telephony.directoryCancelConnect();
            else onDone();
          }}
        >
          {waiting ? "Annuler la connexion" : "Fermer"}
        </Button>
        <Button type="submit" disabled={!ready || waiting} loading={waiting}>
          Se connecter avec Microsoft
        </Button>
      </div>
    </form>
  );
}
