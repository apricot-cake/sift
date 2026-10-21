import "@fontsource-variable/noto-sans/wght.css";
import "@fontsource-variable/noto-sans-jp/wght.css";
import "../entrypoints/sidepanel/style.css";
import type { Preview } from "@storybook/react-vite";
import { mocked, sb } from "storybook/test";
import { sidePanelTabIdFromUrl } from "../utils/sidepanel-controls.ts";
import { preparePanel } from "./browser.ts";

sb.mock(import("../utils/sidepanel-controls.ts"), { spy: true });

const preview: Preview = {
  parameters: { layout: "padded" },
  beforeEach: async () => {
    await preparePanel();
    mocked(sidePanelTabIdFromUrl).mockReturnValue(1);
  },
};
export default preview;
