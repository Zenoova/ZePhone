import { Toaster } from "@/components/Toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CallWindow } from "@/features/calls/CallWindow";
import { useTelephonyBootstrap } from "@/hooks/use-telephony-bootstrap";

import { ThemeSync, TranslucencySync } from "./AppSync";

/** The root of the call window: the same stores as the main window, fed by the same backend events. */
export default function CallWindowApp() {
  useTelephonyBootstrap();
  return (
    <TooltipProvider delayDuration={300}>
      <ThemeSync />
      <TranslucencySync />
      <CallWindow />
      <Toaster />
    </TooltipProvider>
  );
}
