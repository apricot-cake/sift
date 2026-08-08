import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "wxt/testing/fake-browser";
import { ContentScriptContext } from "wxt/utils/content-script-context";
import { xAdapter } from "../../utils/adapters/x.ts";
import { startContentRuntime } from "./index.ts";

// One X post, enough for the adapter to find something to filter.
const timelineMarkup = `
  <div data-testid="cellInnerDiv">
    <article data-testid="tweet">
      <div data-testid="tweetPhoto"></div>
      <button data-testid="like" aria-label="900 件のいいね"></button>
      <time datetime="2026-08-01T12:00:00.000Z"></time>
    </article>
  </div>
`;

function toolbarHost(): Element | null {
  return document.querySelector("sift-toolbar");
}

beforeEach(() => {
  fakeBrowser.reset();
  document.body.innerHTML = "";
});

describe("the toolbar", () => {
  it("is on the page once there are posts to filter", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();
  });

  it("carries its controls inside a shadow root, away from the page", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    await vi.waitFor(() => {
      expect(toolbarHost()?.shadowRoot).toBeTruthy();
    });
    const shadow = toolbarHost()?.shadowRoot;

    expect(
      shadow?.querySelector('[data-action="toggle-enabled"]'),
    ).not.toBeNull();
    expect(shadow?.querySelector('[data-role="panel"]')).not.toBeNull();
    // Nothing the toolbar draws is reachable from the page's own document.
    expect(document.querySelector('[data-action="toggle-enabled"]')).toBeNull();

    runtime.dispose();
  });

  it("stays off a page with no posts on it", async () => {
    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );

    // Nothing to wait for, so let the runtime's own startup settle first.
    await vi.waitFor(() => {
      expect(document.body.querySelector("article")).toBeNull();
    });
    expect(toolbarHost()).toBeNull();

    runtime.dispose();
  });

  // Where the toolbar sits is the one thing about it that no other test would
  // notice going wrong: it renders, it answers clicks, it just does it halfway
  // down the timeline instead of in the corner. That is what happened when the
  // placement moved from a rule on the host in entrypoints/content/style.css to
  // WXT's shadow root, which prepends `:host{all:initial !important}` unless
  // told not to — !important beat the rule that placed it, and nothing failed.
  //
  // Read off the stylesheet WXT actually installed rather than off a computed
  // style, because happy-dom resolves `all: initial !important` as though the
  // !important were not there: it reports `position: fixed` either way, so a
  // computed style would pass on the broken version too (checked 2026-08-08).
  it("is placed by rules nothing above them can beat", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await vi.waitFor(() => {
      expect(toolbarHost()?.shadowRoot).toBeTruthy();
    });

    const installedCss = [
      ...(toolbarHost()?.shadowRoot?.querySelectorAll("style") ?? []),
    ]
      .map((style) => style.textContent ?? "")
      .join("\n");

    expect(installedCss).not.toMatch(/all\s*:\s*initial\s*!important/);
    const host = installedCss.match(/:host\s*\{[^}]*\}/)?.[0] ?? "";
    for (const declaration of [
      "position: fixed",
      "bottom: 18px",
      "right: 18px",
      "z-index: 2147483647",
    ]) {
      expect(
        host.includes(declaration),
        `the toolbar's :host rule has no ${declaration}`,
      ).toBe(true);
    }

    runtime.dispose();
  });

  // The injection that replaces this script disposes the previous runtime, and
  // what it leaves behind would be a second toolbar over the same posts.
  it("goes away with the runtime that made it", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(
      new ContentScriptContext("sift-test"),
      xAdapter,
    );
    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();

    expect(toolbarHost()).toBeNull();
  });
});
