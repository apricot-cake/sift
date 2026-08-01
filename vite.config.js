import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import path from "node:path";
import manifest from "./manifest.config.js";
import { devErrorLog } from "./vite-plugins/dev-error-log.js";
import { preserveCrxContentTabs } from "./vite-plugins/preserve-crx-content-tabs.js";

export default defineConfig(({ command }) => ({
  plugins: [crx({ manifest }), preserveCrxContentTabs(), devErrorLog()],
  build: {
    outDir:
      command === "serve" && process.env.SIFT_DEV_OUT_DIR
        ? path.resolve(process.env.SIFT_DEV_OUT_DIR)
        : command === "serve"
          ? "dist-dev"
          : "dist"
  },
  server: {
    host: "127.0.0.1",
    port: 51732,
    strictPort: true,
    cors: {
      origin: [/chrome-extension:\/\//]
    }
  }
}));
