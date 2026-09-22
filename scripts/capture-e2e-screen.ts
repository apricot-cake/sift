import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const output = process.argv[2];
if (!output) {
  throw new Error("スクリーンショットの出力先を指定してください。");
}
if (!process.env.DISPLAY) {
  throw new Error(
    "仮想ディスプレイが無いため、Chrome の画面を撮影できません。",
  );
}

const absoluteOutput = path.resolve(output);
fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
execFileSync("import", ["-window", "root", absoluteOutput], {
  stdio: "inherit",
});
execFileSync("identify", [absoluteOutput], { stdio: "inherit" });
