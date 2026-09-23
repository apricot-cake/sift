import "@fontsource-variable/noto-sans/wght.css";
import "@fontsource-variable/noto-sans-jp/wght.css";
import { createRoot } from "react-dom/client";
import { SidepanelApp } from "./sidepanel-app.tsx";
import "./style.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<SidepanelApp />);
}
