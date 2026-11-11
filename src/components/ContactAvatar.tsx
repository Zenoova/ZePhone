import { UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { initials } from "@/lib/format";
import { cn } from "@/lib/utils";

const PALETTE = [
  "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-amber-500/20 text-amber-800 dark:text-amber-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300",
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A bare number or extension has no initials: show a generic person icon instead. */
const isNumeric = (name: string) => /^[\d+*#().\s-]+$/.test(name.trim());

export function ContactAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <Avatar className={cn("size-10", className)}>
      <AvatarFallback className={cn("font-medium", PALETTE[hash(name) % PALETTE.length])}>
        {isNumeric(name) ? <UserRound className="size-[45%]" aria-hidden /> : initials(name)}
      </AvatarFallback>
    </Avatar>
  );
}
