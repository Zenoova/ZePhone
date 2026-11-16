import { toast } from "@yusufceng1z/ding-react";
import { useState } from "react";

import { Button } from "@/components/arc/button/button";
import DropdownMenu from "@/components/arc/dropdown-menu/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/arc/popover/popover";
import { AppWindow, ChartLine, Copy, Menu, Pin, ScrollText, Info, Volume2 } from "@/components/icons";
import { VolumeSliders } from "@/components/VolumeSliders";
import { telephony } from "@/services/telephony";
import type { Call } from "@/types/telephony";

import { AudioDevicePicker } from "./AudioDevicePicker";
import { CallInfoDialog } from "./CallInfoDialog";
import { EngineLogDialog } from "./EngineLogDialog";
import { CallStatsDialog } from "./stats/CallStatsDialog";

/**
 * Top right of the call: the volumes, and the menu of options — the developer ones (call details, advanced
 * statistics, engine log, call id) and a few others (keep the window on top, bring up the main window).
 */
export function CallToolbar({ call }: { call: Call }) {
  const [infoOpen, setInfoOpen] = useState(false);
  const [logOpen, setLogOpen] = useState(false);
  const [statsOpen, setStatsOpen] = useState(false);
  const [onTop, setOnTop] = useState(false);

  const copyId = async () => {
    try {
      await navigator.clipboard.writeText(call.id);
      toast.success("Call ID copied", { description: call.id });
    } catch {
      toast.error("Cannot copy the identifier");
    }
  };

  const toggleOnTop = () => {
    const next = !onTop;
    setOnTop(next);
    void telephony.setCallWindowOnTop(next);
  };

  return (
    <div className="absolute top-3 right-3 z-20 flex items-center gap-1" data-testid="call-toolbar">
      <AudioDevicePicker call={call} />

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" aria-label="Sound volume" title="Sound volume">
            <Volume2 className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72">
          <VolumeSliders />
        </PopoverContent>
      </Popover>

      <DropdownMenu
        label="Options"
        trigger={
          <Button variant="ghost" size="sm" aria-label="Call options" title="Call options">
            <Menu className="size-4" />
          </Button>
        }
        items={[
          {
            label: onTop ? "Stop keeping on top" : "Keep on top",
            icon: <Pin className="size-4" />,
            onSelect: toggleOnTop,
          },
          {
            label: "Open ZePhone",
            icon: <AppWindow className="size-4" />,
            onSelect: () => void telephony.showMain(),
          },
          {
            label: "Call information",
            icon: <Info className="size-4" />,
            onSelect: () => setInfoOpen(true),
            separatorBefore: true,
          },
          {
            label: "Advanced statistics",
            icon: <ChartLine className="size-4" />,
            onSelect: () => setStatsOpen(true),
          },
          { label: "SIP engine log", icon: <ScrollText className="size-4" />, onSelect: () => setLogOpen(true) },
          {
            label: "Copy the call identifier",
            icon: <Copy className="size-4" />,
            onSelect: () => void copyId(),
          },
        ]}
      />

      <CallInfoDialog call={call} open={infoOpen} onOpenChange={setInfoOpen} />
      <CallStatsDialog call={call} open={statsOpen} onOpenChange={setStatsOpen} />
      <EngineLogDialog open={logOpen} onOpenChange={setLogOpen} />
    </div>
  );
}
