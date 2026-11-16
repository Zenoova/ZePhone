import { toast } from "@yusufceng1z/ding-react";
import { useState } from "react";

import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
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
      <DialogContent
        title={contact ? "Edit contact" : "New contact"}
        description="The number can be a phone number, an extension or a SIP address."
      >
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
    if (!hasName) {
      toast.error("Enter a name or a company for this contact.");
      document.getElementById("c-first")?.focus();
      return;
    }
    if (!form.number.trim()) {
      toast.error("Enter a number, an extension or a SIP address.");
      document.getElementById("c-number")?.focus();
      return;
    }
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="c-first">First name</Label>
          <Input id="c-first" autoFocus value={form.firstName} onChange={set("firstName")} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="c-last">Name</Label>
          <Input id="c-last" value={form.lastName} onChange={set("lastName")} />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-company">Company (optional)</Label>
        <Input id="c-company" value={form.company} onChange={set("company")} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="c-number">Number or SIP address</Label>
        <Input
          id="c-number"
          value={form.number}
          onChange={set("number")}
          placeholder="1002 · +33 6 12 34 56 78 · sip:bob@example.com"
        />
      </div>
      <div className="flex justify-end gap-2 pt-3">
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </div>
    </form>
  );
}
