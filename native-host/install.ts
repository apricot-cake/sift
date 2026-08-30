import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const HOST_NAME = "io.github.apricot_cake.sift.reload";
export const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";
const ROOT = path.resolve(import.meta.dirname, "..");
const HOST_SOURCE = path.join(import.meta.dirname, "reload-host.ts");

export function reloadHostDirectory(): string {
  return (
    process.env.SIFT_RELOAD_HOST_DIR ||
    path.join(ROOT, ".output", "native-host")
  );
}

export function buildStampPath(): string {
  return path.join(reloadHostDirectory(), "extension-build.json");
}

export function registryKey(): string {
  return `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${HOST_NAME}`;
}

export function windowsUserContextMatches(
  actualIdentity: string,
  userDomain: string | undefined,
  username: string | undefined,
): boolean {
  if (!userDomain || !username) return false;
  return (
    actualIdentity.trim().toLowerCase() ===
    `${userDomain}\\${username}`.toLowerCase()
  );
}

export function assertWindowsUserContext(operation: string): void {
  if (process.platform !== "win32") return;
  const actualIdentity = execFileSync("whoami.exe", [], {
    encoding: "utf8",
  });
  if (
    windowsUserContextMatches(
      actualIdentity,
      process.env.USERDOMAIN,
      process.env.USERNAME,
    )
  ) {
    return;
  }
  throw new Error(
    `${operation} はユーザー領域から隔離されたWindows実行環境では実行できません。` +
      "Chromeが読むHKCUへNative Hostを登録するため、コマンド全体をユーザー領域への書き込みが許可された実行としてやり直してください。",
  );
}

export function installReloadHost({
  register = true,
}: {
  register?: boolean;
} = {}): { manifest: string; launcher: string; host: string } {
  if (process.platform !== "win32") {
    throw new Error(
      "Sift のローカル自己リロードは Windows のみ対応しています。",
    );
  }

  const directory = reloadHostDirectory();
  const host = path.join(directory, "reload-host.ts");
  const launcher = path.join(directory, "sift-reload-host.cmd");
  const manifest = path.join(directory, `${HOST_NAME}.json`);
  fs.mkdirSync(directory, { recursive: true });
  fs.copyFileSync(HOST_SOURCE, host);
  fs.writeFileSync(
    launcher,
    [
      "@echo off",
      `set "SIFT_RELOAD_STAMP=${buildStampPath()}"`,
      `"${process.execPath}" "${host}" %*`,
      "",
    ].join("\r\n"),
    "utf8",
  );
  fs.writeFileSync(
    manifest,
    `${JSON.stringify(
      {
        name: HOST_NAME,
        description: "Sift local deployment reload host",
        path: launcher,
        type: "stdio",
        allowed_origins: [`chrome-extension://${EXTENSION_ID}/`],
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  if (register) {
    assertWindowsUserContext("Native Hostの登録");
    execFileSync(
      "reg.exe",
      ["add", registryKey(), "/ve", "/t", "REG_SZ", "/d", manifest, "/f"],
      { stdio: "ignore" },
    );
  }
  return { manifest, launcher, host };
}

export function publishBuildStamp(build: string, output: string): string {
  const file = buildStampPath();
  const temporary = `${file}.tmp`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(
    temporary,
    `${JSON.stringify(
      { build, output, builtAt: new Date().toISOString() },
      null,
      2,
    )}\n`,
    "utf8",
  );
  fs.renameSync(temporary, file);
  return file;
}
