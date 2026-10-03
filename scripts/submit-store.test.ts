import { describe, expect, test, vi } from "vitest";
import {
  compareVersions,
  type Submission,
  submitStore,
} from "./submit-store.ts";

const submission: Submission = {
  publisherId: "publisher-123",
  extensionId: "a".repeat(32),
  accessToken: "test-token",
  version: "0.1.6",
  zip: new Uint8Array([80, 75]),
};
const status = {
  publishedItemRevisionStatus: {
    state: "PUBLISHED",
    distributionChannels: [{ crxVersion: "0.1.5" }],
  },
};

function responses(...bodies: unknown[]) {
  const fetchMock = vi.fn<typeof fetch>();
  for (const body of bodies) {
    fetchMock.mockResolvedValueOnce(Response.json(body));
  }
  return fetchMock;
}

describe("Chrome ウェブストアへの審査提出", () => {
  test("パスに使えない識別子は API を呼ぶ前に拒否する", async () => {
    for (const invalid of [
      { publisherId: "../another" },
      { extensionId: "z".repeat(32) },
    ]) {
      const fetchMock = responses();
      await expect(
        submitStore({ ...submission, ...invalid }, { fetch: fetchMock }),
      ).rejects.toThrow("CWS_");
      expect(fetchMock).not.toHaveBeenCalled();
    }
  });

  test("数値で比較し、省略された桁を 0 と扱う", () => {
    expect(compareVersions("1.10", "1.9")).toBe(1);
    expect(compareVersions("1.2", "1.2.0.0")).toBe(0);
  });

  test.each(["01.2", "0.0.0", "1.65536", "1.2.3.4.5", "1.2-beta"])(
    "不正なバージョン %s を送信前に拒否する",
    async (version) => {
      const fetchMock = responses();
      await expect(
        submitStore({ ...submission, version }, { fetch: fetchMock }),
      ).rejects.toThrow("バージョン");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  test("公開済み版と同版・旧版はアップロードしない", async () => {
    for (const version of ["0.1.5", "0.1.4"]) {
      const fetchMock = responses(status);
      await expect(
        submitStore({ ...submission, version }, { fetch: fetchMock }),
      ).rejects.toThrow("公開済み版より大きく");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    }
  });

  test.each(["PENDING_REVIEW", "STAGED"])(
    "%s の提出を上書きしない",
    async (state) => {
      const fetchMock = responses({
        ...status,
        submittedItemRevisionStatus: { state },
      });
      await expect(
        submitStore(submission, { fetch: fetchMock }),
      ).rejects.toThrow("提出済み");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  test("アップロード失敗では publish を呼ばない", async () => {
    const fetchMock = responses(status, { uploadState: "FAILED" });
    await expect(submitStore(submission, { fetch: fetchMock })).rejects.toThrow(
      "審査提出は実行していません",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("非同期アップロードの完了を待ち、承認後の自動公開を指定する", async () => {
    const fetchMock = responses(
      status,
      { uploadState: "IN_PROGRESS" },
      { ...status, lastAsyncUploadState: "IN_PROGRESS" },
      { ...status, lastAsyncUploadState: "SUCCEEDED" },
      status,
      { state: "PENDING_REVIEW" },
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    expect(await submitStore(submission, { fetch: fetchMock, sleep })).toBe(
      "PENDING_REVIEW",
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.at(-1)?.[1]?.body).toBe(
      JSON.stringify({ publishType: "DEFAULT_PUBLISH", blockOnWarnings: true }),
    );
    expect(fetchMock.mock.calls[1]?.[1]?.body).toBeInstanceOf(Blob);
  });

  test("非同期処理は上限を超えて待たず、publish しない", async () => {
    const fetchMock = responses(status, { uploadState: "IN_PROGRESS" });
    fetchMock.mockImplementation(async () =>
      Response.json({ ...status, lastAsyncUploadState: "IN_PROGRESS" }),
    );
    const sleep = vi.fn().mockResolvedValue(undefined);
    await expect(
      submitStore(submission, { fetch: fetchMock, sleep }),
    ).rejects.toThrow("審査提出は実行していません");
    expect(sleep).toHaveBeenCalledTimes(12);
    expect(
      fetchMock.mock.calls.some(([url]) => String(url).endsWith(":publish")),
    ).toBe(false);
  });

  test("ZIP のバージョン不一致では publish しない", async () => {
    const fetchMock = responses(status, {
      uploadState: "SUCCEEDED",
      crxVersion: "0.1.7",
    });
    await expect(submitStore(submission, { fetch: fetchMock })).rejects.toThrow(
      "一致しません",
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test("publish の拒否を成功扱いしない", async () => {
    const fetchMock = responses(
      status,
      { uploadState: "SUCCEEDED", crxVersion: "0.1.6" },
      status,
      { state: "REJECTED" },
    );
    await expect(submitStore(submission, { fetch: fetchMock })).rejects.toThrow(
      "審査提出の成功を確認できません",
    );
  });

  test("公開済みの応答も成功として区別する", async () => {
    const fetchMock = responses(
      status,
      { uploadState: "SUCCEEDED", crxVersion: "0.1.6" },
      status,
      { state: "PUBLISHED" },
    );
    expect(await submitStore(submission, { fetch: fetchMock })).toBe(
      "PUBLISHED",
    );
  });

  test("アップロード中に別途提出された場合は publish しない", async () => {
    const fetchMock = responses(
      status,
      { uploadState: "SUCCEEDED", crxVersion: "0.1.6" },
      { ...status, submittedItemRevisionStatus: { state: "PENDING_REVIEW" } },
    );
    await expect(submitStore(submission, { fetch: fetchMock })).rejects.toThrow(
      "提出済み",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  test("publish の通信失敗は再送せず、秘密情報をログへ出さない", async () => {
    const fetchMock = responses(
      status,
      { uploadState: "SUCCEEDED", crxVersion: "0.1.6" },
      status,
    );
    fetchMock.mockRejectedValueOnce(new Error("test-token"));
    await expect(submitStore(submission, { fetch: fetchMock })).rejects.toThrow(
      "ダッシュボードで状態を確認",
    );
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });
});
