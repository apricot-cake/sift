import { createRoot } from "react-dom/client";
import { OptionsApp } from "./options-app.tsx";
import "./style.css";

const root = document.getElementById("root");

if (root) {
  createRoot(root).render(<OptionsApp />);
}
