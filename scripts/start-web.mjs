import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./web-security-headers.mjs";

const root = resolve(fileURLToPath(new URL("../dist", import.meta.url)));
const indexHtml = join(root, "index.html");
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "0.0.0.0";

if (!Number.isInteger(port) || port <= 0) {
  throw new Error("PORT must be a positive integer.");
}

const server = createServer(async (request, response) => {
  if (!request.url) {
    sendStatus(response, 400);
    return;
  }

  const url = new URL(request.url, `http://${request.headers.host ?? "localhost"}`);
  const requestedPath = decodeURIComponent(url.pathname);
  const filePath = getSafeFilePath(requestedPath);

  if (!filePath) {
    sendStatus(response, 403);
    return;
  }

  const staticFile = await getExistingFile(filePath);

  if (staticFile) {
    streamFile(response, staticFile);
    return;
  }

  streamFile(response, indexHtml);
});

server.listen(port, host, () => {
  console.log(`Serving Expo Web from ${root} on ${host}:${port}`);
});

function getSafeFilePath(pathname) {
  const relativePath = normalize(pathname.replace(/^\/+/, ""));
  const filePath = join(root, relativePath);

  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    return null;
  }

  return filePath;
}

async function getExistingFile(filePath) {
  try {
    const fileStat = await stat(filePath);

    if (fileStat.isFile()) {
      return filePath;
    }

    const nestedIndex = join(filePath, "index.html");
    const nestedIndexStat = await stat(nestedIndex);

    return nestedIndexStat.isFile() ? nestedIndex : null;
  } catch {
    return null;
  }
}

function streamFile(response, filePath) {
  response.writeHead(200, {
    "Cache-Control": getCacheControl(filePath),
    "Content-Type": getContentType(filePath),
    ...securityHeaders(),
    ...getServiceWorkerHeaders(filePath),
  });
  createReadStream(filePath).pipe(response);
}

function getCacheControl(filePath) {
  if (filePath.endsWith(`${sep}sw.js`) || filePath.endsWith(`${sep}index.html`)) {
    return filePath.endsWith(`${sep}sw.js`) ? "no-store, no-cache, must-revalidate" : "no-cache";
  }

  return "public, max-age=31536000, immutable";
}

function getServiceWorkerHeaders(filePath) {
  if (!filePath.endsWith(`${sep}sw.js`)) {
    return {};
  }

  return {
    "Service-Worker-Allowed": "/",
  };
}

function sendStatus(response, status) {
  response.writeHead(status);
  response.end();
}

function getContentType(filePath) {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".wasm":
      return "application/wasm";
    default:
      return "application/octet-stream";
  }
}
