import type { Meta, StoryObj } from "@storybook/react-vite";
import { RotateCcw } from "lucide-react";
import { useArgs } from "storybook/preview-api";
import { Button } from "../entrypoints/sidepanel/components/ui/button.tsx";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../entrypoints/sidepanel/components/ui/card.tsx";
import { Input } from "../entrypoints/sidepanel/components/ui/input.tsx";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../entrypoints/sidepanel/components/ui/select.tsx";
import { Switch } from "../entrypoints/sidepanel/components/ui/switch.tsx";

type Args = {
  disabled: boolean;
  label: string;
  variant: "default" | "outline" | "ghost" | "destructive";
  size: "default" | "sm" | "icon";
  minimum: number;
  enabled: boolean;
  site: string;
};

const meta = {
  title: "部品/基本部品",
  parameters: { layout: "centered" },
  args: {
    disabled: false,
    label: "リセット",
    variant: "outline",
    size: "default",
    minimum: 100,
    enabled: true,
    site: "x",
  },
  argTypes: {
    disabled: { name: "無効", control: "boolean" },
    label: { name: "ラベル", control: "text" },
    variant: {
      name: "種類",
      control: "select",
      options: ["default", "outline", "ghost", "destructive"],
    },
    size: {
      name: "サイズ",
      control: "select",
      options: ["default", "sm", "icon"],
    },
    minimum: { name: "最小いいね数", control: { type: "number", min: 0 } },
    enabled: { name: "有効", control: "boolean" },
    site: {
      name: "サイト",
      control: "select",
      options: ["x", "bluesky"],
    },
  },
} satisfies Meta<Args>;

export default meta;
type Story = StoryObj<Args>;

export const Buttons: Story = {
  name: "ボタン",
  parameters: {
    controls: { include: ["disabled", "label", "variant", "size"] },
  },
  render: ({ disabled, label, variant, size }) => (
    <Button
      disabled={disabled}
      variant={variant}
      size={size}
      aria-label={size === "icon" ? label : undefined}
    >
      {size === "icon" ? <RotateCcw className="size-4" /> : label}
    </Button>
  ),
};

export const MinimumInput: Story = {
  name: "数値入力",
  parameters: { controls: { include: ["disabled", "minimum"] } },
  render: function Render() {
    const [{ disabled, minimum }, updateArgs] = useArgs<Args>();
    return (
      <div className="grid w-64 gap-2">
        <label htmlFor="minimum-input">最小いいね数</label>
        <Input
          id="minimum-input"
          type="number"
          min={0}
          disabled={disabled}
          value={minimum}
          onChange={(event) =>
            updateArgs({ minimum: Number(event.target.value) })
          }
        />
      </div>
    );
  },
};

export const SiteSelect: Story = {
  name: "サイト選択",
  parameters: { controls: { include: ["disabled", "site"] } },
  render: function Render() {
    const [{ disabled, site }, updateArgs] = useArgs<Args>();
    return (
      <div className="grid w-64 gap-2">
        <label htmlFor="site-select">設定するサイト</label>
        <Select
          disabled={disabled}
          value={site}
          onValueChange={(value) => updateArgs({ site: value })}
        >
          <SelectTrigger id="site-select">
            <SelectValue placeholder="サイトを選択" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="x">X</SelectItem>
            <SelectItem value="bluesky">Bluesky</SelectItem>
          </SelectContent>
        </Select>
      </div>
    );
  },
};

export const FilteringSwitch: Story = {
  name: "スイッチ",
  parameters: { controls: { include: ["disabled", "enabled"] } },
  render: function Render() {
    const [{ disabled, enabled }, updateArgs] = useArgs<Args>();
    return (
      <div className="flex w-64 items-center justify-between gap-4">
        <label htmlFor="filtering-switch">フィルタリング</label>
        <Switch
          id="filtering-switch"
          disabled={disabled}
          checked={enabled}
          onCheckedChange={(checked) => updateArgs({ enabled: checked })}
        />
      </div>
    );
  },
};

export const SettingsCard: Story = {
  name: "設定カード",
  parameters: { controls: { include: ["disabled", "enabled"] } },
  render: function Render() {
    const [{ disabled, enabled }, updateArgs] = useArgs<Args>();
    return (
      <Card className="w-80">
        <CardHeader>
          <CardTitle>投稿の種類</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between gap-4">
            <label htmlFor="card-media-switch">画像を含む投稿</label>
            <Switch
              id="card-media-switch"
              disabled={disabled}
              checked={enabled}
              onCheckedChange={(checked) => updateArgs({ enabled: checked })}
            />
          </div>
        </CardContent>
      </Card>
    );
  },
};
