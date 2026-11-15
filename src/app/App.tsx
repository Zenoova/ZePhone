import { useTelephonyBootstrap } from "@/hooks/use-telephony-bootstrap";
import { AppShell } from "@/layouts/AppShell";
import { ThemeSync, TranslucencySync } from "./AppSync";
import { useUiStore } from "@/stores/ui-store";

function BackendUnavailable() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">ZePhone doit être lancé comme application</h1>
      <p className="text-muted-foreground max-w-md text-sm">
        Cette interface communique avec le moteur SIP natif (Rust/Baresip) et n'est pas utilisable dans un navigateur.
        Lancez <code className="bg-muted rounded px-1.5 py-0.5">npm run tauri dev</code>.
      </p>
    </div>
  );
}

export default function App() {
  useTelephonyBootstrap();
  const unavailable = useUiStore((s) => s.backendUnavailable);
  return (
    <>
      <ThemeSync />
      <TranslucencySync />
      {unavailable ? <BackendUnavailable /> : <AppShell />}
    </>
  );
}
