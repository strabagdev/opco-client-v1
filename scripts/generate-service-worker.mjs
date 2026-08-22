import { createHash } from "node:crypto";
import { copyFile, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const distRoot = join(repoRoot, "dist");
const publicRoot = join(repoRoot, "public");
const manifestSource = join(publicRoot, "manifest.json");
const manifestTarget = join(distRoot, "manifest.json");
const indexPath = join(distRoot, "index.html");
const swPath = join(distRoot, "sw.js");
const precacheExtensions = new Set([
  ".css",
  ".html",
  ".ico",
  ".js",
  ".json",
  ".png",
  ".svg",
  ".ttf",
  ".wasm",
  ".woff",
  ".woff2",
]);

await copyFile(manifestSource, manifestTarget);
await ensureManifestLink();

const files = await listPrecacheFiles(distRoot);
const hash = createHash("sha256");

for (const file of files) {
  hash.update(file);
  hash.update(await readFile(join(distRoot, file.replace(/^\//, ""))));
}

const buildHash = hash.digest("hex").slice(0, 16);
const precacheUrls = Array.from(new Set(["/", "/index.html", ...files])).sort();

await writeFile(swPath, serviceWorkerSource({ buildHash, precacheUrls }));

console.log(`Generated offline app shell service worker ${buildHash} with ${precacheUrls.length} resources.`);

async function ensureManifestLink() {
  const html = await readFile(indexPath, "utf8");

  if (html.includes('rel="manifest"')) {
    return;
  }

  await writeFile(
    indexPath,
    html.replace(
      "</head>",
      '  <link rel="manifest" href="/manifest.json"/><meta name="theme-color" content="#135d66"/></head>',
    ),
  );
}

async function listPrecacheFiles(root, prefix = "") {
  const entries = await readdir(join(root, prefix), { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name === "sw.js") {
      continue;
    }

    const child = prefix ? `${prefix}${sep}${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      files.push(...await listPrecacheFiles(root, child));
      continue;
    }

    if (!entry.isFile() || !precacheExtensions.has(extname(entry.name))) {
      continue;
    }

    const fileStat = await stat(join(root, child));

    if (fileStat.size <= 0) {
      continue;
    }

    files.push(`/${relative(root, join(root, child)).split(sep).join("/")}`);
  }

  return files;
}

function serviceWorkerSource({
  buildHash,
  precacheUrls,
}) {
  return `const SHELL_CACHE = "opco-shell-${buildHash}";
const PRECACHE_URLS = ${JSON.stringify(precacheUrls, null, 2)};
const API_HOSTS = new Set(["web.opco.cl"]);

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys
        .filter((key) => key.startsWith("opco-shell-") && key !== SHELL_CACHE)
        .map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") {
    return;
  }

  const url = new URL(event.request.url);

  if (url.pathname.startsWith("/api/") || (API_HOSTS.has(url.hostname) && url.pathname.startsWith("/api/v1/"))) {
    return;
  }

  if (event.request.mode === "navigate") {
    event.respondWith(fetch(event.request).catch(() => caches.match("/index.html")));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => cached ?? fetch(event.request))
  );
});
`;
}
