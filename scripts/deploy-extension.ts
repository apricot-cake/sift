// `npm run deploy`＝検査を通ったリリースビルドを、日常の Chrome が読み込んで
// いる置き場へ入れる。
//
// .output/chrome-mv3 へ書くのはこれだけ。日常のブラウザが載せるのはリリース
// ビルドだけで、他は載せない＝開発は別の Chrome プロファイルで、別の出力先に
// 対して行われる（wxt.config.ts）ので、日常の拡張機能が開発サーバーの生死に
// 依存することはないし、検査に落ちたビルドがそこへ届くこともない。
//
// 誰が呼ぶか＝post-merge のフック（.githooks/post-merge）。main が「主の」作業
// ツリーへ取り込まれた後に走る＝つまり作者が日常で使うのは、main へ最後に着地
// したもの。手で走らせても問題ない。
//
// ブラウザはどうやって気付くか＝自分では気付かない。Chrome は展開済み拡張機能の
// ファイルが変わっても読み直さないので、新しいビルドが動き始めるのは次にブラウザ
// が起動したときか、chrome://extensions の再読み込みボタンが押されたとき。これは
// 意図した選択（Issue #20）＝拡張機能に自分を再読み込みさせることはできる（取り
// にいくビルド id のファイルがあれば足りる）が、それで浮くのはクリック1回きりで、
// 代わりにリリース用の service worker と、フィルタの途中のタブを待たせる規則を
// 抱えることになる。
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RELEASE = path.join(ROOT, ".output", "chrome-mv3-release");
const DAILY = path.join(ROOT, ".output", "chrome-mv3");

// 配るのは、行き先がブラウザの読み込んでいる置き場である場合だけ。繋いだ
// worktree は誰も読まない自分の .output を持っていて、そこへ書くのは、どこにも
// 届かない配布になる。
//
// `.git` は主の作業ツリーではディレクトリ、繋いだ方ではファイル＝git 自身が同じ
// ことを言っている。
function isMainWorkingTree() {
  try {
    return fs.statSync(path.join(ROOT, ".git")).isDirectory();
  } catch {
    return true; // そもそも git の作業コピーではない＝守るものが無い
  }
}

function listFiles(root: string, base: string = root): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFiles(absolute, base));
    else files.push(path.relative(base, absolute));
  }
  return files;
}

// 用意した置き場を名前の付け替えで所定の位置へ入れるのではなく、その場で
// ファイル1つずつ置き換える。名前の付け替えは入れ替えを不可分にする普通の手だが、
// ここでは使えない＝展開済み拡張機能が読み込まれている間、Chrome はこの
// ディレクトリのハンドルを開いたまま持つので、Windows は付け替えを EPERM で
// 失敗させる。ハンドルを解放するために拡張機能を降ろすと、この経路全体で浮く
// より多くのクリックがかかる。
//
// その場での置き換えが安全なのは、ブラウザがそう言われるまで誰もこの置き場を
// 読まないから＝そしてブラウザがそう言われるのは、これが終わった後に起動し直され
// るか再読み込みされるとき。前のビルドが持っていてこのビルドが持たないファイルは
// 消すので、名前の変わったエントリポイントが居残って名前で注入されることはない。
function swapIn(source: string, destination: string): void {
  fs.mkdirSync(destination, { recursive: true });
  const wanted = new Set(listFiles(source));
  for (const stale of listFiles(destination)) {
    if (!wanted.has(stale))
      fs.rmSync(path.join(destination, stale), { force: true });
  }
  fs.cpSync(source, destination, { recursive: true, force: true });
  for (const entry of fs.readdirSync(destination, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const absolute = path.join(destination, entry.name);
    if (!listFiles(absolute, destination).length)
      fs.rmSync(absolute, { recursive: true, force: true });
  }
}

if (!isMainWorkingTree()) {
  console.log(
    "[sift] 主の作業ツリーではない＝配布を飛ばす（この出力先を読み込んでいるブラウザは無い）",
  );
  process.exit(0);
}

// 先にビルドして検査する＝日常の置き場へ届くものが、検査を通っていないバンドルで
// あることは一度も無い。
//
// 引数の配列ではなく1つの文字列で渡す。Windows では `npm` が `npm.cmd` で、Node
// はシェル無しではこれをそもそも起動しないし、`execFileSync` とシェルの組でも
// 起動を拒む（18.20 / 20.12 の .cmd 注入の修正以降 EINVAL）。`shell: true` と
// 一緒に引数の配列を渡すと動きはするが、配布のたびに DEP0190 の非推奨の警告が
// 出る＝post-merge のフックが走らせる分も含めて。そこでは、その雑音が git pull の
// 途中に落ちてくる。
execSync("npm run build", { cwd: ROOT, stdio: "inherit" });

swapIn(RELEASE, DAILY);
console.log(`[sift] 検査を通ったリリースを ${DAILY} へ配った`);
console.log(
  "[sift] 日常の Chrome がこれを拾うのは、次に起動したときか、chrome://extensions で再読み込みしたとき。",
);
