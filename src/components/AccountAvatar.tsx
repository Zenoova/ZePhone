import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";

import { StatusDot } from "@/components/RegistrationBadge";
import { cn } from "@/lib/utils";
import type { RegistrationState } from "@/types/telephony";

/**
 * The little face of a SIP account: a [blobatar](https://blobatar.dev) drawn locally from the account's address, so the
 * same account always has the same face (the address never leaves the app). Its eyes move when the pointer is over it;
 * a dot at the corner tells whether the account is connected.
 */
export function AccountAvatar({
  seed,
  state,
  size = 40,
  className,
}: {
  /** What the face is drawn from: the account's address. */
  seed: string;
  state?: RegistrationState;
  size?: number;
  className?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex shrink-0", className)}
      style={{ width: size, height: size }}
      data-testid="account-avatar"
    >
      <Blobatar name={seed} size={size} animate="hover" />
      {state && <StatusDot state={state} className="ring-background absolute -right-0.5 -bottom-0.5 size-3 ring-2" />}
    </span>
  );
}
