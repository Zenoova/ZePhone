import { useEffect, useState } from "react";

import { Search } from "@/components/icons";
import { Input } from "@/components/ui/input";
import { useDebouncedValue } from "@/hooks/use-debounced-value";
import { PHONE_KIND_LABEL, entrySubtitle, sortedPhones } from "@/lib/directory";
import { errorMessage, telephony } from "@/services/telephony";
import type { DirectoryEntry } from "@/types/directory";

const SHOWN = 6;

type State =
  { status: "loading" } | { status: "error"; message: string } | { status: "ready"; items: DirectoryEntry[] };

/**
 * A small search of the directory, to pick who a call goes to without retyping a number. With nothing typed it shows
 * the favourites. Each number of a person is its own choice, named by what it is: nothing is picked for the user.
 */
export function DirectoryPicker({ onPick }: { onPick: (number: string, who: string, kind: string) => void }) {
  const [text, setText] = useState("");
  const debounced = useDebouncedValue(text, 150);
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    telephony
      .directorySearch({
        text: debounced,
        sourceIds: [],
        groupId: null,
        department: null,
        favoritesOnly: debounced.trim() === "",
        offset: 0,
        limit: SHOWN,
      })
      .then((page) => !cancelled && setState({ status: "ready", items: page.items }))
      .catch((e) => !cancelled && setState({ status: "error", message: errorMessage(e) }));
    return () => {
      cancelled = true;
    };
  }, [debounced]);

  return (
    <section className="space-y-2" aria-label="Chercher dans l'annuaire" data-testid="directory-picker">
      <div className="relative">
        <Search
          className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
          aria-hidden
        />
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Chercher dans l'annuaire : nom, service, numéro…"
          aria-label="Chercher dans l'annuaire"
          autoComplete="off"
          spellCheck={false}
          className="pl-9"
        />
      </div>
      <div className="max-h-52 overflow-y-auto rounded-xl border" aria-live="polite">
        {state.status === "loading" && <p className="text-muted-foreground px-3 py-3 text-sm">Recherche…</p>}
        {state.status === "error" && <p className="text-destructive px-3 py-3 text-sm">{state.message}</p>}
        {state.status === "ready" && state.items.length === 0 && (
          <p className="text-muted-foreground px-3 py-3 text-sm" data-testid="directory-picker-empty">
            {debounced.trim() === "" ? "Aucun favori : tapez un nom ou un numéro." : "Personne ne correspond."}
          </p>
        )}
        {state.status === "ready" && state.items.length > 0 && (
          <ul className="divide-y">
            {state.items.map((e) => (
              <li key={e.id} className="px-3 py-2" data-testid="directory-picker-result">
                <p className="text-sm font-medium">{e.displayName}</p>
                {entrySubtitle(e) && <p className="text-muted-foreground text-xs">{entrySubtitle(e)}</p>}
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {sortedPhones(e.phones).map((p) => {
                    const kind = p.label ?? PHONE_KIND_LABEL[p.kind];
                    return (
                      <button
                        key={`${p.kind}-${p.number}`}
                        type="button"
                        className="hover:bg-accent focus-visible:bg-accent rounded-md border px-2 py-1 text-xs outline-none"
                        onClick={() => onPick(p.number, e.displayName, kind)}
                      >
                        <span className="text-muted-foreground">{kind}</span>{" "}
                        <span className="font-mono">{p.number}</span>
                      </button>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
