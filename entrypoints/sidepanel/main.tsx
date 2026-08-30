import { createRoot } from "react-dom/client";
import { startLocalBuildReloadForPage } from "../../utils/local-build-reload-page.ts";
import { SidepanelApp } from "./sidepanel-app.tsx";
import "./style.css";

if (__SIFT_LOCAL_DEPLOY__) {
  const closeReload = startLocalBuildReloadForPage(async () => {
    const { startLocalBuildReload } = await import(
      "../../utils/local-build-reload.ts"
    );
    return startLocalBuildReload(__SIFT_BUILD_ID__);
  });
  window.addEventListener("pagehide", closeReload, {
    once: true,
  });
}

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<SidepanelApp />);
}
