import { AlertCircle, CheckCircle2, CircleDashed, Loader2, PlugZap } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { REGISTRATION_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { RegistrationState } from "@/types/telephony";

const STYLE: Record<RegistrationState, string> = {
  registered: "border-success/30 bg-success/10 text-success",
  connecting: "border-warning/40 bg-warning/15 text-warning-foreground dark:text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  disconnected: "border-border bg-muted text-muted-foreground",
  unconfigured: "border-border bg-muted text-muted-foreground",
};

const ICON: Record<RegistrationState, typeof CheckCircle2> = {
  registered: CheckCircle2,
  connecting: Loader2,
  error: AlertCircle,
  disconnected: PlugZap,
  unconfigured: CircleDashed,
};

export function RegistrationBadge({ state, className }: { state: RegistrationState; className?: string }) {
  const Icon = ICON[state];
  return (
    <Badge variant="outline" className={cn("gap-1.5 font-medium", STYLE[state], className)} data-state={state}>
      <Icon className={cn("size-3", state === "connecting" && "animate-spin")} aria-hidden />
      {REGISTRATION_LABEL[state]}
    </Badge>
  );
}

const DOT: Record<RegistrationState | "none", string> = {
  registered: "bg-success",
  connecting: "bg-warning animate-pulse",
  error: "bg-destructive",
  disconnected: "bg-muted-foreground/50",
  unconfigured: "bg-muted-foreground/50",
  none: "bg-muted-foreground/30",
};

export function StatusDot({ state, className }: { state: RegistrationState | "none"; className?: string }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", DOT[state], className)} />;
}
