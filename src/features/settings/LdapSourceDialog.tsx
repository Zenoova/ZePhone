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
  auth: "Vérifiez le compte de connexion (Bind DN) et son mot de passe.",
  forbidden: "Ce compte n'a pas le droit de lire l'annuaire : demandez l'accès à votre administrateur.",
  config: "Corrigez le réglage indiqué, puis testez à nouveau.",
  network: "Vérifiez l'adresse, le port et votre connexion au réseau de l'entreprise (VPN).",
  invalid: "Vérifiez la base de recherche et le filtre.",
  server: "Le serveur est indisponible : réessayez dans un instant.",
  throttled: "Le serveur demande de patienter : réessayez dans un instant.",
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
    name: f.name.trim() || "Annuaire LDAP",
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
 * Adds or edits an LDAP source. Nothing is turned on before the user has seen it work: "Tester la connexion" signs in
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
        title={source ? "Modifier l'annuaire LDAP" : "Connecter un annuaire LDAP"}
        description="Serveur LDAP ou Active Directory. La connexion est chiffrée et le certificat du serveur est toujours vérifié."
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
      setTest({ key, result: await telephony.directoryTestLdap(input) });
    } catch (e) {
      setTest({ key, result: { ok: false, report: null, error: { kind: "config", message: errorMessage(e) } } });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await telephony.directorySaveLdap(input);
      toast.success(source ? "Annuaire modifié" : "Annuaire ajouté : synchronisation en cours");
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
        <Field id="ldap-name" label="Nom affiché">
          <Input
            id="ldap-name"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
            placeholder="Annuaire de l'entreprise"
          />
        </Field>
        <Field id="ldap-preset" label="Type de serveur">
          <Select value={form.preset} onValueChange={(v) => applyPreset(v as LdapPreset)}>
            <SelectTrigger id="ldap-preset" aria-label="Type de serveur" className="w-full">
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
        label="Adresse du serveur"
        hint="ldaps://ldap.entreprise.fr (recommandé) ou ldap://… avec StartTLS. Un mot de passe ne circule jamais en clair."
      >
        <Input
          id="ldap-url"
          value={form.url}
          onChange={(e) => set("url", e.target.value)}
          placeholder="ldaps://ldap.entreprise.fr:636"
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
      <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
        <label htmlFor="ldap-starttls" className="text-sm">
          Utiliser StartTLS <span className="text-muted-foreground text-xs">(pour une adresse ldap://)</span>
        </label>
        <Switch id="ldap-starttls" checked={form.starttls} onCheckedChange={(v) => set("starttls", v)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="ldap-bind" label="Compte de connexion (Bind DN)" hint="Laissez vide pour une lecture anonyme.">
          <Input
            id="ldap-bind"
            value={form.bindDn}
            onChange={(e) => set("bindDn", e.target.value)}
            placeholder="cn=lecteur,dc=entreprise,dc=fr"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="ldap-password"
          label="Mot de passe"
          hint={
            source
              ? "Laissez vide pour garder celui qui est enregistré."
              : "Conservé dans le trousseau du système, jamais dans un fichier."
          }
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
        <Field id="ldap-base" label="Base de recherche (Base DN)">
          <Input
            id="ldap-base"
            value={form.baseDn}
            onChange={(e) => set("baseDn", e.target.value)}
            placeholder="ou=people,dc=entreprise,dc=fr"
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field id="ldap-scope" label="Portée">
          <Select value={form.scope} onValueChange={(v) => set("scope", v as LdapConfig["scope"])}>
            <SelectTrigger id="ldap-scope" aria-label="Portée" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="subtree">Tout l'arbre</SelectItem>
              <SelectItem value="oneLevel">Un seul niveau</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        id="ldap-filter"
        label="Filtre"
        hint="Seules les personnes qui répondent au filtre sont lues. Les groupes techniques et de sécurité ne sont pas importés."
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
        <summary className="cursor-pointer font-medium select-none">Correspondance des champs</summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground text-xs">
            Pour chaque champ, les attributs du serveur à lire (le premier qui existe est retenu), séparés par des
            virgules.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(
              [
                ["id", "Identifiant stable"],
                ["displayName", "Nom affiché"],
                ["firstName", "Prénom"],
                ["lastName", "Nom"],
                ["email", "E-mail"],
                ["company", "Entreprise"],
                ["department", "Service"],
                ["title", "Fonction"],
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
            <p className="text-sm font-medium">Numéros de téléphone</p>
            {form.mapping.phones.map((p, i) => (
              <div key={i} className="flex gap-2" data-testid="phone-mapping">
                <Input
                  aria-label={`Attribut du numéro ${i + 1}`}
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
                  <SelectTrigger aria-label={`Type du numéro ${i + 1}`} className="w-44 shrink-0">
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
                  aria-label={`Retirer le numéro ${i + 1}`}
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
              <Plus className="size-4" aria-hidden /> Ajouter un attribut de numéro
            </Button>
          </div>
        </div>
      </details>

      <Field id="ldap-interval" label="Synchronisation automatique">
        <Select value={form.interval} onValueChange={(v) => set("interval", v)}>
          <SelectTrigger id="ldap-interval" aria-label="Synchronisation automatique" className="w-64">
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

      {result && !result.ok && result.error && (
        <Alert tone="error" className="items-start">
          <div data-testid="ldap-test-error">
            <p className="font-medium">{result.error.message}</p>
            <p className="mt-0.5 opacity-80">{HINT[result.error.kind]}</p>
          </div>
        </Alert>
      )}
      {result?.ok && result.report && (
        <div className="space-y-2" data-testid="ldap-test-ok">
          <Alert tone="info">
            Connexion réussie{result.report.authenticated ? "" : " (lecture anonyme)"}. Voici les premiers contacts que
            ces réglages donneront : si c'est bon, enregistrez pour activer la source.
          </Alert>
          {result.report.warnings.map((w) => (
            <Alert key={w} tone="warning">
              {w}
            </Alert>
          ))}
          <ul className="max-h-48 divide-y overflow-y-auto rounded-xl border text-sm" aria-label="Aperçu des contacts">
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
          Annuler
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={testing}
          disabled={testing || saving}
          onClick={() => void runTest()}
        >
          Tester la connexion
        </Button>
        <Button
          type="submit"
          disabled={!tested || saving}
          loading={saving}
          title={tested ? undefined : "Testez d'abord la connexion"}
        >
          {source ? "Enregistrer" : "Enregistrer et activer"}
        </Button>
      </div>
    </form>
  );
}
