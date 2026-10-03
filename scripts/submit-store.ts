import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";

type Revision = {
  state?: string;
  distributionChannels?: { crxVersion?: string }[];
};
type StoreStatus = {
  publishedItemRevisionStatus?: Revision;
  submittedItemRevisionStatus?: Revision;
  lastAsyncUploadState?: string;
  takenDown?: boolean;
  warned?: boolean;
};

export type Submission = {
  publisherId: string;
  extensionId: string;
  accessToken: string;
  version: string;
  zip: Uint8Array<ArrayBuffer>;
};

function versionParts(version: string): number[] {
  if (!/^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/.test(version)) {
    throw new Error("Chrome のバージョン形式が不正です。");
  }
  const parts = version.split(".").map(Number);
  if (parts.some((part) => part > 65535) || parts.every((part) => part === 0)) {
    throw new Error(
      "Chrome のバージョンは 0〜65535 の整数で、全桁 0 は使えません。",
    );
  }
  return Array.from({ length: 4 }, (_, index) => parts[index] ?? 0);
}

export function compareVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < 4; index++) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

function checkStatus(status: StoreStatus, version: string): void {
  if (status.takenDown || status.warned) {
    throw new Error(
      "ストアにポリシー違反の通知があります。ダッシュボードを確認してください。",
    );
  }
  const submitted = status.submittedItemRevisionStatus;
  if (submitted && !["REJECTED", "CANCELLED"].includes(submitted.state ?? "")) {
    throw new Error(
      "提出済みの版があります。審査・公開状態を確認してください。",
    );
  }
  const published = status.publishedItemRevisionStatus;
  if (
    published?.state !== "PUBLISHED" ||
    !published.distributionChannels?.length
  ) {
    throw new Error(
      "公開済みの版を確認できません。既存の公開アイテムの更新だけに対応しています。",
    );
  }
  for (const channel of published.distributionChannels) {
    if (
      !channel.crxVersion ||
      compareVersions(version, channel.crxVersion) <= 0
    ) {
      throw new Error(
        "提出するバージョンは全配信チャネルの公開済み版より大きくしてください。",
      );
    }
  }
}

export async function submitStore(
  submission: Submission,
  dependencies: {
    fetch?: typeof fetch;
    sleep?: (milliseconds: number) => Promise<unknown>;
  } = {},
): Promise<"PENDING_REVIEW" | "PUBLISHED"> {
  const { publisherId, extensionId, accessToken, version, zip } = submission;
  if (!/^[A-Za-z0-9_-]+$/.test(publisherId)) {
    throw new Error("CWS_PUBLISHER_ID が不正です。");
  }
  if (!/^[a-p]{32}$/.test(extensionId)) {
    throw new Error("CWS_EXTENSION_ID は a〜p の32文字で指定してください。");
  }
  if (!accessToken || zip.byteLength === 0) {
    throw new Error("アクセストークンまたは ZIP がありません。");
  }
  versionParts(version);
  const fetchApi = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? setTimeout;
  const name = `publishers/${publisherId}/items/${extensionId}`;
  const base = "https://chromewebstore.googleapis.com";
  const request = async (url: string, init: RequestInit = {}) => {
    let response: Response;
    try {
      response = await fetchApi(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${accessToken}`,
        },
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // 認証情報や API レスポンスを実行ログへ出さない。変更を伴う要求は再送しない。
      throw new Error(
        "ストア API の要求に失敗しました。ダッシュボードで状態を確認してから再実行してください。",
      );
    }
    if (!response.ok) {
      throw new Error(
        `ストア API が HTTP ${response.status} を返しました。ダッシュボードで状態を確認してください。`,
      );
    }
    try {
      return await response.json();
    } catch {
      throw new Error(
        "ストア API の応答形式が不正です。ダッシュボードで状態を確認してください。",
      );
    }
  };
  const fetchStatus = (): Promise<StoreStatus> =>
    request(`${base}/v2/${name}:fetchStatus`);
  const initialStatus = await fetchStatus();
  checkStatus(initialStatus, version);
  if (initialStatus.lastAsyncUploadState === "IN_PROGRESS") {
    throw new Error("別のアップロードが処理中です。");
  }
  const upload = (await request(`${base}/upload/v2/${name}:upload`, {
    method: "POST",
    headers: { "Content-Type": "application/zip" },
    body: new Blob([zip]),
  })) as { uploadState?: string; crxVersion?: string };
  let uploadState = upload.uploadState;
  if (uploadState === "SUCCEEDED" && upload.crxVersion !== version) {
    throw new Error(
      "アップロードした ZIP のバージョンが提出指定と一致しません。",
    );
  }
  for (
    let attempt = 0;
    uploadState === "IN_PROGRESS" && attempt < 12;
    attempt++
  ) {
    await sleep(5_000);
    const status = await fetchStatus();
    checkStatus(status, version);
    uploadState = status.lastAsyncUploadState;
  }
  if (uploadState !== "SUCCEEDED") {
    throw new Error(
      "アップロードの成功を確認できません。審査提出は実行していません。",
    );
  }
  // アップロード中にダッシュボードから提出された場合も上書きしない。
  checkStatus(await fetchStatus(), version);
  const published = (await request(`${base}/v2/${name}:publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      publishType: "DEFAULT_PUBLISH",
      blockOnWarnings: true,
    }),
  })) as { state?: string };
  if (published.state !== "PENDING_REVIEW" && published.state !== "PUBLISHED") {
    throw new Error(
      "審査提出の成功を確認できません。ダッシュボードを確認してください。",
    );
  }
  return published.state;
}

function requiredEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} を設定してください。`);
  return value;
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
  try {
    const state = await submitStore({
      publisherId: requiredEnvironment("CWS_PUBLISHER_ID"),
      extensionId: requiredEnvironment("CWS_EXTENSION_ID"),
      accessToken: requiredEnvironment("CWS_ACCESS_TOKEN"),
      version: requiredEnvironment("CWS_VERSION"),
      zip: await readFile(requiredEnvironment("CWS_ZIP_PATH")),
    });
    console.log(
      state === "PUBLISHED"
        ? "Chrome ウェブストア: 公開済みです。"
        : "Chrome ウェブストア: 審査提出済みです。審査承認・公開完了ではありません。承認後は自動公開されます。",
    );
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "ストア提出に失敗しました。",
    );
    process.exitCode = 1;
  }
}
