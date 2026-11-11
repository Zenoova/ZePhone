import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

afterEach(() => cleanup());

// jsdom lacks a few browser APIs that Radix UI and next-themes rely on.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;

window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as typeof window.matchMedia;

Element.prototype.scrollIntoView ??= vi.fn();
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};

// jsdom has no canvas: the voice orb simply draws nothing.
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as typeof HTMLCanvasElement.prototype.getContext;
