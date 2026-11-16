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
  organizations: "Work or school accounts (organizations)",
  common: "Work, school and personal accounts (common)",
  [CUSTOM]: "A specific tenant (identifier or domain)",
};

/** The permissions each source asks for, in Microsoft's own words, and what they allow. */
function permissions(kind: Kind, level: MicrosoftLevel): Array<[string, string]> {
  if (kind === "microsoftPersonal") {
    return [
      ["Contacts.Read", "read your Outlook contacts (never modify them)"],
      ["offline_access", "stay signed in without asking for your password again"],
    ];
  }
  return [
    level === "full"
      ? [
          "User.Read.All",
          "read the profile of the people in the directory: e-mail, job title, department, numbers. Requires an administrator's consent.",
        ]
      : ["User.ReadBasic.All", "read the name and e-mail of the people in the directory, without a phone number."],
    ["offline_access", "stay signed in without asking for your password again"],
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
            ? `Reconnect ${source.name}`
            : org
              ? "Connect the organization directory"
              : "Connect your Outlook contacts"
        }
        description={
          org
            ? "Microsoft 365 · the people in your organization (Microsoft Entra ID). These are not your personal Outlook contacts."
            : "Outlook · your personal contacts. This is not your organization's directory."
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
  const [name, setName] = useState(source?.name ?? (org ? "Microsoft 365 directory" : "Outlook contacts"));
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

  const tenant = tenantChoice === CUSTOM ? customTenant.trim() : tenantChoice;
  const ready = clientId.trim() !== "" && tenant !== "";

  const connect = async () => {
    setWaiting(true);
    try {
      await telephony.directoryConnectMicrosoft({
        sourceId: source?.id,
        kind,
        name: name.trim() || (org ? "Microsoft 365 directory" : "Outlook contacts"),
        config: { clientId: clientId.trim(), tenant, level: org ? level : "full" },
        syncIntervalMin: Number.parseInt(interval, 10),
      });
      toast.success("Microsoft connected: syncing");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
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
        <Label htmlFor="ms-name">Display name</Label>
        <Input id="ms-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ms-client">Application (client) ID</Label>
          <Input
            id="ms-client"
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder="00000000-0000-0000-0000-000000000000"
            autoComplete="off"
            spellCheck={false}
            className="font-mono text-xs"
          />
          <p className="text-muted-foreground text-xs">This is not a secret: the application has no password.</p>
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
              aria-label="Tenant identifier or domain"
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
          <Label htmlFor="ms-level">Level of detail</Label>
          <Select value={level} onValueChange={(v) => setLevel(v as MicrosoftLevel)}>
            <SelectTrigger id="ms-level" aria-label="Level of detail" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full">Full: numbers, job title, department (admin consent)</SelectItem>
              <SelectItem value="basic">Basic: name and e-mail only (no numbers)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-1.5">
        <Label htmlFor="ms-interval">Automatic sync</Label>
        <Select value={interval} onValueChange={setInterval}>
          <SelectTrigger id="ms-interval" aria-label="Automatic sync" className="w-64">
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

      <section className="bg-muted/50 space-y-2 rounded-xl p-3 text-xs" aria-label="Requested permissions">
        <p className="text-sm font-medium">Requested permissions (read-only)</p>
        <ul className="space-y-1">
          {permissions(kind, level).map(([scope, what]) => (
            <li key={scope}>
              <code className="font-mono">{scope}</code> — {what}
            </li>
          ))}
        </ul>
        <p className="text-muted-foreground">
          {org
            ? "Depending on your organization, an administrator may need to approve the application for everyone, or a conditional access policy may block the sign-in. ZePhone then tells you, with what to ask for."
            : "No administrator permission is needed for your personal contacts."}{" "}
          You sign in on the Microsoft page, in your browser: ZePhone never sees your password.
        </p>
      </section>

      <details className="rounded-lg border px-3 py-2 text-xs">
        <summary className="cursor-pointer text-sm font-medium select-none">Where to find the application ID?</summary>
        <ol className="text-muted-foreground mt-2 list-decimal space-y-1 pl-4">
          <li>In the Microsoft Entra admin center: App registrations → New registration.</li>
          <li>
            Supported account types:{" "}
            {org
              ? "“Accounts in this organizational directory only”"
              : "“Accounts in any organizational directory and personal Microsoft accounts”"}
            .
          </li>
          <li>
            Redirect URI: platform “Mobile and desktop applications”, value{" "}
            <code className="font-mono">http://localhost</code>.
          </li>
          <li>Authentication → “Allow public client flows”: Yes.</li>
          <li>
            API permissions → Microsoft Graph → Delegated:{" "}
            {permissions(kind, level)
              .map(([s]) => s)
              .join(", ")}
            {org && level === "full" ? ", then “Grant admin consent”" : ""}.
          </li>
          <li>Copy the application (client) ID above; the tenant is the directory ID (or “organizations”).</li>
        </ol>
      </details>

      {waiting && (
        <Alert tone="info">
          <span data-testid="ms-waiting">
            Waiting for the sign-in in your browser… Finish it on the Microsoft page, then come back here.
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
          {waiting ? "Cancel the connection" : "Close"}
        </Button>
        <Button type="submit" disabled={!ready || waiting} loading={waiting}>
          Sign in with Microsoft
        </Button>
      </div>
    </form>
  );
}
