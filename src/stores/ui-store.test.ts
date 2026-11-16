import { beforeEach, describe, expect, it } from "vitest";

import { useUiStore } from "./ui-store";

beforeEach(() => useUiStore.setState({ section: "settings", focusRequest: null }));

describe("bringing the window forward on a page", () => {
  it("opens the dialer, or the contacts search, and remembers what was asked until the page took it", () => {
    useUiStore.getState().requestFocus("dialer");
    expect(useUiStore.getState()).toMatchObject({ section: "dialer", focusRequest: "dialer" });
    useUiStore.getState().requestFocus("search");
    expect(useUiStore.getState()).toMatchObject({ section: "contacts", focusRequest: "search" });
    useUiStore.getState().clearFocusRequest();
    expect(useUiStore.getState().focusRequest).toBeNull();
  });
});
