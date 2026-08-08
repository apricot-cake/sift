// Folded to a boolean literal at build time by the `define` in wxt.config.ts,
// keyed on Vite's command. Not something WXT generates on its own, since it is
// this project's own build-time constant rather than one of WXT's.
//
// No import belongs in this file: one would turn it into a module, and a
// `declare const` in a module is not a global. The message-name types, which do
// need an import, are in i18n.d.ts for that reason.
declare const __SIFT_DEV__: boolean;
