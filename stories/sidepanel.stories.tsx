import type { Meta, StoryObj } from "@storybook/react-vite";
import { preparePanel } from "../.storybook/browser.ts";
import { SidepanelApp } from "../entrypoints/sidepanel/sidepanel-app.tsx";

const meta = {
  title: "サイドパネル",
  component: SidepanelApp,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <div style={{ width: "min(100%, 400px)", minHeight: "100vh" }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidepanelApp>;
export default meta;
type Story = StoryObj<typeof meta>;
export const X: Story = { name: "X" };
export const Bluesky: Story = {
  name: "Bluesky",
  beforeEach: () => preparePanel("bluesky"),
};
export const Disconnected: Story = {
  name: "未接続",
  beforeEach: () => preparePanel("disconnected"),
};
export const Warning: Story = {
  name: "連続読み込みの警告",
  beforeEach: () => preparePanel("x", true),
};
