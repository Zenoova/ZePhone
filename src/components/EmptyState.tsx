import type { AppIcon } from "@/components/icons";
import type { ReactNode } from "react";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: AppIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <div className="bg-muted text-muted-foreground flex size-12 items-center justify-center rounded-full">
        <Icon className="size-6" aria-hidden />
      </div>
      <div>
        <p className="font-medium">{title}</p>
        {description && <p className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</p>}
      </div>
      {action}
    </div>
  );
}
