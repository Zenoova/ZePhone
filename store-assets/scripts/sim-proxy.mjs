// A tiny proxy in front of the app's Vite dev server (port 1420), for photographing the real iOS shell in the Simulator.
//
// The application built by `tauri ios dev` loads one fixed address (its devUrl). This proxy is that address (port 1500): it
// serves a wrapper page whose frame is the showcase (`?mock=showcase`) plus whatever is in
// captures/.sim-query, so a scene is chosen by writing that file and relaunching the app (`scene=call`, `scene=incoming`).
//   node scripts/sim-proxy.mjs
import { readFileSync } from "node:fs";
import http from "node:http";
import net from "node:net";
import path from "node:path";

const VITE = { host: "localhost", port: 1420 };
const PORT = 1500;
const QUERY_FILE = path.resolve(import.meta.dirname, "..", "captures", ".sim-query");
const query = () => {
  try {
    return readFileSync(QUERY_FILE, "utf8").trim();
  } catch {
    return "";
  }
};

// The real shell freezes its bridge (`window.__TAURI_INTERNALS__`) in the page it loads, so the fake backend cannot be installed
// there. The page the shell loads is therefore a bare wrapper (it keeps the shell's bridge, which the native tab bar needs), and
// the application runs in a frame of it, where the mock backend installs itself and reaches the tab bar through the parent.
const WRAPPER = (q) => `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover"><meta name="color-scheme" content="light dark"><style>html,body{margin:0;height:100%;background:transparent}iframe{border:0;display:block;width:100%;height:100%}</style></head><body><iframe src="/__app?${q}"></iframe></body></html>`;

const server = http.createServer((req, res) => {
  console.log(new Date().toISOString().slice(11, 19), req.method, req.url);
  const isWrapper = req.url === "/" || req.url?.startsWith("/?") || req.url === "/index.html";
  if (isWrapper) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    res.end(WRAPPER(`mock=showcase${query() ? `&${query()}` : ""}`));
    return;
  }
  const isApp = req.url?.startsWith("/__app");
  const up = http.request({ ...VITE, path: isApp ? "/" : req.url, method: req.method, headers: { ...req.headers, host: `${VITE.host}:${VITE.port}` } }, (r) => {
    res.writeHead(r.statusCode ?? 502, r.headers);
    r.pipe(res);
  });
  up.on("error", () => res.writeHead(502).end());
  req.pipe(up);
});

// Vite's hot-reload socket.
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(VITE.port, VITE.host, () => {
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n")}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(PORT, "127.0.0.1", () => console.log(`sim proxy on http://localhost:${PORT} → vite ${VITE.port}; query file ${QUERY_FILE}`));
