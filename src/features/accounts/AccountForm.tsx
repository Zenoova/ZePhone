import { useState } from "react";

import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
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
      <DialogContent
        title={account ? "Edit the SIP account" : "Add a SIP account"}
        description="Enter the information provided by your VoIP provider or your PBX administrator."
        style={{ width: "min(calc(100vw - 2rem), 640px)" }}
      >
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
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="a-label" label="Account name" hint="Optional. Default: username@domain">
          <Input id="a-label" value={form.label} onChange={text("label")} placeholder="Office" autoFocus />
        </Field>
        <Field id="a-display" label="Display name" hint="Optional. Seen by your contacts">
          <Input id="a-display" value={form.displayName} onChange={text("displayName")} />
        </Field>

        <Field id="a-server" label="SIP server">
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

        <Field id="a-domain" label="SIP domain" hint="Takes the server's value as long as you do not change it">
          <Input
            id="a-domain"
            value={form.domain}
            onChange={text("domain")}
            placeholder="example.com"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>
        <Field id="a-user" label="Username">
          <Input
            id="a-user"
            value={form.username}
            onChange={text("username")}
            placeholder="1001"
            autoCapitalize="off"
            spellCheck={false}
          />
        </Field>

        <Field id="a-auth" label="Authentication username" hint="Takes the username as long as you do not change it">
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
          label="Password"
          hint={
            account?.hasPassword
              ? "Saved in the keychain. Leave empty to keep it."
              : "Stored in the system keychain, never in clear text."
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
        <summary className="cursor-pointer text-sm font-medium">Advanced options</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field id="a-proxy" label="Outbound proxy" hint="host[:port] — replaces the server as the next hop">
            <Input
              id="a-proxy"
              value={form.outboundProxy}
              onChange={text("outboundProxy")}
              placeholder="proxy.example.com:5060"
            />
          </Field>
          <Field id="a-regint" label="Registration interval (s)" hint="0 = no registration (direct calls)">
            <Input
              id="a-regint"
              inputMode="numeric"
              value={form.registerInterval}
              onChange={text("registerInterval")}
            />
          </Field>
          <Field id="a-media" label="Media encryption">
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
            <Label htmlFor="a-enabled">Account enabled</Label>
            <Switch id="a-enabled" checked={form.enabled} onCheckedChange={set("enabled")} />
          </div>
        </div>
      </details>

      <div className="flex justify-end gap-2 pt-3">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || !valid}>
          {account ? "Save" : "Add and connect"}
        </Button>
      </div>
    </form>
  );
}
