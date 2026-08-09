// 開発サーバーのもう半分＝service worker がエラーのバッファを送る先の
// エンドポイントと、それが叩く生存確認。`serve` にだけ当たる Vite の
// プラグインで、これを差し込むのは wxt.config.ts。
//
// scripts/ ではなくここにあるのは、これが一度も実行されないから＝scripts/ は
// node が直接動かすもの（`npm run dev`・`npm run deploy`・
// `npm run verify:manifest`）で、こちらはビルドの設定から読み込まれる。
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import { DEV_PING_ENDPOINT, ERROR_LOG_ENDPOINT } from "../utils/dev-server.ts";

export const DEFAULT_ERROR_LOG_PATH = path.join(
  os.homedir(),
  ".sift",
  "extension-errors.log",
);

const BODY_LIMIT_BYTES = 512 * 1024;

export function formatErrorLogLines(entries: unknown): string {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${JSON.stringify(entry)}\n`)
    .join("");
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;

    request.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT_BYTES) {
        reject(new Error("開発時のエラーログの本文が大きすぎる。"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.once("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.once("error", reject);
  });
}

// 拡張機能の service worker はこれを chrome-extension://<id> から取りに来るので、
// 応答が自分で許可を運ばなければならない。オリジンの方針はサーバー自身の CORS
// 設定に合わせてある。
function allowExtensionOrigin(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  const origin = request.headers.origin;
  if (typeof origin === "string" && origin.startsWith("chrome-extension://")) {
    response.setHeader("access-control-allow-origin", origin);
    response.setHeader("vary", "origin");
  }
}

export interface DevErrorLogOptions {
  logPath?: string;
  isBuilt?: () => boolean;
}

// 拡張機能が集めた、捕まえ損ねた例外を受け取り、~/.sift/extension-errors.log へ
// JSON Lines として書き足す。この一連の目的はこのファイルそのもの＝Chrome 自身の
// エラー欄はブラウザの外から読めないので、ディスク上のファイルが無ければ、
// 拡張機能の中の例外はどんな自動診断からも見えない。
//
// このエンドポイントは Vite 自身のミドルウェアより前に登録される＝だから
// サーバーの cors 設定が先に走るのを当てにせず、自分で CORS に答えている。
export function devErrorLog({
  logPath = DEFAULT_ERROR_LOG_PATH,
  isBuilt = () => true,
}: DevErrorLogOptions = {}): Plugin {
  // このサーバーのプロセスを拡張機能に対して名乗るためのもの。自分が起動した
  // ときのものと違う id を見た worker は、自分の HMR ソケットがもう居ない
  // サーバーのものであり、立っている方へ繋ぎ直すには自分を起動し直すしかないと
  // 分かる（#31）。
  const boot = randomUUID();

  return {
    name: "sift:dev-error-log",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(DEV_PING_ENDPOINT, (request, response, next) => {
        if (request.method !== "GET") {
          next();
          return;
        }
        allowExtensionOrigin(request, response);
        response.setHeader("content-type", "application/json");
        response.setHeader("cache-control", "no-store");
        // `ready` は worker の自己再読み込みの門。サーバーは待ち受けを始めた
        // 時点で答えるが、起動すること自体がビルドの置き場を消して書き直す＝
        // そして中身が一瞬空の状態で展開済み拡張機能を再読み込みすると、
        // 再試行ではなく失敗する。Chrome は拡張機能を降ろし、manifest が無いと
        // いうダイアログを出す（2026-08-02 に確認・#31）。だから worker には、
        // 読み込み直す先ができるまで待てと伝える。
        response.end(JSON.stringify({ boot, ready: isBuilt() }));
      });

      server.middlewares.use(
        ERROR_LOG_ENDPOINT,
        async (request, response, next) => {
          if (request.method === "OPTIONS") {
            allowExtensionOrigin(request, response);
            response.setHeader("access-control-allow-methods", "POST, OPTIONS");
            response.setHeader("access-control-allow-headers", "content-type");
            response.statusCode = 204;
            response.end();
            return;
          }

          if (request.method !== "POST") {
            next();
            return;
          }

          allowExtensionOrigin(request, response);

          try {
            const entries = JSON.parse(await readBody(request));
            const lines = formatErrorLogLines(entries);
            if (lines !== "") {
              fs.mkdirSync(path.dirname(logPath), { recursive: true });
              fs.appendFileSync(logPath, lines, "utf8");
            }
            response.statusCode = 204;
            response.end();
          } catch (error) {
            server.config.logger.warn(
              `[sift] 拡張機能のエラーログを書けなかった: ${error instanceof Error ? error.message : String(error)}`,
            );
            response.statusCode = 400;
            response.end();
          }
        },
      );
    },
  };
}
