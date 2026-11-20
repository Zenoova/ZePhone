import { thisDevice } from "@/lib/platform";
import { Plug, PlugZap, Plus, Star, Trash2, UserPlus, Pencil } from "@/components/icons";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { EmptyState } from "@/components/EmptyState";
import { AccountAvatar } from "@/components/AccountAvatar";
import { RegistrationBadge } from "@/components/RegistrationBadge";
import { Badge } from "@/components/arc/badge/badge";
import { Button } from "@/components/ui/button";
import { Button as ArcButton } from "@/components/arc/button/button";
import { Switch } from "@/components/ui/switch";
import { TRANSPORT_LABEL } from "@/lib/labels";
import { useAccountsStore } from "@/stores/accounts-store";
import type { AccountStatus, AccountView } from "@/types/telephony";

import { AccountFormDialog } from "../accounts/AccountForm";

function StatusDetail({ status }: { status: AccountStatus | undefined }) {
  if (!status) return null;
  const detail = status.message ?? (status.state === "registered" ? null : status.reason);
  if (!detail && status.sipCode === null) return null;
  return (
    <p className="text-muted-foreground mt-1 text-xs" data-selectable data-testid="status-detail">
      {status.sipCode !== null && status.state === "error" && (
        <span className="bg-destructive/10 text-destructive mr-1.5 rounded px-1.5 py-0.5 font-mono">
          SIP {status.sipCode}
        </span>
      )}
      {detail}
    </p>
  );
}

function AccountCard({
  account,
  onEdit,
  onDelete,
}: {
  account: AccountView;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const status = useAccountsStore((s) => s.statuses[account.id]);
  const { setDefault, setEnabled, connect, disconnect } = useAccountsStore.getState();
  const state = status?.state ?? "disconnected";
  const online = state === "registered" || state === "connecting" || (state === "error" && account.enabled);

  return (
    <li className="bg-card/40 rounded-2xl border p-4" data-testid="account-card">
      <div className="flex items-start gap-3">
        <AccountAvatar
          seed={`${account.username}@${account.domain}`}
          state={account.enabled ? state : "disconnected"}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate font-semibold">{account.label}</h3>
            {account.isDefault && (
              <Badge tone="neutral" icon={<Star className="size-3" aria-hidden />}>
                Default
              </Badge>
            )}
            <RegistrationBadge state={state} />
          </div>
          <p className="text-muted-foreground mt-1 truncate text-sm" data-selectable>
            {account.username}@{account.domain} · {account.server}:{account.port} · {TRANSPORT_LABEL[account.transport]}
          </p>
          <StatusDetail status={status} />
        </div>
        <Switch
          checked={account.enabled}
          onCheckedChange={(v) => void setEnabled(account.id, v)}
          aria-label={account.enabled ? `Disable ${account.label}` : `Enable ${account.label}`}
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {account.enabled && (
          <ArcButton
            size="sm"
            variant="secondary"
            onClick={() => void (online ? disconnect(account.id) : connect(account.id))}
          >
            {online ? <PlugZap className="size-4" aria-hidden /> : <Plug className="size-4" aria-hidden />}
            {online ? "Disconnect" : "Connect"}
          </ArcButton>
        )}
        {!account.isDefault && (
          <ArcButton size="sm" variant="ghost" onClick={() => void setDefault(account.id)}>
            <Star className="size-4" aria-hidden /> Set as default
          </ArcButton>
        )}
        <ArcButton size="sm" variant="ghost" onClick={onEdit}>
          <Pencil className="size-4" aria-hidden /> Edit
        </ArcButton>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive hover:text-destructive ml-auto"
          onClick={onDelete}
        >
          <Trash2 className="size-4" aria-hidden /> Delete
        </Button>
      </div>
    </li>
  );
}

/** The detailed list of the SIP accounts: state, address, and everything that can be done with each one. */
export function AccountsSettings() {
  const accounts = useAccountsStore((s) => s.accounts);
  const remove = useAccountsStore((s) => s.remove);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AccountView | null>(null);
  const [deleting, setDeleting] = useState<AccountView | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">SIP accounts</h2>
          <p className="text-muted-foreground text-sm">Several accounts can be connected at the same time.</p>
        </div>
        <ArcButton
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="size-4" aria-hidden /> Add
        </ArcButton>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={UserPlus}
          title="No SIP account"
          description="Add your server, your username and your password to get started."
        />
      ) : (
        <ul className="space-y-3">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={a}
              onEdit={() => {
                setEditing(a);
                setFormOpen(true);
              }}
              onDelete={() => setDeleting(a)}
            />
          ))}
        </ul>
      )}
      <AccountFormDialog open={formOpen} onOpenChange={setFormOpen} account={editing} />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this account?"
        description={
          deleting
            ? `The account “${deleting.label}” and its password will be deleted from ${thisDevice()}. The call history is kept.`
            : ""
        }
        confirmLabel="Delete"
        onConfirm={() => {
          if (deleting) void remove(deleting.id);
          setDeleting(null);
        }}
      />
    </div>
  );
}
