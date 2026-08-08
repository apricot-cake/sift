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
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), xAdapter);

    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();
  });

  it("carries its controls inside a shadow root, away from the page", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), xAdapter);

    await vi.waitFor(() => {
      expect(toolbarHost()?.shadowRoot).toBeTruthy();
    });
    const shadow = toolbarHost()?.shadowRoot;

    expect(shadow?.querySelector('[data-action="toggle-enabled"]')).not.toBeNull();
    expect(shadow?.querySelector('[data-role="panel"]')).not.toBeNull();
    // Nothing the toolbar draws is reachable from the page's own document.
    expect(document.querySelector('[data-action="toggle-enabled"]')).toBeNull();

    runtime.dispose();
  });

  it("stays off a page with no posts on it", async () => {
    document.body.innerHTML = '<div data-testid="primaryColumn">settings</div>';
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), xAdapter);

    // Nothing to wait for, so let the runtime's own startup settle first.
    await vi.waitFor(() => {
      expect(document.body.querySelector("article")).toBeNull();
    });
    expect(toolbarHost()).toBeNull();

    runtime.dispose();
  });

  // The injection that replaces this script disposes the previous runtime, and
  // what it leaves behind would be a second toolbar over the same posts.
  it("goes away with the runtime that made it", async () => {
    document.body.innerHTML = timelineMarkup;
    const runtime = startContentRuntime(new ContentScriptContext("sift-test"), xAdapter);
    await vi.waitFor(() => {
      expect(toolbarHost()).not.toBeNull();
    });

    runtime.dispose();

    expect(toolbarHost()).toBeNull();
  });
});
