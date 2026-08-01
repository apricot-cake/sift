import { defineManifest } from "@crxjs/vite-plugin";

const siteMatches = ["https://x.com/*", "https://twitter.com/*"];

export default defineManifest(({ command }) => {
  const isDevelopment = command === "serve";

  return {
    manifest_version: 3,
    name: "Sift",
    version: "0.1.0",
    description: "Xの投稿画面を、メディア・いいね数・投稿後の時間で絞り込みます。",
    permissions: isDevelopment ? ["storage", "scripting"] : ["storage"],
    ...(isDevelopment
      ? {
          host_permissions: siteMatches,
          background: {
            service_worker: "src/background-dev.js",
            type: "module"
          }
        }
      : {}),
    action: {
      default_title: "Sift",
      default_popup: "popup.html"
    },
    content_scripts: [
      {
        matches: siteMatches,
        css: ["src/content/style.css"],
        js: ["src/content/index.js"],
        run_at: "document_idle"
      }
    ]
  };
});
