import { ThemeProvider } from "next-themes";
import React from "react";
import ReactDOM from "react-dom/client";

import App from "@/app/App";

import "./index.css";

// The webview is a desktop app surface: no browser context menu.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement | null;
  if (!t?.closest("input, textarea, [data-selectable]")) e.preventDefault();
});

async function boot() {
  // Dev-only UI preview without the Rust backend (`/?mock`); compiled out of production builds.
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("mock")) {
    const { installMockBackend } = await import("@/dev/mock-backend");
    installMockBackend();
  }
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
        <App />
      </ThemeProvider>
    </React.StrictMode>,
  );
}

void boot();
