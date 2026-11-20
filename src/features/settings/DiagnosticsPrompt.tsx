import { Button } from "@/components/arc/button/button";
import { Dialog, DialogContent } from "@/components/arc/dialog/dialog";
import { Switch } from "@/components/ui/switch";
import { useSettingsStore } from "@/stores/settings-store";
import { useState } from "react";

/**
 * Shown once, at the first launch, before anything is sent. Both are on unless turned off here; closing the window
 * keeps what the switches show. It can be changed at any time in Settings > General.
 */
export function DiagnosticsPrompt() {
  const loaded = useSettingsStore((s) => s.loaded);
  const answered = useSettingsStore((s) => s.settings.privacy.answered);
  const update = useSettingsStore((s) => s.update);
  const [crashReports, setCrashReports] = useState(true);
  const [usageStats, setUsageStats] = useState(true);

  const answer = (privacy: { crashReports: boolean; usageStats: boolean }) =>
    void update({ privacy: { ...privacy, answered: true } });

  return (
    <Dialog open={loaded && !answered} onOpenChange={(open) => !open && answer({ crashReports, usageStats })}>
      <DialogContent
        title="Help improve ZePhone"
        description="ZePhone sends crash reports and anonymous usage statistics. They never include phone numbers, SIP addresses, names, passwords or anything said in a call. Turn them off here or later in Settings."
      >
        <div className="space-y-4">
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Send crash reports</span>
              <span className="text-muted-foreground block text-xs">So that crashes can be fixed</span>
            </span>
            <Switch checked={crashReports} onCheckedChange={setCrashReports} aria-label="Send crash reports" />
          </label>
          <label className="flex items-center justify-between gap-4 text-sm">
            <span>
              <span className="font-medium">Share anonymous usage statistics</span>
              <span className="text-muted-foreground block text-xs">
                That ZePhone was opened, and that an account or a call was made
              </span>
            </span>
            <Switch
              checked={usageStats}
              onCheckedChange={setUsageStats}
              aria-label="Share anonymous usage statistics"
            />
          </label>
          <div className="flex justify-end">
            <Button type="button" onClick={() => answer({ crashReports, usageStats })}>
              Continue
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
