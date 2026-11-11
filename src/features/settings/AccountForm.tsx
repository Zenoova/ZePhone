import { useState } from "react";

import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { MEDIA_ENCRYPTION_LABEL, TRANSPORT_LABEL } from "@/lib/labels";
import { useAccountsStore } from "@/stores/accounts-store";

import { defaultPort, editField, type FormState, toForm, toInput } from "./account-form-model";
import type { AccountView, MediaEncryption, Transport } from "@/types/telephony";

export function AccountFormDialog({
  open,
  onOpenChange,
  account,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  account: AccountView | null;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <AccountFormBody key={account?.id ?? "new"} account={account} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
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

function AccountFormBody({ account, onDone }: { account: AccountView | null; onDone: () => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(account));
  const [busy, setBusy] = useState(false);
  const save = useAccountsStore((s) => s.save);
  const set =
    <K extends keyof FormState>(k: K) =>
    (v: FormState[K]) =>
      setForm((f) => editField(f, k, v));
  const text = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) => set(k)(e.target.value as never);

  const onTransport = (t: Transport) =>
    setForm((f) => ({ ...f, transport: t, port: f.port === defaultPort(f.transport) ? defaultPort(t) : f.port }));

  const valid =
    form.server.trim() &&
    form.username.trim() &&
    (account?.hasPassword || form.password || Number(form.registerInterval) === 0);

  const submit = async () => {
    setBusy(true);
    const saved = await save(toInput(form, account?.id ?? null));
    setBusy(false);
    if (saved) onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <DialogHeader>
        <DialogTitle>{account ? "Modifier le compte SIP" : "Ajouter un compte SIP"}</DialogTitle>
        <DialogDescription>
          Renseignez les informations fournies par votre opérateur VoIP ou votre administrateur PBX.
        </DialogDescription>
      </DialogHeader>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="a-label" label="Nom du compte" hint="Facultatif. Par défaut : identifiant@domaine">
          <Input id="a-label" value={form.label} onChange={text("label")} placeholder="Bureau" autoFocus />
        </Field>
        <Field id="a-display" label="Nom affiché" hint="Facultatif. Vu par vos correspondants">
          <Input id="a-display" value={form.displayName} onChange={text("displayName")} />
        </Field>

        <Field id="a-server" label="Serveur SIP">
          <Input
            id="a-server"
            value={form.server}
            onChange={text("server")}
            placeholder="sip.example.com"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <div className="grid grid-cols-[1fr_1.4fr] gap-3">
          <Field id="a-port" label="Port">
            <Input id="a-port" inputMode="numeric" value={form.port} onChange={text("port")} />
          </Field>
          <Field id="a-transport" label="Transport">
            <Select value={form.transport} onValueChange={(v) => onTransport(v as Transport)}>
              <SelectTrigger id="a-transport" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TRANSPORT_LABEL) as Transport[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TRANSPORT_LABEL[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field id="a-domain" label="Domaine SIP" hint="Reprend le serveur tant que vous ne le modifiez pas">
          <Input
            id="a-domain"
            value={form.domain}
            onChange={text("domain")}
            placeholder="example.com"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field id="a-user" label="Identifiant">
          <Input
            id="a-user"
            value={form.username}
            onChange={text("username")}
            placeholder="1001"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>

        <Field
          id="a-auth"
          label="Identifiant d'authentification"
          hint="Reprend l'identifiant tant que vous ne le modifiez pas"
        >
          <Input
            id="a-auth"
            value={form.authUsername}
            onChange={text("authUsername")}
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field
          id="a-pass"
          label="Mot de passe"
          hint={
            account?.hasPassword
              ? "Enregistré dans le trousseau. Laissez vide pour le conserver."
              : "Stocké dans le trousseau du système, jamais en clair."
          }
        >
          <PasswordInput
            id="a-pass"
            autoComplete="new-password"
            value={form.password}
            onChange={text("password")}
            placeholder={account?.hasPassword ? "••••••••" : ""}
          />
        </Field>
      </div>

      <details className="rounded-xl border px-4 py-3">
        <summary className="cursor-pointer text-sm font-medium">Options avancées</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="a-proxy" label="Proxy sortant" hint="host[:port] — remplace le serveur comme prochain saut">
            <Input
              id="a-proxy"
              value={form.outboundProxy}
              onChange={text("outboundProxy")}
              placeholder="proxy.example.com:5060"
            />
          </Field>
          <Field id="a-regint" label="Intervalle d'enregistrement (s)" hint="0 = pas d'enregistrement (appels directs)">
            <Input
              id="a-regint"
              inputMode="numeric"
              value={form.registerInterval}
              onChange={text("registerInterval")}
            />
          </Field>
          <Field id="a-media" label="Chiffrement des médias">
            <Select value={form.mediaEncryption} onValueChange={(v) => set("mediaEncryption")(v as MediaEncryption)}>
              <SelectTrigger id="a-media" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(MEDIA_ENCRYPTION_LABEL) as MediaEncryption[]).map((m) => (
                  <SelectItem key={m} value={m}>
                    {MEDIA_ENCRYPTION_LABEL[m]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="flex items-center justify-between gap-3 self-end rounded-lg border px-3 py-2">
            <Label htmlFor="a-enabled">Compte activé</Label>
            <Switch id="a-enabled" checked={form.enabled} onCheckedChange={set("enabled")} />
          </div>
        </div>
      </details>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy || !valid}>
          {account ? "Enregistrer" : "Ajouter et connecter"}
        </Button>
      </DialogFooter>
    </form>
  );
}
