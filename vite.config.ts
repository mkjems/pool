import { defineConfig, type Plugin } from "vitest/config";
// @ts-expect-error: plain JavaScript module, shared with the production server
import { attachRelay } from "./server/relay.mjs";

/** The friend-match relay on /ws, inside Vite's own server (dev and preview), as in production. */
function relay(): Plugin {
  return {
    name: "pool-relay",
    configureServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
    configurePreviewServer(server) { if (server.httpServer) attachRelay(server.httpServer); },
  };
}

export default defineConfig({
  plugins: [relay()],
  // The game's version, for friend matches: both browsers must run the same physics (the older one reloads).
  define: { __BUILD__: JSON.stringify(Date.now()) },
  build: { target: "es2022", chunkSizeWarningLimit: 900 },
  test: { include: ["tests/**/*.test.ts"] },
});
