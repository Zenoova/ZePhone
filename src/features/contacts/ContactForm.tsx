import { useState } from "react";

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
import { useContactsStore } from "@/stores/contacts-store";
import type { Contact } from "@/types/telephony";

interface FormState {
  firstName: string;
  lastName: string;
  company: string;
  number: string;
}

const empty: FormState = { firstName: "", lastName: "", company: "", number: "" };

function fromContact(c: Contact | null, prefillNumber?: string): FormState {
  return c
    ? { firstName: c.firstName, lastName: c.lastName, company: c.company ?? "", number: c.number }
    : { ...empty, number: prefillNumber ?? "" };
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  prefillNumber,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  prefillNumber?: string;
}) {
  // The dialog content is remounted on every open (see `key` below), so state starts fresh.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <ContactFormBody
          key={contact?.id ?? "new"}
          contact={contact}
          prefillNumber={prefillNumber}
          onDone={() => onOpenChange(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

function ContactFormBody({
  contact,
  prefillNumber,
  onDone,
}: {
  contact: Contact | null;
  prefillNumber?: string;
  onDone: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => fromContact(contact, prefillNumber));
  const [busy, setBusy] = useState(false);
  const save = useContactsStore((s) => s.save);
  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));
  const hasName = form.firstName.trim() || form.lastName.trim() || form.company.trim();

  const submit = async () => {
    setBusy(true);
    const saved = await save({
      id: contact?.id ?? null,
      firstName: form.firstName,
      lastName: form.lastName,
      company: form.company.trim() || null,
      number: form.number,
    });
    setBusy(false);
    if (saved) onDone();
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4"
    >
      <DialogHeader>
        <DialogTitle>{contact ? "Modifier le contact" : "Nouveau contact"}</DialogTitle>
        <DialogDescription>Le numéro peut être un numéro de téléphone, un poste ou une adresse SIP.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-first">Prénom</Label>
          <Input id="c-first" autoFocus value={form.firstName} onChange={set("firstName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-last">Nom</Label>
          <Input id="c-last" value={form.lastName} onChange={set("lastName")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-company">Société (facultatif)</Label>
        <Input id="c-company" value={form.company} onChange={set("company")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-number">Numéro ou adresse SIP</Label>
        <Input
          id="c-number"
          value={form.number}
          onChange={set("number")}
          placeholder="1002 · +33 6 12 34 56 78 · sip:bob@example.com"
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Annuler
        </Button>
        <Button type="submit" disabled={busy || !hasName || !form.number.trim()}>
          Enregistrer
        </Button>
      </DialogFooter>
    </form>
  );
}
