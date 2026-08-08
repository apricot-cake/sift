import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Read off disk rather than exercised through a DOM: what these assertions are
// about is what the stylesheet is allowed to mention, which no rendering would
// show.
//
// From the project root, which is where Vitest runs. The two shorter routes are
// both closed: `import.meta.url` is an http URL here, since Vitest serves
// modules over http, and Vite's `?raw` import answers a stylesheet with an empty
// string once the CSS pipeline has taken it — which is a passing test that reads
// nothing.
function readFromRoot(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const contentStyles = readFromRoot("entrypoints/content/style.css");
const contentScript = readFromRoot("entrypoints/content/index.ts");

describe("the content stylesheet", () => {
  // Otherwise the highlight appears on whichever service the CSS happened to
  // name (it named X's post card once, so the line was drawn on X alone), and
  // every new adapter would have to add a rule here.
  it("names no service's page structure", () => {
    for (const serviceSpecific of ["data-testid", "tweet", "feedItem", "bsky", "article"]) {
      expect(
        contentStyles.includes(serviceSpecific),
        `entrypoints/content/style.css names ${serviceSpecific}, which is one service's page structure`
      ).toBe(false);
    }
  });

  // Both highlights are keyed off the state attribute alone, so they match the
  // cell every adapter marks.
  it("draws each highlight on the cell that carries the state", () => {
    for (const state of ["hit", "rising"]) {
      expect(
        contentStyles,
        `entrypoints/content/style.css has no rule matching the ${state} cell itself`
      ).toMatch(new RegExp(`\\[data-sift-filter-state="${state}"\\]\\s*\\{`));
    }
  });
});

describe("what the content script writes onto the page", () => {
  // The extension was renamed to Sift long before these tests existed, and the
  // attributes and class names the content script writes were the last place the
  // old prefix survived. They are a public surface — a reader's own CSS, and any
  // other extension on the same page, can see them — so the old name must not
  // come back through a copied line.
  it("carries no trace of the extension's old name", () => {
    expect(contentStyles).not.toContain("xif");
    expect(contentScript).not.toContain("xif");
  });
});
