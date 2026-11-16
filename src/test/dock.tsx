import type { ReactNode } from "react";

import { Dock } from "@/components/ui/dock";

/** Dock items must live in a dock: tests render them inside one. */
export function DockProviderForTests({ children }: { children: ReactNode }) {
  return <Dock>{children}</Dock>;
}
