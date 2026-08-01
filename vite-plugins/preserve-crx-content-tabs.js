import { CONTENT_RUNTIME_KEY } from "../src/content/runtime-key.js";

const CONTENT_HMR_PORT_ID = "/@crx/client-port";
const EXPECTED_RELOAD_CALLS = 2;

export function replaceCrxPageReloads(code) {
  const reloadCall = "location.reload()";
  const reloadCount = code.split(reloadCall).length - 1;

  if (reloadCount !== EXPECTED_RELOAD_CALLS) {
    throw new Error(
      `[sift] Expected ${EXPECTED_RELOAD_CALLS} CRXJS page reload calls, found ${reloadCount}`
    );
  }

  const disposeRuntime =
    `globalThis[Symbol.for(${JSON.stringify(CONTENT_RUNTIME_KEY)})]?.dispose({ showReloadNotice: true })`;
  return code.replaceAll(reloadCall, disposeRuntime);
}

export function preserveCrxContentTabs() {
  return {
    name: "sift:preserve-crx-content-tabs",
    apply: "serve",
    enforce: "post",
    transform(code, id) {
      if (id !== CONTENT_HMR_PORT_ID) {
        return null;
      }

      return {
        code: replaceCrxPageReloads(code),
        map: null
      };
    }
  };
}
