import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import tailwindcss from "@tailwindcss/vite";
import { generateChromeMessages, parseMessagesFile } from "@wxt-dev/i18n/build";

const config: StorybookConfig = {
  stories: ["../stories/**/*.stories.tsx"],
  addons: ["@storybook/addon-docs"],
  framework: "@storybook/react-vite",
  async viteFinal(config) {
    const messages = generateChromeMessages(
      await parseMessagesFile(
        fileURLToPath(new URL("../locales/ja.yml", import.meta.url)),
      ),
    );
    config.plugins = [...(config.plugins ?? []), tailwindcss()];
    config.resolve ??= {};
    config.resolve.alias = [
      {
        find: /^(wxt\/browser|@wxt-dev\/browser)$/,
        replacement: fileURLToPath(new URL("./browser.ts", import.meta.url)),
      },
      {
        find: "#i18n",
        replacement: fileURLToPath(
          new URL("../.wxt/i18n/index.ts", import.meta.url),
        ),
      },
    ];
    config.define = {
      ...config.define,
      __SIFT_LOCAL_DEPLOY__: "false",
      __SIFT_LOCAL_BUILD__: "false",
      __SIFT_BUILD_ID__: JSON.stringify("storybook"),
      __STORYBOOK_MESSAGES__: JSON.stringify(messages),
    };
    return config;
  },
};
export default config;
