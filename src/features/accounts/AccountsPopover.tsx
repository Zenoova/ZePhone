import { useState } from "react";

import { AccountAvatar } from "@/components/AccountAvatar";
import { Button } from "@/components/arc/button/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { Plus, UserRound } from "@/components/icons";
import { DockIcon, DockItem, DockLabel } from "@/components/ui/dock";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { summarizeRegistration, useAccountsStore } from "@/stores/accounts-store";
import { availability } from "@/lib/availability";
import type { AccountView } from "@/types/telephony";

import { AccountFormDialog } from "./AccountForm";

function AccountRow({ account }: { account: AccountView }) {
  const status = useAccountsStore((s) => s.statuses[account.id]);
  const setEnabled = useAccountsStore((s) => s.setEnabled);
  return (
    <li
      className="flex items-center gap-3 rounded-xl px-2 py-1.5"
      data-testid="account-row"
      data-enabled={account.enabled}
    >
      {/* A disabled account is greyed out, but its switch stays as it is so it can be turned back on. */}
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-3 transition-opacity",
          !account.enabled && "opacity-45 grayscale",
        )}
      >
        <AccountAvatar
          seed={`${account.username}@${account.domain}`}
          size={34}
          state={account.enabled ? (status?.state ?? "disconnected") : undefined}
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{account.label}</p>
          <p className="text-muted-foreground truncate text-xs" data-testid="account-availability">
            {availability(account, status)}
          </p>
        </div>
      </div>
      <Switch
        checked={account.enabled}
        onCheckedChange={(v) => void setEnabled(account.id, v)}
        aria-label={account.enabled ? `Désactiver ${account.label}` : `Activer ${account.label}`}
      />
    </li>
  );
}

/**
 * The SIP accounts in the dock: the icon is the face of the account that is connected now (or the default one
 * when none is), and it opens a short list — face, name, availability, a switch — with a button to add one.
 * The detailed list stays in the settings.
 */
export function AccountsDockItem() {
  const accounts = useAccountsStore((s) => s.accounts);
  const statuses = useAccountsStore((s) => s.statuses);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const current = summarizeRegistration(accounts, statuses);
  const account = current.account;

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <DockItem
            fixed
            aria-label="Comptes SIP"
            data-testid="dock-accounts"
            className="bg-transparent p-0 hover:bg-transparent"
          >
            {account ? (
              <AccountAvatar
                seed={`${account.username}@${account.domain}`}
                size={40}
                state={account.enabled && current.state !== "none" ? current.state : undefined}
              />
            ) : (
              <DockIcon>
                <UserRound className="size-1/2" />
              </DockIcon>
            )}
            <DockLabel className="in-data-[state=open]:hidden">
              {account ? `${account.label} · ${availability(account, current.status)}` : "Comptes SIP"}
            </DockLabel>
          </DockItem>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          sideOffset={16}
          collisionPadding={8}
          className="w-80"
          data-testid="accounts-popover"
        >
          {accounts.length > 0 ? (
            <ul className="mb-2 max-h-72 space-y-0.5 overflow-y-auto" aria-label="Comptes SIP">
              {accounts.map((a) => (
                <AccountRow key={a.id} account={a} />
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground px-2 py-3 text-sm">Aucun compte SIP pour l'instant.</p>
          )}
          <Button
            variant="secondary"
            className="w-full"
            onClick={() => {
              setOpen(false);
              setAdding(true);
            }}
          >
            <Plus className="size-4" aria-hidden /> Ajouter un compte SIP
          </Button>
        </PopoverContent>
      </Popover>
      <AccountFormDialog open={adding} onOpenChange={setAdding} account={null} />
    </>
  );
}
