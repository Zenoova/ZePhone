import { type AppIcon, CircleAlert, CircleCheck, CircleDashed, LoaderCircle, PlugZap } from "@/components/icons";

import { Badge, type BadgeTone } from "@/components/arc/badge/badge";
import { REGISTRATION_LABEL } from "@/lib/labels";
import { cn } from "@/lib/utils";
import type { RegistrationState } from "@/types/telephony";

const TONE: Record<RegistrationState, BadgeTone> = {
  registered: "success",
  connecting: "warning",
  error: "danger",
  disconnected: "neutral",
  unconfigured: "neutral",
};

const ICON: Record<RegistrationState, AppIcon> = {
  registered: CircleCheck,
  connecting: LoaderCircle,
  error: CircleAlert,
  disconnected: PlugZap,
  unconfigured: CircleDashed,
};

export function RegistrationBadge({ state, className }: { state: RegistrationState; className?: string }) {
  const Icon = ICON[state];
  return (
    <Badge
      tone={TONE[state]}
      outline
      icon={<Icon className={cn("size-3", state === "connecting" && "animate-spin")} aria-hidden />}
      className={className}
      data-state={state}
    >
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
