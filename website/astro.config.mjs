import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://apricot-cake.github.io",
  base: "/sift",
  output: "static",
  vite: {
    tsconfig: "./tsconfig.json",
  },
});
