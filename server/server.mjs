// The game's server in production: the built game (dist/) and, on /ws, the relay for friend matches.
//
//   node server/server.mjs      serves dist/ on port 8080 (PORT and SITE override)

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { attachRelay } from "./relay.mjs";

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon", ".svg": "image/svg+xml",
  ".mp3": "audio/mpeg", ".ogg": "audio/ogg", ".wav": "audio/wav",
};

export function start({ port = 8080, site = fileURLToPath(new URL("../dist/", import.meta.url)), delay = 0 } = {}) {
  const root = resolve(site);
  const server = createServer(async (req, res) => {
    let path = normalize(decodeURIComponent(new URL(req.url, "http://x").pathname));
    if (path.endsWith("/")) path += "index.html";
    const file = join(root, path);
    if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
    try {
      const s = await stat(file);
      if (!s.isFile()) throw new Error("not a file");
      const type = TYPES[extname(file)] || "application/octet-stream";
      // Built assets have hashed names and never change; the page itself must always be fresh (new versions).
      const cache = type.startsWith("text/html") ? "no-cache" : path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "public, max-age=3600";
      res.writeHead(200, { "content-type": type, "content-length": s.size, "cache-control": cache });
      res.end(req.method === "HEAD" ? undefined : await readFile(file));
    } catch {
      res.writeHead(404, { "content-type": "text/plain" }).end("Not found");
    }
  });
  const relay = attachRelay(server, { delay });
  return new Promise((done) => server.listen(port, () => done({
    port: server.address().port,
    rooms: relay.rooms,
    close: () => new Promise((closed) => { relay.close(); server.close(() => closed()); }),
  })));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const s = await start({ port: Number(process.env.PORT) || 8080, site: process.env.SITE || undefined });
  console.log(`Pool on http://localhost:${s.port}`);
  for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => s.close().then(() => process.exit(0))); // docker stop
}
