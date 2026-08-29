// `npm run dev`＝WXT の開発サーバー。開発ビルドを、この作業ツリーの
// .output/chrome-mv3-dev へ書く。
//
// 生成物をソースの作業ツリーに所属させる＝Git 管理からは除外するが、別の
// worktree が同じ外部フォルダを上書きすることはない。worktree を切り替える場合は、
// 開発用 Chrome もその worktree の出力を読み込む。
//
// ここが `wxt` の CLI を呼び出しているのは、最初の版がやっていた WXT の JS API を
// 呼ぶやり方が駄目だったから。`createServer().start()` はサーバーが待ち受けを
// 始めた時点で解決し、イベントループを掴むものを何も残さないので、プロセスは
// すぐ終わり、ファイルを変えても一度もビルドし直されなかった。CLI は WXT 自身の
// 文書が説明しているものでもあるので、`npm run dev` はその文書の言うとおりに
// 振る舞う＝Ctrl+C も、キー割り当ても、全部。
//
// 機械ごとに最初の1回だけ、開発用プロファイルで行うこと。
//   1. npm run dev:browser
//   2. chrome://extensions → デベロッパーモード → パッケージ化されていない拡張
//      機能を読み込む → 下の置き場
//   3. X にサインインする
//
// 拡張機能の id はリリースビルドと同じなので（署名鍵が固定されている）、両方を
// 同じプロファイルへ読み込まないこと＝プロファイルを分けてあるのはそのため。
import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEV_SERVER_HOST, DEV_SERVER_PORT } from "../utils/dev-server.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output =
  process.env.SIFT_DEV_OUTPUT || path.join(ROOT, ".output", "chrome-mv3-dev");

// もう立っているか。TCP で繋がるかどうかで足りる＝ここが知りたいのは、そのポートを
// 誰かが持っているかどうかだけ。
//
// ホストをここに書かず utils/dev-server.ts から取っているのは、あのファイルが
// 挙げている理由から＝この機械では `localhost` が ::1 に解決されるので、
// 127.0.0.1 を埋め込んだ問い合わせは、もう一方に束縛されたサーバーに対して、
// 動いているサーバーを落ちていると報告する。隣のプロジェクトがまさにそれで、
// 「開発サーバーが応答しない」という警告は、出るたびに間違っていた（2026-08-04）。
function devServerAlive(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({
      port: DEV_SERVER_PORT,
      host: DEV_SERVER_HOST,
    });
    const finish = (alive: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(alive);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

// もう立っているなら、この呼び出しはそこで終わり。ポートは全 worktree で共通なので、
// 別の worktree へ切り替える場合は、先に現在の開発サーバーを止める。2つ目を起動して
// ポートで失敗するか、呼び手が起動できたと誤認する窓を開けない。
//
// 覚えておく手順ではなくコマンドの中に置いてあるのは、人に対しては「動いて
// いるか」にタスクバーが答えるが、エージェントはタスクバーを見られないし、
// チェックリストに書いた手順は読まれている間しか働かないから。
if (await devServerAlive()) {
  console.log(
    `[sift] 開発サーバーは ${DEV_SERVER_HOST}:${DEV_SERVER_PORT} で既に立っている＝手を出さない。`,
  );
  console.log(
    "[sift] 別の worktree へ切り替える場合は、現在のサーバーを止めてから起動する。",
  );
  process.exit(0);
}

console.log(`[sift] 開発ビルドの置き場: ${output}`);
console.log(
  "[sift] その置き場を、開発用の Chrome プロファイルへパッケージ化されていない拡張機能として読み込む（一度だけ）。",
);

// WXT の CLI はキー割り当てのために stdin を読み、閉じた stdin はサーバーを
// 終わらせる＝端末を持たないもの（エージェント・タスクの実行役・CI）から起動
// すると、最初のビルドを表示して終了し、保存しても一度もビルドし直されなかった
// （2026-08-02 に確認）。パイプは、開いたまま何も届けない stdin であり、それが
// まさにそういう呼び手の欲しいもの。
//
// 本物の端末には今も `inherit` を渡す＝自分で `npm run dev` と打った人にとって
// キー割り当てが効くのはそれのおかげだから。上の切り離した窓もそこに入る＝
// コンソールを持っているので、そちらでもキー割り当ては効く。
const stdin = process.stdin.isTTY ? "inherit" : "pipe";

// 引数の配列ではなく1つの文字列で渡す＝Windows では `npx` が .cmd で、Node は
// シェル無しではこれを起動しないし、シェル付きの execFileSync 経由でも起動を
// 拒む。そして `shell: true` と一緒に引数の配列を渡すと DEP0190 が出る。
const child = spawn("npx wxt", {
  cwd: ROOT,
  shell: true,
  stdio: [stdin, "inherit", "inherit"],
  env: { ...process.env, SIFT_DEV_OUTPUT: output },
});

// Ctrl+C は、死んだ親の後ろにサーバーを取り残すのではなく、サーバーまで届かな
// ければならない。
const forwardedSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
for (const signal of forwardedSignals) {
  process.on(signal, () => child.kill(signal));
}

child.on("exit", (code, signal) => {
  process.exit(signal ? 1 : (code ?? 0));
});
