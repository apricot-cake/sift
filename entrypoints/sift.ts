import { selectAdapter } from "../utils/adapters/index.ts";
import { startContentRuntime } from "../utils/content-runtime.ts";

export default defineUnlistedScript(() => {
  const runtimeKey = "__siftContentRuntimeStarted__";
  const page = globalThis as typeof globalThis & Record<string, boolean>;
  if (page[runtimeKey]) {
    return;
  }
  page[runtimeKey] = true;
  startContentRuntime(undefined, selectAdapter(location.hostname));
});
