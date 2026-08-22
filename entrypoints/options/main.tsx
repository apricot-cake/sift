import { createRoot } from "react-dom/client";
import { SidepanelApp } from "../sidepanel/sidepanel-app.tsx";
import "./style.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<SidepanelApp manageAll />);
}
