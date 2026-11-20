import type { ReactNode } from "react";

import { isIos } from "@/lib/platform";

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className={`flex flex-wrap items-center justify-between gap-3 px-6 pt-6 pb-4${isIos() ? " pr-16" : ""}`}>
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-muted-foreground mt-0.5 text-sm">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
