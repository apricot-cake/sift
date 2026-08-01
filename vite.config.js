import { defineConfig } from "vite";
import { crx } from "@crxjs/vite-plugin";
import manifest from "./manifest.config.js";
import { preserveCrxContentTabs } from "./vite-plugins/preserve-crx-content-tabs.js";

export default defineConfig(({ command }) => ({
  plugins: [crx({ manifest }), preserveCrxContentTabs()],
  build: {
    outDir: command === "serve" ? "dist-dev" : "dist"
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
