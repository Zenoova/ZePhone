import { toast } from "@yusufceng1z/ding-react";
import { useState } from "react";

import { Building2, Folder, Pencil, Plus, Trash2 } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Button as IconButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useDirectoryStore } from "@/stores/directory-store";
import type { GroupView } from "@/types/directory";

/** Creating, renaming and deleting the user's own groups. The company's departments are shown, read-only. */
export function GroupsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const groups = useDirectoryStore((s) => s.groups);
  const departments = useDirectoryStore((s) => s.departments);
  const { createGroup, renameGroup, deleteGroup } = useDirectoryStore.getState();
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<GroupView | null>(null);

  const create = async () => {
    if (!name.trim()) {
      toast.error("Enter a name for the group.");
      return;
    }
    if (await createGroup(name)) setName("");
  };

  const saveRename = async () => {
    if (!editing) return;
    if (await renameGroup(editing.id, editing.name)) setEditing(null);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          title="My groups"
          description="Personal lists to find the same people quickly. A contact can be in several groups; deleting a group deletes no contact."
        >
          <div className="space-y-4" data-testid="groups-dialog">
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void create();
              }}
            >
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Name of the new group"
                aria-label="Name of the new group"
                maxLength={60}
              />
              <Button type="submit">
                <Plus className="size-4" aria-hidden /> Create
              </Button>
            </form>

            {groups.length === 0 ? (
              <p className="text-muted-foreground text-sm">You don't have any group yet.</p>
            ) : (
              <ul className="divide-y rounded-xl border">
                {groups.map((g) => (
                  <li key={g.id} className="flex items-center gap-2 px-3 py-2" data-testid="group-row">
                    <Folder className="text-muted-foreground size-4 shrink-0" aria-hidden />
                    {editing?.id === g.id ? (
                      <form
                        className="flex min-w-0 flex-1 gap-2"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveRename();
                        }}
                      >
                        <Input
                          autoFocus
                          value={editing.name}
                          onChange={(e) => setEditing({ id: g.id, name: e.target.value })}
                          aria-label={`New name for the group ${g.name}`}
                          maxLength={60}
                          className="h-8"
                        />
                        <Button type="submit" size="sm">
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(null)}>
                          Cancel
                        </Button>
                      </form>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1 truncate font-medium">{g.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {g.memberCount} contact{g.memberCount > 1 ? "s" : ""}
                        </span>
                        <IconButton
                          variant="ghost"
                          size="icon"
                          aria-label={`Rename ${g.name}`}
                          onClick={() => setEditing({ id: g.id, name: g.name })}
                        >
                          <Pencil className="size-4" />
                        </IconButton>
                        <IconButton
                          variant="ghost"
                          size="icon"
                          aria-label={`Delete ${g.name}`}
                          onClick={() => setDeleting(g)}
                        >
                          <Trash2 className="text-destructive size-4" />
                        </IconButton>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {departments.length > 0 && (
              <div className="bg-muted/50 rounded-xl p-3 text-xs">
                <p className="flex items-center gap-1.5 font-medium">
                  <Building2 className="size-3.5" aria-hidden /> Company departments
                </p>
                <p className="text-muted-foreground mt-1">
                  {departments.map((d) => d.name).join(" · ")}. They come from the directory and serve as a filter: they
                  can't be edited here.
                </p>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this group?"
        description={
          deleting
            ? `The group “${deleting.name}” will be deleted. Its ${deleting.memberCount} contact${deleting.memberCount > 1 ? "s" : ""} are not deleted: they stay in the directory.`
            : ""
        }
        confirmLabel="Delete the group"
        onConfirm={() => {
          if (deleting) void deleteGroup(deleting.id);
          setDeleting(null);
        }}
      />
    </>
  );
}
