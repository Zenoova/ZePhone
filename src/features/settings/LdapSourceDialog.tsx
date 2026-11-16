import { toast } from "@yusufceng1z/ding-react";
import { useState } from "react";

import { Plus, Trash2 } from "@/components/icons";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Switch } from "@/components/arc/switch/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INTERVAL_OPTIONS, PHONE_KIND_LABEL } from "@/lib/directory";
import {
  EMPTY_LDAP_CONFIG,
  LDAP_PRESET_LABEL,
  type LdapPreset,
  joinList,
  parseList,
  presetConfig,
} from "@/lib/ldap-presets";
import { errorMessage, telephony } from "@/services/telephony";
import type {
  LdapConfig,
  LdapMapping,
  LdapSourceInput,
  LdapTestResult,
  PhoneKind,
  SourceView,
} from "@/types/directory";

import { Alert } from "./alert";

const PHONE_KINDS: PhoneKind[] = ["work", "mobile", "extension", "home", "sip", "other"];

/** What to do about each kind of failure, said under the message of the server. */
const HINT: Record<string, string> = {
  auth: "Check the sign-in account (Bind DN) and its password.",
  forbidden: "This account is not allowed to read the directory: ask your administrator for access.",
  config: "Fix the indicated setting, then test again.",
  network: "Check the address, the port and your connection to the company network (VPN).",
  invalid: "Check the search base and the filter.",
  server: "The server is unavailable: try again in a moment.",
  throttled: "The server asks you to wait: try again in a moment.",
};

interface Form {
  name: string;
  preset: LdapPreset;
  url: string;
  starttls: boolean;
  bindDn: string;
  password: string;
  baseDn: string;
  scope: LdapConfig["scope"];
  filter: string;
  pageSize: string;
  interval: string;
  mapping: LdapMapping;
}

function fromSource(source: SourceView | null): Form {
  const c = { ...EMPTY_LDAP_CONFIG, ...(source?.config as Partial<LdapConfig> | undefined) };
  return {
    name: source?.name ?? "",
    preset: c.filter.includes("objectCategory") ? "activedirectory" : "openldap",
    url: c.url,
    starttls: c.starttls,
    bindDn: c.bindDn,
    password: "",
    baseDn: c.baseDn,
    scope: c.scope,
    filter: c.filter,
    pageSize: String(c.pageSize),
    interval: String(source?.syncIntervalMin ?? 360),
    mapping: c.mapping,
  };
}

function toInput(f: Form, id?: string): LdapSourceInput {
  return {
    id,
    name: f.name.trim() || "LDAP directory",
    config: {
      url: f.url.trim(),
      starttls: f.starttls,
      bindDn: f.bindDn.trim(),
      baseDn: f.baseDn.trim(),
      scope: f.scope,
      filter: f.filter.trim(),
      pageSize: Number.parseInt(f.pageSize, 10) || 500,
      mapping: f.mapping,
    },
    password: f.password || undefined,
    syncIntervalMin: Number.parseInt(f.interval, 10),
  };
}

function Field({ id, label, hint, children }: { id: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-muted-foreground text-xs">{hint}</p>}
    </div>
  );
}

/**
 * Adds or edits an LDAP source. Nothing is turned on before the user has seen it work: "Test the connection" signs in
 * and shows the first contacts the settings would produce, and only a test of the settings as they are now unlocks
 * the save button.
 */
