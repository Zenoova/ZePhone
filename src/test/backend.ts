import type { vi } from "vitest";

type Handler = (args: Record<string, unknown> | undefined) => unknown;

/**
 * A scripted backend for component tests: `invoke` answers from a table of command handlers, and every call is
 * recorded. A command with no handler answers `undefined`.
 */
export function makeBackend(invoke: ReturnType<typeof vi.fn>, handlers: Record<string, Handler> = {}) {
  const table: Record<string, Handler> = { ...handlers };
  invoke.mockImplementation(async (cmd: string, args?: Record<string, unknown>) => {
    const h = table[cmd];
    if (!h) return undefined;
    return h(args);
  });
  return {
    handle: (cmd: string, h: Handler) => void (table[cmd] = h),
    calls: (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd).map((c) => c[1] as Record<string, unknown>),
  };
}
