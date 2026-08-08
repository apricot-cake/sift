// browser.i18n.getMessage against the real English messages file, for every
// test run. WXT's fake browser leaves i18n unimplemented — calling it throws —
// and stubbing it with "return the key" would let a message name that exists
// nowhere pass every test that renders it.
//
// English, because that is the default locale: a browser with no Japanese is
// what the fallback is for, and reading the file that has to be complete is
// what makes a missing key fail here rather than in front of a reader.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";

interface MessageEntry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

// Read through node rather than imported: Vitest serves modules over http, so
// `import.meta.url` is not a file path here, and a JSON import would be a second
// copy of the file inside the bundle.
export function readMessages(locale: string): Record<string, MessageEntry> {
  return JSON.parse(
    readFileSync(
      resolve(process.cwd(), `public/_locales/${locale}/messages.json`),
      "utf8",
    ),
  );
}

const messages = readMessages("en");

// What Chrome does with $NAME$: look the name up in `placeholders`, read the
// positional argument its `content` points at ($1 is the first), and put that
// in. Placeholder names are matched without regard to case.
export function getMessage(
  key: string,
  substitutions?: string | string[],
): string {
  const entry = messages[key];
  if (entry === undefined) {
    throw new Error(`no message named ${key} in public/_locales/en`);
  }

  const args =
    substitutions === undefined
      ? []
      : typeof substitutions === "string"
        ? [substitutions]
        : substitutions;

  let text = entry.message;
  for (const [name, { content }] of Object.entries(entry.placeholders ?? {})) {
    const position = Number(content.slice(1)) - 1;
    text = text.replaceAll(`$${name.toUpperCase()}$`, args[position] ?? "");
  }
  return text;
}

// fakeBrowser.reset() runs between tests and puts the unimplemented function
// back, so this is reinstalled rather than assigned once.
beforeEach(() => {
  fakeBrowser.i18n.getMessage =
    getMessage as typeof fakeBrowser.i18n.getMessage;
});
