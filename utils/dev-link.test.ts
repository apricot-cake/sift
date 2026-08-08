import { describe, expect, it } from "vitest";
import { decideDevLinkAction } from "./dev-link.ts";

// Each case below is a state the worker cannot be talked into reaching on demand
// inside a browser, which is why the decision is a function rather than a branch
// buried in the polling loop.
const linked = {
  boot: "server-1",
  ready: true,
  isFirstProbe: false,
  bootAtStart: "server-1",
  registeredCount: 1,
  reloadedForBoot: undefined,
};

describe("decideDevLinkAction", () => {
  it("stays put while it is attached to the server it started against", () => {
    expect(decideDevLinkAction(linked)).toBe("linked");
  });

  it("reports the server being down", () => {
    expect(decideDevLinkAction({ ...linked, boot: null })).toBe("server-down");
  });

  // Reloading into an empty output folder unloads the extension outright, so
  // every state waits behind this one.
  it("waits while the server has not written the build yet", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        ready: false,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("building");
    expect(
      decideDevLinkAction({ ...linked, ready: false, boot: "server-2" }),
    ).toBe("building");
  });

  // The worker just started and the server answered, so its socket went to this
  // same server. Whatever it saw before does not matter.
  it("adopts the server it finds on its first probe", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        isFirstProbe: true,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("adopt");
  });

  // The browser was open before the server was: the worker's first probe found
  // nothing, so it never adopted a generation, and the socket it opened is dead.
  it("reloads when it never attached to anything", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        bootAtStart: undefined,
        registeredCount: 0,
      }),
    ).toBe("reload");
  });

  it("reloads when the server was restarted under it", () => {
    expect(decideDevLinkAction({ ...linked, boot: "server-2" })).toBe("reload");
  });

  it("reloads when the registration never happened", () => {
    expect(decideDevLinkAction({ ...linked, registeredCount: 0 })).toBe(
      "reload",
    );
  });

  // One reload per generation. Coming back to the same state means something
  // else is wrong, and a loop would only hide it.
  it("reloads once per generation and then waits", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        boot: "server-2",
        reloadedForBoot: "server-2",
      }),
    ).toBe("waiting");
  });

  it("does not let a reload for an earlier generation excuse the next one", () => {
    expect(
      decideDevLinkAction({
        ...linked,
        boot: "server-3",
        reloadedForBoot: "server-2",
      }),
    ).toBe("reload");
  });
});
