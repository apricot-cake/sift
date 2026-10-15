import { expect, test, vi } from "vitest";
import { callFunction } from "./cdp-call.ts";

test("特殊文字をコードに混ぜず引数として渡し、参照を解放する", async () => {
  const value = `</script>"\\\n\u2028\${globalThis.injected=true}`;
  const send = vi
    .fn()
    .mockResolvedValueOnce({ result: { objectId: "root" } })
    .mockResolvedValueOnce({ result: { value } })
    .mockResolvedValueOnce({});
  const declaration = "function(value){return value;}";
  expect(await callFunction({ send }, declaration, [value])).toBe(value);
  expect(send.mock.calls).toEqual([
    ["Runtime.evaluate", { expression: "globalThis" }, undefined],
    [
      "Runtime.callFunctionOn",
      {
        objectId: "root",
        functionDeclaration: declaration,
        arguments: [{ value }],
        awaitPromise: true,
        returnByValue: true,
      },
      undefined,
    ],
    ["Runtime.releaseObject", { objectId: "root" }, undefined],
  ]);
});

test("実行先の例外でも参照を解放する", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ result: { objectId: "root" } })
    .mockResolvedValueOnce({ exceptionDetails: { text: "failed" } })
    .mockResolvedValueOnce({});
  await expect(callFunction({ send }, "function(){}", [])).rejects.toThrow(
    "failed",
  );
  expect(send).toHaveBeenLastCalledWith(
    "Runtime.releaseObject",
    {
      objectId: "root",
    },
    undefined,
  );
});

test("指定した応答上限を評価と参照解放の全コマンドに渡す", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ result: { objectId: "root" } })
    .mockResolvedValueOnce({ result: { value: true } })
    .mockResolvedValueOnce({});
  expect(
    await callFunction({ send }, "function(){return true}", [], 5000),
  ).toBe(true);
  expect(send.mock.calls.map((call) => call[2])).toEqual([
    { timeout: 5000 },
    { timeout: 5000 },
    { timeout: 5000 },
  ]);
});

test("実行先が取得できなければ呼び出さない", async () => {
  const send = vi.fn().mockResolvedValue({ result: {} });
  await expect(callFunction({ send }, "function(){}", [])).rejects.toThrow(
    "CDP execution target missing",
  );
  expect(send).toHaveBeenCalledTimes(1);
});

test("関数のglobalThis参照は指定した一意contextから取得する", async () => {
  const send = vi
    .fn()
    .mockResolvedValueOnce({ result: { objectId: "selected-context-root" } })
    .mockResolvedValueOnce({ result: { value: true } })
    .mockResolvedValueOnce({});
  expect(
    await callFunction(
      { send },
      "function(){return true}",
      [],
      5000,
      "selected-context",
    ),
  ).toBe(true);
  expect(send).toHaveBeenNthCalledWith(
    1,
    "Runtime.evaluate",
    {
      expression: "globalThis",
      uniqueContextId: "selected-context",
    },
    { timeout: 5000 },
  );
  expect(send.mock.calls[1]?.[1].objectId).toBe("selected-context-root");
});
