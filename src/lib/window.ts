/** Label of the Tauri window this page runs in (`main`, `call`); `undefined` in a plain browser. */
function windowLabel(): string | undefined {
  const internals = (
    window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }
  ).__TAURI_INTERNALS__;
  return internals?.metadata?.currentWindow?.label;
}

/**
 * Whether this page is the call window. The backend opens the same page in a window labelled `call`; the
 * `?window=call` query does the same in the browser preview (`npm run dev`, `/?mock&window=call`).
 */
export function isCallWindow(): boolean {
  return windowLabel() === "call" || new URLSearchParams(window.location.search).get("window") === "call";
}
