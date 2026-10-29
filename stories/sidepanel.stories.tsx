import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";
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
export const FilterConditions: Story = {
  name: "絞り込み条件",
  play: async ({ canvasElement }) => {
    await userEvent.click(
      await within(canvasElement).findByRole("tab", { name: "絞り込み条件" }),
    );
  },
};
export const Bluesky: Story = {
  name: "Bluesky",
  beforeEach: () => preparePanel("bluesky"),
};
export const Disconnected: Story = {
  name: "未接続",
  beforeEach: () => preparePanel("disconnected"),
};
export const CollectionLimit: Story = {
  name: "収集上限",
  beforeEach: () => preparePanel("x", true),
};
