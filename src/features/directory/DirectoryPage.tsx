import { useCallback, useEffect, useRef, useState } from "react";

import { Building2, FolderPlus, ListChecks, LoaderCircle, Plus, Search, Star, Users, X } from "@/components/icons";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { VirtualList } from "@/components/VirtualList";
import { Button } from "@/components/arc/button/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { SOURCE_BADGE, failureAction, relativeTime } from "@/lib/directory";
import { cn } from "@/lib/utils";
import { telephony, errorMessage } from "@/services/telephony";
import { useContactsStore } from "@/stores/contacts-store";
import { hasFilters, useDirectoryStore } from "@/stores/directory-store";
import { useUiStore } from "@/stores/ui-store";
import type { Contact } from "@/types/telephony";
import type { DirectoryEntry, SourceView } from "@/types/directory";

import { ContactFormDialog } from "../contacts/ContactForm";
import { Alert } from "../settings/alert";
import { useDirectoryActions } from "./actions";
import { ContactRow, ROW_HEIGHT } from "./ContactRow";
import { ContactSheet } from "./ContactSheet";
import { GroupPicker } from "./GroupPicker";
import { GroupsDialog } from "./GroupsDialog";

const LIST_ID = "directory-list";
const ALL = "all";

/** A local entry as the contact form edits it. */
function toLocalContact(e: DirectoryEntry): Contact {
  return {
    id: e.sources[0]?.externalId ?? "",
    firstName: e.firstName,
    lastName: e.lastName,
    company: e.company,
    number: e.phones[0]?.number ?? "",
    createdAt: "",
    updatedAt: "",
  };
}

function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** A source that has a problem the user can do something about. */
function SourceNotice({ source }: { source: SourceView }) {
  const openSettings = useUiStore((s) => s.openSettings);
  const { action, label } = failureAction(source);
  const kept = source.lastSuccessAt ? ` Les contacts du ${relativeTime(source.lastSuccessAt)} sont conservés.` : "";
  const text =
    source.state === "needsReauth"
      ? `${source.name} : reconnexion nécessaire.${kept}`
      : source.state === "error"
        ? `${source.name} : ${source.lastError ?? "erreur de synchronisation"}${kept}`
        : `${source.name} : la mémoire locale n'est plus à jour (dernière synchronisation ${relativeTime(source.lastSuccessAt)}).`;

  const act = async () => {
    if (action === "retry" || source.state === "idle") {
      try {
        await telephony.directorySync(source.id);
      } catch (e) {
        useDirectoryStore.setState({ error: errorMessage(e) });
      }
    } else openSettings("directory");
  };

  return (
    <Alert
      tone={source.state === "error" || source.state === "needsReauth" ? "warning" : "info"}
      className="items-center"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="source-notice">
        <span>{text}</span>
        <Button size="sm" variant="secondary" onClick={() => void act()}>
          {action === "none" ? "Synchroniser" : label}
        </Button>
      </div>
    </Alert>
  );
}

