import { Pencil, Phone, Plus, Search, Trash2, Users } from "@/components/icons";
import { useEffect, useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ContactAvatar } from "@/components/ContactAvatar";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { contactName } from "@/lib/contacts";
import { useCallsStore } from "@/stores/calls-store";
import { useContactsStore } from "@/stores/contacts-store";
import { useUiStore } from "@/stores/ui-store";
import type { Contact } from "@/types/telephony";

import { ContactFormDialog } from "./ContactForm";

export function ContactsPage() {
  const contacts = useContactsStore((s) => s.contacts);
  const loaded = useContactsStore((s) => s.loaded);
  const query = useContactsStore((s) => s.query);
  const setQuery = useContactsStore((s) => s.setQuery);
  const load = useContactsStore((s) => s.load);
  const remove = useContactsStore((s) => s.remove);
  const dial = useCallsStore((s) => s.dial);
  const setSection = useUiStore((s) => s.setSection);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const debounced = useDebouncedValue(query, 150);

  useEffect(() => {
    void load(debounced);
  }, [debounced, load]);

  const call = async (c: Contact) => {
    const started = await dial(c.number);
    if (started) setSection("dialer");
  };

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Contacts"
        description="Votre carnet d'adresses local"
        actions={
          <Button
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Nouveau
          </Button>
        }
      />
      <div className="px-6 pb-3">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Rechercher un nom, une société, un numéro…"
            aria-label="Rechercher un contact"
            className="pl-9"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-6">
        {loaded && contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query ? "Aucun résultat" : "Aucun contact"}
            description={
              query
                ? "Aucun contact ne correspond à cette recherche."
                : "Ajoutez vos correspondants pour les appeler en un clic."
            }
          />
        ) : (
          <ul className="space-y-1">
            {contacts.map((c) => (
              <li key={c.id} className="hover:bg-accent/60 group flex items-center gap-3 rounded-xl px-3 py-2.5">
                <ContactAvatar name={contactName(c)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{contactName(c)}</p>
                  <p className="text-muted-foreground truncate text-sm">
                    {c.company && c.firstName + c.lastName ? `${c.company} · ` : ""}
                    <span data-selectable>{c.number}</span>
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="icon"
                    className="bg-success text-success-foreground hover:bg-success/90 rounded-full"
                    aria-label={`Appeler ${contactName(c)}`}
                    onClick={() => void call(c)}
                  >
                    <Phone className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Modifier ${contactName(c)}`}
                    onClick={() => {
                      setEditing(c);
                      setFormOpen(true);
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Supprimer ${contactName(c)}`}
                    onClick={() => setDeleting(c)}
                  >
                    <Trash2 className="text-destructive size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Supprimer ce contact ?"
        description={
          deleting ? `« ${contactName(deleting)} » sera définitivement supprimé de votre carnet d'adresses.` : ""
        }
        confirmLabel="Supprimer"
        onConfirm={() => {
          if (deleting) void remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
