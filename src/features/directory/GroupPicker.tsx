import { useState, type ReactNode } from "react";

import { Check, FolderPlus, Plus } from "@/components/icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useDirectoryStore } from "@/stores/directory-store";
import type { DirectoryEntry } from "@/types/directory";

/**
 * Puts one person (or several, from a selection) in the personal groups, or takes them out. A person can be in
 * as many groups as wanted; a group only ever holds references, so deleting it deletes nobody.
 */
export function GroupPicker({
  entries,
  trigger,
  onManage,
}: {
  entries: DirectoryEntry[];
  trigger: ReactNode;
  onManage?: () => void;
}) {
  const groups = useDirectoryStore((s) => s.groups);
  const { addToGroup, removeFromGroup, createGroup } = useDirectoryStore.getState();
  const [name, setName] = useState("");

  const create = async () => {
    const n = name.trim();
    if (!n) return;
    const g = await createGroup(n);
    if (g && (await addToGroup(g.id, entries))) setName("");
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent align="start" className="w-72" data-testid="group-picker">
        <p className="text-muted-foreground px-2 pb-1 text-xs font-medium">
          {entries.length > 1 ? `Ajouter ${entries.length} contacts à…` : "Groupes"}
        </p>
        {groups.length === 0 ? (
          <p className="text-muted-foreground px-2 py-2 text-sm">Aucun groupe pour l'instant : créez le premier.</p>
        ) : (
          <ul className="max-h-56 space-y-0.5 overflow-y-auto">
            {groups.map((g) => {
              const inAll = entries.length > 0 && entries.every((e) => e.groups.includes(g.id));
              return (
                <li key={g.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={inAll}
                    className="hover:bg-accent focus-visible:bg-accent flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm outline-none"
                    onClick={() => void (inAll ? removeFromGroup(g.id, entries) : addToGroup(g.id, entries))}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded border",
                        inAll && "bg-primary border-primary text-primary-foreground",
                      )}
                      aria-hidden
                    >
                      {inAll && <Check className="size-3" />}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{g.name}</span>
                    <span className="text-muted-foreground text-xs">{g.memberCount}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        <form
          className="mt-2 flex gap-1.5 border-t pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Nouveau groupe"
            aria-label="Nom du nouveau groupe"
            maxLength={60}
            className="h-8"
          />
          <Button type="submit" size="sm" variant="secondary" disabled={!name.trim()} aria-label="Créer le groupe">
            <Plus className="size-4" aria-hidden />
          </Button>
        </form>
        {onManage && (
          <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={onManage}>
            <FolderPlus className="size-4" aria-hidden /> Gérer les groupes…
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
