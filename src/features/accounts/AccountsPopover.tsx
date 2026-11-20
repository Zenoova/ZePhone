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
        aria-label={account.enabled ? `Disable ${account.label}` : `Enable ${account.label}`}
      />
    </li>
  );
}

/** The short list of accounts, with the button that adds one. */
function AccountsPanel({ accounts, onAdd }: { accounts: AccountView[]; onAdd: () => void }) {
  return (
    <>
      {accounts.length > 0 ? (
        <ul className="mb-2 max-h-72 space-y-0.5 overflow-y-auto" aria-label="SIP accounts">
          {accounts.map((a) => (
            <AccountRow key={a.id} account={a} />
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground px-2 py-3 text-sm">No SIP account yet.</p>
      )}
      <Button variant="secondary" className="w-full" onClick={onAdd}>
        <Plus className="size-4" aria-hidden /> Add a SIP account
      </Button>
    </>
  );
}

/**
 * The SIP accounts at the top of the page, where an iPhone or an iPad has no dock for them: the face of the account that
 * is connected now (or the default one) opens the same short list as the dock's item.
 */
export function AccountsButton({ className }: { className?: string }) {
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
          <button
            type="button"
            aria-label={
              account ? `SIP accounts: ${account.label}, ${availability(account, current.status)}` : "SIP accounts"
            }
            data-testid="account-button"
            className={cn("flex size-11 items-center justify-center rounded-full", className)}
          >
            {account ? (
              <AccountAvatar
                seed={`${account.username}@${account.domain}`}
                size={36}
                state={account.enabled && current.state !== "none" ? current.state : undefined}
              />
            ) : (
              <UserRound className="size-6" aria-hidden />
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="bottom"
          align="end"
          sideOffset={8}
          collisionPadding={8}
          className="w-80"
          data-testid="accounts-popover"
        >
          <AccountsPanel
            accounts={accounts}
            onAdd={() => {
              setOpen(false);
              setAdding(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <AccountFormDialog open={adding} onOpenChange={setAdding} account={null} />
    </>
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
            aria-label="SIP accounts"
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
              {account ? `${account.label} · ${availability(account, current.status)}` : "SIP accounts"}
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
          <AccountsPanel
            accounts={accounts}
            onAdd={() => {
              setOpen(false);
              setAdding(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <AccountFormDialog open={adding} onOpenChange={setAdding} account={null} />
    </>
  );
}
