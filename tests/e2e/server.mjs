import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const webRoot = resolve(root, "web");
const dataRoot = resolve(root, "data");
const dataFiles = new Set([
  "/data/latest.json",
  "/data/evolution.json",
  "/data/snapshots.json",
  "/data/geo/districts.geojson",
]);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".geojson": "application/geo+json; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const isDataFile = dataFiles.has(pathname);
  const relative = pathname === "/" ? "index.html" : isDataFile ? pathname.replace(/^\/data\//, "") : pathname.replace(/^\/+/, "");
  const base = isDataFile ? dataRoot : webRoot;
  const localPath = resolve(base, relative);
  if (localPath !== base && !localPath.startsWith(`${base}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(localPath);
    response.writeHead(200, { "Content-Type": contentTypes[extname(localPath)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Introuvable");
  }
}).listen(4173, "127.0.0.1");
