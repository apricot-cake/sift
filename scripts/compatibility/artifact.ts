import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** ファイル名と内容をともに含め、検証後の追加・削除・変更を検知する。 */
export function artifactHash(directory: string): string {
  const hash = createHash("sha256");
  const walk = (relative: string): void => {
    const absolute = path.join(directory, relative);
    for (const name of fs.readdirSync(absolute).sort()) {
      const item = path.join(relative, name);
      const stat = fs.lstatSync(path.join(directory, item));
      if (stat.isSymbolicLink())
        throw new Error("成果物にシンボリックリンクは使えません");
      if (stat.isDirectory()) walk(item);
      else {
        const content = fs.readFileSync(path.join(directory, item));
        hash.update(
          JSON.stringify([item.replaceAll("\\", "/"), content.length]),
        );
        hash.update(content);
      }
    }
  };
  walk("");
  return hash.digest("hex");
}
