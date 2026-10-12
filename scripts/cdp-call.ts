import type { CDPSession } from "puppeteer-core";

/** 値はコードへ埋め込まず、CDPのCallArgumentとして渡す。 */
export async function callFunction(
  client: Pick<CDPSession, "send">,
  functionDeclaration: string,
  values: unknown[],
): Promise<unknown> {
  const root = await client.send("Runtime.evaluate", {
    expression: "globalThis",
  });
  if (root.exceptionDetails) throw Error(JSON.stringify(root.exceptionDetails));
  const objectId = root.result.objectId;
  if (!objectId) throw Error("CDP execution target missing");
  try {
    const result = await client.send("Runtime.callFunctionOn", {
      objectId,
      functionDeclaration,
      arguments: values.map((value) => ({ value })),
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } finally {
    await client.send("Runtime.releaseObject", { objectId });
  }
}
