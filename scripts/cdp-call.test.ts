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
    ["Runtime.evaluate", { expression: "globalThis" }],
    [
      "Runtime.callFunctionOn",
      {
        objectId: "root",
        functionDeclaration: declaration,
        arguments: [{ value }],
        awaitPromise: true,
        returnByValue: true,
      },
    ],
    ["Runtime.releaseObject", { objectId: "root" }],
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
  expect(send).toHaveBeenLastCalledWith("Runtime.releaseObject", {
    objectId: "root",
  });
});

test("実行先が取得できなければ呼び出さない", async () => {
  const send = vi.fn().mockResolvedValue({ result: {} });
  await expect(callFunction({ send }, "function(){}", [])).rejects.toThrow(
    "CDP execution target missing",
  );
  expect(send).toHaveBeenCalledTimes(1);
});
