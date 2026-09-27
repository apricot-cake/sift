interface RuntimeResult {
  result: { objectId?: string; value?: unknown };
  exceptionDetails?: unknown;
}

interface RuntimeClient {
  call(method: string, params: Record<string, unknown>): Promise<RuntimeResult>;
}

/** 値はコードへ埋め込まず、CDPのCallArgumentとして渡す。 */
export async function callFunction(
  client: RuntimeClient,
  functionDeclaration: string,
  values: unknown[],
): Promise<unknown> {
  const root = await client.call("Runtime.evaluate", {
    expression: "globalThis",
  });
  if (root.exceptionDetails) throw Error(JSON.stringify(root.exceptionDetails));
  const objectId = root.result.objectId;
  if (!objectId) throw Error("CDP execution target missing");
  try {
    const result = await client.call("Runtime.callFunctionOn", {
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
    await client.call("Runtime.releaseObject", { objectId });
  }
}
