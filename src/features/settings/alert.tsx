import { Info } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/** Small inline notice (info / warning). */
export function Alert({
  children,
  tone = "info",
  className,
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "error";
  className?: string;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "note"}
      className={cn(
        "flex items-start gap-2 rounded-lg border px-3 py-2 text-xs",
        tone === "info" && "bg-muted/60 text-muted-foreground",
        tone === "warning" && "border-warning/40 bg-warning/15",
        tone === "error" && "border-destructive/30 bg-destructive/10 text-destructive",
        className,
      )}
    >
      <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div>{children}</div>
    </div>
  );
}