function SkeletonRows() {
  return (
    <div
      className="space-y-1 px-1"
      aria-busy="true"
      aria-label="Chargement de l'annuaire"
      data-testid="directory-loading"
    >
      {Array.from({ length: 7 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-3 py-2.5">
          <div className="bg-muted size-10 animate-pulse rounded-full" />
          <div className="flex-1 space-y-2">
            <div className="bg-muted h-3.5 w-1/3 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function DirectoryPage() {
  const filters = useDirectoryStore((s) => s.filters);
  const items = useDirectoryStore((s) => s.items);
  const total = useDirectoryStore((s) => s.total);
  const loaded = useDirectoryStore((s) => s.loaded);
  const error = useDirectoryStore((s) => s.error);
  const sources = useDirectoryStore((s) => s.sources);
  const groups = useDirectoryStore((s) => s.groups);
  const departments = useDirectoryStore((s) => s.departments);
  const selecting = useDirectoryStore((s) => s.selecting);
  const selection = useDirectoryStore((s) => s.selection);
  const search = useDirectoryStore((s) => s.search);
  const loadSources = useDirectoryStore((s) => s.loadSources);
  const sourcesLoaded = useDirectoryStore((s) => s.sourcesLoaded);
  const openSettings = useUiStore((s) => s.openSettings);
  const actions = useDirectoryActions();

  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState<number | null>(null);
  const [opened, setOpened] = useState<DirectoryEntry | null>(null);
  const [groupsOpen, setGroupsOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<DirectoryEntry | null>(null);

  const debounced = useDebouncedValue(filters.text, 120);
  useEffect(() => {
    void search();
  }, [debounced, filters.sourceIds, filters.groupId, filters.department, filters.favoritesOnly, search]);

  useEffect(() => {
    if (!sourcesLoaded) void loadSources();
  }, [sourcesLoaded, loadSources]);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  // "/" jumps to the search from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !e.metaKey && !e.ctrlKey && !e.altKey && !isTypingTarget(e.target)) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const change = (patch: Parameters<ReturnType<typeof useDirectoryStore.getState>["setFilters"]>[0]) => {
    useDirectoryStore.getState().setFilters(patch);
    setActive(null);
  };

  const activeIndex = active !== null && active < items.length ? active : null;
  const live = opened ? (items.find((i) => i.id === opened.id) ?? opened) : null;
  const filtered = hasFilters(filters);
  const externalSources = sources.filter((s) => s.kind !== "local");
  const connected = externalSources.some((s) => s.enabled);
  const syncing = sources.filter((s) => s.state === "syncing");
  const troubled = sources.filter((s) => s.enabled && (s.state === "error" || s.state === "needsReauth" || s.stale));
  const selectedEntries = items.filter((i) => selection.includes(i.id));

  const move = (to: number) => {
    if (items.length === 0) return;
    const clamped = Math.max(0, Math.min(items.length - 1, to));
    setActive(clamped);
    if (clamped >= items.length - 5) void useDirectoryStore.getState().loadMore();
  };

  const callPrimary = (e: DirectoryEntry) => {
    // One number: call it. Several: the user has to choose, in the contact sheet.
    if (e.phones.length === 1 && e.phones[0]) void actions.call(e.phones[0].number);
    else setOpened(e);
  };

  const onListKey = (ev: React.KeyboardEvent) => {
    const here = activeIndex ?? -1;
    const entry = activeIndex !== null ? items[activeIndex] : undefined;
    switch (ev.key) {
      case "ArrowDown":
        move(here + 1);
        break;
      case "ArrowUp":
        move(here <= 0 ? 0 : here - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(items.length - 1);
        break;
      case "PageDown":
        move(here + 8);
        break;
      case "PageUp":
        move(here - 8);
        break;
      case "Enter":
        if (!entry) return;
        if (ev.metaKey || ev.ctrlKey) callPrimary(entry);
        else if (selecting) useDirectoryStore.getState().toggleSelected(entry.id);
        else setOpened(entry);
        break;
      case " ":
        if (!entry || !selecting) return;
        useDirectoryStore.getState().toggleSelected(entry.id);
        break;
      case "f":
      case "F":
        if (!entry || ev.metaKey || ev.ctrlKey) return;
        void useDirectoryStore.getState().toggleFavorite(entry);
        break;
      case "Escape":
        searchRef.current?.focus();
        break;
      default:
        return;
    }
    ev.preventDefault();
  };

  const onSearchKey = (ev: React.KeyboardEvent) => {
    if (ev.key === "ArrowDown" && items.length > 0) {
      ev.preventDefault();
      setActive(0);
      listRef.current?.focus();
    } else if (ev.key === "Enter" && items[0]) {
      ev.preventDefault();
      setOpened(items[0]);
    } else if (ev.key === "Escape") {
      if (filters.text) change({ text: "" });
      else searchRef.current?.blur();
    }
  };

  const onRange = useCallback((_start: number, end: number) => {
    const s = useDirectoryStore.getState();
    if (end >= s.items.length - 20 && s.items.length < s.total) void s.loadMore();
  }, []);

  const empty = (() => {
    if (error && items.length === 0) {
      return (
        <EmptyState
          icon={Search}
          title="La recherche a échoué"
          description={error}
          action={
            <Button variant="secondary" onClick={() => void search()}>
              Réessayer
            </Button>
          }
        />
      );
    }
    if (filtered) {
      return (
        <EmptyState
          icon={Search}
          title="Aucun résultat"
          description="Personne ne correspond à cette recherche. Essayez un autre nom, un numéro ou retirez un filtre."
          action={
            <Button variant="secondary" onClick={() => useDirectoryStore.getState().resetFilters()}>
              Effacer la recherche et les filtres
            </Button>
          }
        />
      );
    }
    if (syncing.length > 0) {
      return (
        <EmptyState
          icon={Building2}
          title="Synchronisation en cours…"
          description="Les contacts apparaissent dès que la première lecture est terminée."
        />
      );
    }
    return (
      <EmptyState
        icon={Users}
        title="L'annuaire est vide"
        description={
          connected
            ? "Les sources connectées ne contiennent encore aucun contact joignable."
            : "Ajoutez un contact local, ou connectez l'annuaire de votre entreprise (LDAP, Microsoft 365) pour retrouver vos collègues en quelques secondes."
        }
        action={
          <div className="flex gap-2">
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> Nouveau contact
            </Button>
            <Button variant="secondary" onClick={() => openSettings("directory")}>
              Connecter un annuaire
            </Button>
          </div>
        }
      />
    );
  })();

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title="Annuaire"
        description="Retrouvez un collègue ou un client, puis appelez-le ou transférez-lui un appel"
        actions={
          <>
            <Button variant="ghost" onClick={() => setGroupsOpen(true)}>
              <FolderPlus className="size-4" aria-hidden /> Groupes
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" aria-hidden /> Nouveau contact
            </Button>
          </>
        }
      />

      <div className="space-y-2.5 px-6 pb-3">
        <div className="relative">
          <Search
            className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
            aria-hidden
          />
          <Input
            ref={searchRef}
            value={filters.text}
            onChange={(e) => change({ text: e.target.value })}
            onKeyDown={onSearchKey}
            placeholder="Nom, prénom, entreprise, service, e-mail ou numéro…"
            aria-label="Rechercher dans l'annuaire"
            aria-controls={LIST_ID}
            autoComplete="off"
            spellCheck={false}
            className="pr-9 pl-9"
          />
          {filters.text && (
            <button
              type="button"
              aria-label="Effacer la recherche"
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2.5 -translate-y-1/2"
              onClick={() => {
                change({ text: "" });
                searchRef.current?.focus();
              }}
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtres">
          <Button
            size="sm"
            variant={filters.favoritesOnly ? "secondary" : "ghost"}
            aria-pressed={filters.favoritesOnly}
            onClick={() => change({ favoritesOnly: !filters.favoritesOnly })}
          >
            <Star className={cn("size-4", filters.favoritesOnly && "text-warning fill-current")} aria-hidden /> Favoris
          </Button>
          {sources.length > 1 &&
            sources.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={filters.sourceIds.includes(s.id) ? "secondary" : "ghost"}
                aria-pressed={filters.sourceIds.includes(s.id)}
                title={`${SOURCE_BADGE[s.kind]} · ${s.contactCount} contact${s.contactCount > 1 ? "s" : ""}`}
                onClick={() => change({ sourceIds: filters.sourceIds.includes(s.id) ? [] : [s.id] })}
              >
                {s.name}
              </Button>
            ))}
          {groups.length > 0 && (
            <Select value={filters.groupId ?? ALL} onValueChange={(v) => change({ groupId: v === ALL ? null : v })}>
              <SelectTrigger aria-label="Filtrer par groupe" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous mes groupes</SelectItem>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name} ({g.memberCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {departments.length > 0 && (
            <Select
              value={filters.department ?? ALL}
              onValueChange={(v) => change({ department: v === ALL ? null : v })}
            >
              <SelectTrigger aria-label="Filtrer par service" className="h-8 w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tous les services</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.name} value={d.name}>
                    {d.name} ({d.count})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            size="sm"
            variant={selecting ? "secondary" : "ghost"}
            aria-pressed={selecting}
            className="ml-auto"
            onClick={() => useDirectoryStore.getState().setSelecting(!selecting)}
          >
            <ListChecks className="size-4" aria-hidden /> Sélectionner
          </Button>
        </div>

        {troubled.map((s) => (
          <SourceNotice key={s.id} source={s} />
        ))}

        <div className="text-muted-foreground flex min-h-5 items-center gap-3 text-xs" aria-live="polite">
          {loaded && total > 0 && (
            <span data-testid="directory-count">
              {total} contact{total > 1 ? "s" : ""}
              {filtered ? " trouvé" + (total > 1 ? "s" : "") : ""}
            </span>
          )}
          {syncing.length > 0 && (
            <span className="flex items-center gap-1.5" data-testid="directory-syncing">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden /> Synchronisation de{" "}
              {syncing.map((s) => s.name).join(", ")}…
            </span>
          )}
        </div>

        {selecting && (
          <div
            className="bg-muted/60 flex flex-wrap items-center gap-2 rounded-xl px-3 py-2 text-sm"
            data-testid="selection-bar"
          >
            <span>
              {selection.length} sélectionné{selection.length > 1 ? "s" : ""}
            </span>
            <GroupPicker
              entries={selectedEntries}
              onManage={() => setGroupsOpen(true)}
              trigger={
                <Button size="sm" variant="secondary" disabled={selection.length === 0}>
                  Ajouter au groupe…
                </Button>
              }
            />
            {filters.groupId && (
              <Button
                size="sm"
                variant="ghost"
                disabled={selection.length === 0}
                onClick={() => {
                  void useDirectoryStore.getState().removeFromGroup(filters.groupId!, selectedEntries);
                  useDirectoryStore.getState().clearSelection();
                }}
              >
                Retirer de ce groupe
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                items.forEach((i) => !selection.includes(i.id) && useDirectoryStore.getState().toggleSelected(i.id))
              }
            >
              Tout sélectionner ({items.length})
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => useDirectoryStore.getState().setSelecting(false)}
            >
              Terminer
            </Button>
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 px-3 pb-24">
        {!loaded ? (
          <SkeletonRows />
        ) : total === 0 ? (
          empty
        ) : (
          <VirtualList
            ref={listRef}
            id={LIST_ID}
            label="Résultats de l'annuaire"
            count={total}
            rowHeight={ROW_HEIGHT}
            activeIndex={activeIndex}
            onRange={onRange}
            onKeyDown={onListKey}
            className="h-full"
            renderRow={(i) => {
              const entry = items[i];
              if (!entry) {
                return (
                  <div className="flex h-full items-center gap-3 px-3" aria-hidden>
                    <div className="bg-muted size-10 animate-pulse rounded-full" />
                    <div className="bg-muted h-3.5 w-1/3 animate-pulse rounded" />
                  </div>
                );
              }
              return (
                <ContactRow
                  entry={entry}
                  active={i === activeIndex}
                  selecting={selecting}
                  selected={selection.includes(entry.id)}
                  onOpen={(e) => {
                    setActive(i);
                    setOpened(e);
                  }}
                  onToggleSelected={(id) => useDirectoryStore.getState().toggleSelected(id)}
                  onToggleFavorite={(e) => void useDirectoryStore.getState().toggleFavorite(e)}
                  onCall={(n) => void actions.call(n)}
                />
              );
            }}
          />
        )}
      </div>

      <ContactSheet
        entry={live}
        onClose={() => {
          setOpened(null);
          // back to the list, where the keyboard was
          requestAnimationFrame(() => listRef.current?.focus() ?? searchRef.current?.focus());
        }}
        onEdit={(e) => {
          setOpened(null);
          setEditing(toLocalContact(e));
          setFormOpen(true);
        }}
        onDelete={(e) => {
          setOpened(null);
          setDeleting(e);
        }}
        onManageGroups={() => setGroupsOpen(true)}
      />
      <GroupsDialog open={groupsOpen} onOpenChange={setGroupsOpen} />
      <ContactFormDialog open={formOpen} onOpenChange={setFormOpen} contact={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Supprimer ce contact ?"
        description={deleting ? `« ${deleting.displayName} » sera définitivement supprimé de vos contacts locaux.` : ""}
        confirmLabel="Supprimer"
        onConfirm={() => {
          const id = deleting?.sources[0]?.externalId;
          if (id) void useContactsStore.getState().remove(id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
