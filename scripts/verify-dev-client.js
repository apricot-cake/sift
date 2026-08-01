import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const configFile = fileURLToPath(new URL("../vite.config.js", import.meta.url));
const server = await createServer({
  configFile,
  server: {
    middlewareMode: true
  }
});

try {
  assert.equal(server.config.build.outDir, "dist-dev");
  assert.equal(server.config.server.host, "127.0.0.1");
  assert.equal(server.config.server.port, 51732);
  assert.equal(server.config.server.strictPort, true);

  const transformed = await server.transformRequest("/@crx/client-port");
  assert.ok(transformed, "CRXJS content client must be transformable");
  assert.doesNotMatch(transformed.code, /location\.reload\s*\(/);

  const runtimeDisposals = transformed.code.match(
    /Symbol\.for\(["']sift\.content-runtime["']\)/g
  );
  assert.equal(runtimeDisposals?.length, 2);
} finally {
  await server.close();
}

console.log("CRXJS content client preserves existing tabs");
