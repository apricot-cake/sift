import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { render } from "../test/dom.ts";
import { readMessages } from "../test/i18n.ts";
import { I18N_ATTRIBUTES, localizeDocument, t } from "./i18n.ts";

const english = readMessages("en");
const japanese = readMessages("ja");

// Read through node rather than imported: `import.meta.url` is an http URL under
// Vitest, and Vite's `?raw` import of an HTML entrypoint answers with what the
// HTML pipeline made of it rather than the file as written.
function readFromRoot(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

// happy-dom resolves <link> and <script> while it parses, over http, from a
// server no test is running — and reports the failure asynchronously, after the
// test that caused it has already passed. Dropping the two tags leaves
// everything this reads untouched.
function parseEntrypoint(path: string): Document {
  const html = readFromRoot(path)
    .replace(/<link\b[^>]*>/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  return new DOMParser().parseFromString(html, "text/html");
}

// Both surfaces with static markup. The toolbar's is built in code, where the
// compiler already checks the names.
const STATIC_PAGES = [
  "entrypoints/options/index.html",
  "entrypoints/popup/index.html",
];

// A locale file that is missing a name falls back to English silently, which
// reads as a page half in the wrong language rather than as a failure.
describe("the locale files", () => {
  it("name the same messages", () => {
    expect(Object.keys(japanese).sort()).toEqual(Object.keys(english).sort());
  });

  // A substitution written on one side alone leaves a literal $HIT$ on the page
  // in that language, or drops the number entirely in the other.
  it("agree on which messages take substitutions", () => {
    for (const [key, entry] of Object.entries(english)) {
      expect({
        key,
        placeholders: Object.keys(entry.placeholders ?? {}),
      }).toEqual({
        key,
        placeholders: Object.keys(japanese[key]?.placeholders ?? {}),
      });
    }
  });

  it("leave no message empty", () => {
    for (const [key, entry] of Object.entries({ ...english, ...japanese })) {
      expect({ key, empty: entry.message.trim() === "" }).toEqual({
        key,
        empty: false,
      });
    }
  });
});

// The names in the markup are strings as far as the compiler is concerned —
// nothing type-checks an attribute value — so this is what catches a rename.
// index.html also carries the English text itself, for the moment before main.ts
// runs and for anything that reads the markup without running it at all; holding
// the two to each other is what keeps that copy from drifting into a second,
// older set of words.
describe.each(STATIC_PAGES)("%s", (path) => {
  const page = parseEntrypoint(path);

  it("names only messages that exist, and writes what they say", () => {
    const elements = page.querySelectorAll("[data-i18n]");
    expect(elements.length).toBeGreaterThan(0);

    for (const element of elements) {
      const name = element.getAttribute("data-i18n");
      expect({ name, text: element.textContent }).toEqual({
        name,
        text: english[name ?? ""]?.message,
      });
    }
  });

  it("does the same for the attributes it uses", () => {
    for (const [attribute, target] of Object.entries(I18N_ATTRIBUTES)) {
      for (const element of page.querySelectorAll(`[${attribute}]`)) {
        const name = element.getAttribute(attribute);
        expect({ name, value: element.getAttribute(target) }).toEqual({
          name,
          value: english[name ?? ""]?.message,
        });
      }
    }
  });
});

// Between them the two pages have to exercise every attribute form, or a broken
// one could sit unnoticed in whichever page stopped using it.
it("every localized attribute appears in one of the pages", () => {
  const pages = STATIC_PAGES.map(parseEntrypoint);
  for (const attribute of Object.keys(I18N_ATTRIBUTES)) {
    const found = pages.some(
      (page) => page.querySelectorAll(`[${attribute}]`).length > 0,
    );
    expect({ attribute, found }).toEqual({ attribute, found: true });
  }
});

describe("t()", () => {
  it("answers with the message", () => {
    expect(t("optionsInstanceAdd")).toBe(english.optionsInstanceAdd?.message);
  });

  it("puts the substitutions in, in the order the message names them", () => {
    expect(t("toolbarStatusCounts", "3", "2", "1")).toBe(
      "3 hits · 2 rising · 1 hidden",
    );
  });
});

describe("localizeDocument()", () => {
  it("fills in text, placeholders and aria-labels", () => {
    const root = render(`
      <p data-i18n="optionsTagline"></p>
      <input
        data-i18n-placeholder="optionsInstancePlaceholder"
        data-i18n-aria-label="optionsInstanceInputLabel"
      >
    `);

    localizeDocument(root);

    const paragraph = root.querySelector("p");
    const input = root.querySelector("input");
    expect(paragraph?.textContent).toBe(english.optionsTagline?.message);
    expect(input?.getAttribute("placeholder")).toBe(
      english.optionsInstancePlaceholder?.message,
    );
    expect(input?.getAttribute("aria-label")).toBe(
      english.optionsInstanceInputLabel?.message,
    );
  });

  // The attribute forms write an attribute and nothing else: an <input> has no
  // text of its own, and a button that took both would lose its label.
  it("leaves the text alone where only an attribute was asked for", () => {
    const root = render(
      '<input data-i18n-placeholder="optionsInstancePlaceholder" value="kept">',
    );

    localizeDocument(root);

    expect(root.querySelector("input")?.value).toBe("kept");
  });
});
