import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const output = process.argv[2];
if (!output) {
  throw new Error("スクリーンショットの出力先を指定してください。");
}
const absoluteOutput = path.resolve(output);
fs.mkdirSync(path.dirname(absoluteOutput), { recursive: true });
if (process.platform !== "win32") {
  throw new Error(`Windows E2E を実行できない OS: ${process.platform}`);
}
execFileSync(
  "dotnet",
  [
    "run",
    "--no-build",
    "--configuration",
    "Release",
    "--project",
    path.join(
      import.meta.dirname,
      "..",
      "tests",
      "windows-e2e",
      "Sift.WindowsE2E.csproj",
    ),
    "--",
    "capture",
    absoluteOutput,
  ],
  { stdio: "inherit" },
);