export function LdapSourceDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  source: SourceView | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={source ? "Edit the LDAP directory" : "Connect an LDAP directory"}
        description="LDAP or Active Directory server. The connection is encrypted and the server's certificate is always verified."
        style={{ width: "min(calc(100vw - 2rem), 640px)" }}
      >
        <LdapForm key={source?.id ?? "new"} source={source} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function LdapForm({ source, onDone }: { source: SourceView | null; onDone: () => void }) {
  const [form, setForm] = useState<Form>(() => fromSource(source));
  const [test, setTest] = useState<{ key: string; result: LdapTestResult } | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const input = toInput(form, source?.id);
  // A test counts only for the settings it was run with.
  const key = JSON.stringify([input.config, form.password]);
  const tested = test?.key === key && test.result.ok;
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const setMapping = (patch: Partial<LdapMapping>) => setForm((f) => ({ ...f, mapping: { ...f.mapping, ...patch } }));

  const applyPreset = (p: LdapPreset) => {
    const { filter, mapping } = presetConfig(p);
    setForm((f) => ({ ...f, preset: p, filter, mapping }));
  };

  const runTest = async () => {
    setTesting(true);
    try {
      const result = await telephony.directoryTestLdap(input);
      setTest({ key, result });
      if (!result.ok && result.error) toast.error(result.error.message, { description: HINT[result.error.kind] });
    } catch (e) {
      setTest({ key, result: { ok: false, report: null, error: { kind: "config", message: errorMessage(e) } } });
      toast.error(errorMessage(e), { description: HINT.config });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await telephony.directorySaveLdap(input);
      toast.success(source ? "Directory updated" : "Directory added: syncing");
      onDone();
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const result = test?.key === key ? test.result : null;

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (tested) void save();
        else void runTest();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ldap-name" label="Display name">
          <Input
            id="ldap-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Company directory"
          />
        </Field>
        <Field id="ldap-preset" label="Server type">
          <Select value={form.preset} onValueChange={(v) => applyPreset(v as LdapPreset)}>
            <SelectTrigger id="ldap-preset" aria-label="Server type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(LDAP_PRESET_LABEL) as LdapPreset[]).map((p) => (
                <SelectItem key={p} value={p}>
                  {LDAP_PRESET_LABEL[p]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field
        id="ldap-url"
        label="Server address"
        hint="ldaps://ldap.company.example (recommended) or ldap://… with StartTLS. A password never travels in clear text."
      >
        <Input
          id="ldap-url"
          value={form.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="ldaps://ldap.company.example:636"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <label htmlFor="ldap-starttls" className="text-sm">
          Use StartTLS <span className="text-muted-foreground text-xs">(for an ldap:// address)</span>
        </label>
        <Switch id="ldap-starttls" checked={form.starttls} onCheckedChange={(v) => set("starttls", v)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ldap-bind" label="Sign-in account (Bind DN)" hint="Leave empty for anonymous reading.">
          <Input
            id="ldap-bind"
            value={form.bindDn}
            onChange={(e) => set("bindDn", e.target.value)}
            placeholder="cn=reader,dc=company,dc=example"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="ldap-password"
          label="Password"
          hint={source ? "Leave empty to keep the one that is saved." : "Kept in the system keychain, never in a file."}
        >
          <PasswordInput
            id="ldap-password"
            value={form.password}
            onChange={(e) => set("password", e.target.value)}
            autoComplete="new-password"
            placeholder={source ? "••••••••" : ""}
          />
        </Field>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <Field id="ldap-base" label="Search base (Base DN)">
          <Input
            id="ldap-base"
            value={form.baseDn}
            onChange={(e) => set("baseDn", e.target.value)}
            placeholder="ou=people,dc=company,dc=example"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field id="ldap-scope" label="Scope">
          <Select value={form.scope} onValueChange={(v) => set("scope", v as LdapConfig["scope"])}>
            <SelectTrigger id="ldap-scope" aria-label="Scope" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subtree">Whole tree</SelectItem>
              <SelectItem value="oneLevel">One level only</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        id="ldap-filter"
        label="Filter"
        hint="Only the people matching the filter are read. Technical and security groups are not imported."
      >
        <Input
          id="ldap-filter"
          value={form.filter}
          onChange={(e) => set("filter", e.target.value)}
          className="font-mono text-xs"
          spellCheck={false}
        />
      </Field>

      <details className="rounded-lg border px-3 py-2 text-sm">
        <summary className="cursor-pointer font-medium select-none">Field mapping</summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground text-xs">
            For each field, the server attributes to read (the first that exists is used), separated by virgules.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["id", "Stable identifier"],
                ["displayName", "Display name"],
                ["firstName", "First name"],
                ["lastName", "Name"],
                ["email", "E-mail"],
                ["company", "Company"],
                ["department", "Department"],
                ["title", "Job title"],
              ] as const
            ).map(([k, label]) => (
              <Field key={k} id={`map-${k}`} label={label}>
                <Input
                  id={`map-${k}`}
                  value={joinList(form.mapping[k])}
                  onChange={(e) => setMapping({ [k]: parseList(e.target.value) })}
                  className="font-mono text-xs"
                  spellCheck={false}
                />
              </Field>
            ))}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Phone numbers</p>
            {form.mapping.phones.map((p, i) => (
              <div key={i} className="flex gap-2" data-testid="phone-mapping">
                <Input
                  aria-label={`Number attribute ${i + 1}`}
                  value={p.attribute}
                  onChange={(e) =>
                    setMapping({
                      phones: form.mapping.phones.map((x, j) => (j === i ? { ...x, attribute: e.target.value } : x)),
                    })
                  }
                  className="font-mono text-xs"
                  spellCheck={false}
                />
                <Select
                  value={p.kind}
                  onValueChange={(v) =>
                    setMapping({
                      phones: form.mapping.phones.map((x, j) => (j === i ? { ...x, kind: v as PhoneKind } : x)),
                    })
                  }
                >
                  <SelectTrigger aria-label={`Number type ${i + 1}`} className="w-44 shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PHONE_KINDS.map((k) => (
                      <SelectItem key={k} value={k}>
                        {PHONE_KIND_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={`Remove number ${i + 1}`}
                  onClick={() => setMapping({ phones: form.mapping.phones.filter((_, j) => j !== i) })}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setMapping({ phones: [...form.mapping.phones, { attribute: "", kind: "other" }] })}
            >
              <Plus className="size-4" aria-hidden /> Add a number attribute
            </Button>
          </div>
        </div>
      </details>

      <Field id="ldap-interval" label="Automatic sync">
        <Select value={form.interval} onValueChange={(v) => set("interval", v)}>
          <SelectTrigger id="ldap-interval" aria-label="Automatic sync" className="w-64">
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
      </Field>

      {result?.ok && result.report && (
        <div className="space-y-2" data-testid="ldap-test-ok">
          <Alert tone="info">
            Connection successful{result.report.authenticated ? "" : " (anonymous read)"}. Here are the first contacts
            these settings will give: if it looks right, save to enable the source.
          </Alert>
          {result.report.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border text-sm" aria-label="Contacts preview">
            {result.report.preview.map((c) => (
              <li key={c.externalId} className="px-3 py-2" data-testid="preview-contact">
                <p className="font-medium">{c.displayName || `${c.firstName} ${c.lastName}`.trim()}</p>
                <p className="text-muted-foreground text-xs">
                  {[c.title, c.department, c.email].filter(Boolean).join(" · ")}
                  {c.phones.length > 0 && " · "}
                  {c.phones.map((p) => `${PHONE_KIND_LABEL[p.kind]} ${p.number}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={testing}
          disabled={testing || saving}
          onClick={() => void runTest()}
        >
          Test the connection
        </Button>
        <Button
          type="submit"
          disabled={!tested || saving}
          loading={saving}
          title={tested ? undefined : "Test the connection first"}
        >
          {source ? "Save" : "Save and enable"}
        </Button>
      </div>
    </form>
  );
}
