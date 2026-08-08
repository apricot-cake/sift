// Run by `npm install` through the `prepare` script.
//
// Points git at the repository's own hooks directory, which is how
// .githooks/post-merge gets to run at all — git only looks in .git/hooks unless
// core.hooksPath says otherwise, and .git/hooks is not under version control.
//
// Never fails the install: a tarball, a CI checkout without git, or a machine
// with no git on PATH all reach here, and none of them need the hook.
import { execFileSync } from "node:child_process";

try {
  execFileSync("git", ["config", "core.hooksPath", ".githooks"], {
    stdio: "ignore",
  });
  console.log("[sift] git hooks: .githooks");
} catch {
  console.log(
    "[sift] skipped the git hooks setup (not a git checkout, or git is unavailable)",
  );
}
