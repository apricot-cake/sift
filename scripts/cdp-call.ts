import type { CDPSession } from "puppeteer-core";

/** 値はコードへ埋め込まず、CDPのCallArgumentとして渡す。 */
export async function callFunction(
  client: Pick<CDPSession, "send">,
  functionDeclaration: string,
  values: unknown[],
  timeout?: number,
  uniqueContextId?: string,
): Promise<unknown> {
  const options = timeout === undefined ? undefined : { timeout };
  const root = await client.send(
    "Runtime.evaluate",
    {
      expression: "globalThis",
      ...(uniqueContextId === undefined ? {} : { uniqueContextId }),
    },
    options,
  );
  if (root.exceptionDetails) throw Error(JSON.stringify(root.exceptionDetails));
  const objectId = root.result.objectId;
  if (!objectId) throw Error("CDP execution target missing");
  try {
    const result = await client.send(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration,
        arguments: values.map((value) => ({ value })),
        awaitPromise: true,
        returnByValue: true,
      },
      options,
    );
    if (result.exceptionDetails)
      throw Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  } finally {
    await client.send("Runtime.releaseObject", { objectId }, options);
  }
}
