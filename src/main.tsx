import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/app/App";
import CallWindowApp from "@/app/CallWindowApp";
import { isCallWindow } from "@/lib/window";

import "./index.css";
import "@/components/arc/foundation.css";

// The webview is a desktop app surface: no browser context menu.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest("input, textarea, [data-selectable]")) e.preventDefault();
});

document.documentElement.dataset.accent = "blue"; // accent of the Arc UI components

async function boot() {
  // Dev-only UI preview without the Rust backend (`/?mock`); compiled out of production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock")) {
    const { installMockBackend } = await import("@/dev/mock-backend");
    installMockBackend();
  }
  // The call window is this same page in a window labelled `call` (see `src-tauri/src/app/call_window.rs`).
  const Root = isCallWindow() ? CallWindowApp : App;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider attribute={["class", "data-theme"]} defaultTheme="system" enableSystem disableTransitionOnChange>
        <Root />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void boot();
