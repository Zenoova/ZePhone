/**
 * Dev-only: put the preview (`/?mock=showcase`) in a given state through the address, so that a picture of the application can be
 * taken by a script (the store images, `store-assets/`) without anyone tapping through it. Compiled out of production builds with
 * the mock backend that imports it.
 *
 *   section=dialer|contacts|history|recordings|settings   the page to show
 *   tab=General|Directory|…                               a tab of Settings
 *   scene=incoming|call|stats                             a call, answered or not, with the statistics dialog over it
 *   open=account|contact                                  the accounts list of the top right / the first contact's card
 */
import { type Section, useUiStore } from "@/stores/ui-store";

const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

/** What a user's finger does to a Radix control: the events a click is made of, in order. */
function press(el: Element | null | undefined): void {
  if (!el) return;
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"])
    el.dispatchEvent(
      type.startsWith("pointer")
        ? new PointerEvent(type, { bubbles: true, cancelable: true, button: 0, pointerType: "mouse", isPrimary: true })
        : new MouseEvent(type, { bubbles: true, cancelable: true, button: 0 }),
    );
}

const byText = (selector: string, text: string) =>
  [...document.querySelectorAll(selector)].find((e) => e.textContent?.trim().startsWith(text));

export async function runScene(
  params: URLSearchParams,
  mock: { incoming: () => string },
  answer: (id: string) => Promise<unknown>,
): Promise<void> {
  const section = params.get("section");
  if (section) useUiStore.getState().setSection(section as Section);

  const scene = params.get("scene");
  if (scene === "incoming" || scene === "call" || scene === "stats") {
    await wait(2500);
    const id = mock.incoming();
    if (scene !== "incoming") {
      await wait(800);
      await answer(id);
    }
    if (scene === "stats") {
      await wait(9000); // let the quality statistics fill in
      press(document.querySelector('button[aria-label="Call options"]'));
      await wait(800);
      press(byText('[role="menuitem"]', "Advanced statistics"));
    }
    return;
  }

  await wait(2200);
  const tab = params.get("tab");
  if (tab) {
    const el = byText('[role="tab"]', tab) as HTMLElement | undefined;
    el?.focus();
    press(el);
    await wait(900);
  }
  const open = params.get("open");
  if (open === "account") press(document.querySelector('[data-testid="dock-accounts"]'));
  if (open === "contact") press(document.querySelector('[data-testid="directory-row"]'));
  // The search field of the directory takes the focus: no focus ring (and no keyboard) in a picture.
  (document.activeElement as HTMLElement | null)?.blur?.();
}
