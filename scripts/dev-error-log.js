import { randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEV_PING_ENDPOINT, ERROR_LOG_ENDPOINT } from "../utils/dev-server.js";

export const DEFAULT_ERROR_LOG_PATH = path.join(
  os.homedir(),
  ".sift",
  "extension-errors.log"
);

const BODY_LIMIT_BYTES = 512 * 1024;

export function formatErrorLogLines(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${JSON.stringify(entry)}\n`)
    .join("");
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;

    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        reject(new Error("The development error log payload is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

// The extension's service worker fetches this from chrome-extension://<id>, so
// the response has to carry the permission itself. Mirrors the origin policy of
// the server's own CORS configuration.
function allowExtensionOrigin(request, response) {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
}

// Receives the uncaught exceptions the extension collected and appends them to
// ~/.sift/extension-errors.log as JSON Lines. This file is the whole point of
// the exercise: Chrome's own error box cannot be read from outside the browser,
// so without a file on disk an exception in the extension is invisible to any
// automated diagnosis.
//
// The endpoint is registered ahead of Vite's own middlewares, which is why it
// answers CORS itself rather than relying on the server's cors option running
// first.
export function devErrorLog({
  logPath = DEFAULT_ERROR_LOG_PATH,
  isBuilt = () => true
} = {}) {
  // Identifies this server process to the extension. A worker that sees an id it
  // did not start with knows its HMR socket belongs to a server that is gone,
  // and that only restarting itself will attach it to the one that is up (#31).
  const boot = randomUUID();

  return {
    name: "sift:dev-error-log",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use(DEV_PING_ENDPOINT, (request, response, next) => {
        if (request.method !== "GET") {
          next();
          return;
        }
        allowExtensionOrigin(request, response);
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        // `ready` gates the worker's self-reload. The server answers as soon as
        // it is listening, but starting it wipes and rewrites the build folder —
        // and reloading an unpacked extension whose folder is momentarily empty
        // does not retry, it FAILS: Chrome unloads the extension and puts up a
        // dialog about a missing manifest (measured 2026-08-02, #31). So the
        // worker is told to hold until there is something to reload into.
        response.end(JSON.stringify({ boot, ready: isBuilt() }));
      });

      server.middlewares.use(ERROR_LOG_ENDPOINT, async (request, response, next) => {
        if (request.method === "OPTIONS") {
          allowExtensionOrigin(request, response);
          response.setHeader("access-control-allow-methods", "POST, OPTIONS");
          response.setHeader("access-control-allow-headers", "content-type");
          response.statusCode = 204;
          response.end();
          return;
        }

        if (request.method !== "POST") {
          next();
          return;
        }

        allowExtensionOrigin(request, response);

        try {
          const entries = JSON.parse(await readBody(request));
          const lines = formatErrorLogLines(entries);
          if (lines !== "") {
            fs.mkdirSync(path.dirname(logPath), { recursive: true });
            fs.appendFileSync(logPath, lines, "utf8");
          }
          response.statusCode = 204;
          response.end();
        } catch (error) {
          server.config.logger.warn(
            `[sift] Could not write the extension error log: ${error.message}`
          );
          response.statusCode = 400;
          response.end();
        }
      });
    }
  };
}
