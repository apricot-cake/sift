// `prepare` スクリプト経由で `npm install` が走らせる。
//
// git をこのリポジトリ自身のフックのディレクトリへ向ける＝そもそも
// .githooks/post-merge が走れるようになるのはこれのおかげ。core.hooksPath が
// 別を言わない限り git は .git/hooks しか見ないし、.git/hooks はバージョン管理の
// 外にある。
//
// 導入を失敗させることはない＝tarball も、git の無い CI のチェックアウトも、
// PATH に git が無い機械も、どれもここへ来るし、どれもこのフックを必要としない。
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "ignore",
  });
  console.log("[sift] git のフック: .githooks");
} catch {
  console.log(
    "[sift] git のフックの設定を飛ばした（git の作業コピーでないか、git が使えない）",
  );
}
