import { ensureReady } from "./extension-dev-control.js";
import {
  claimPreview,
  extensionDevConfig,
  readPreviewClaim,
  releasePreview,
  readinessSummary,
  samePath
} from "./extension-dev-common.js";

async function readInput() {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
  }

  try {
    return JSON.parse(input || "{}");
  } catch {
    return {};
  }
}

const hookInput = await readInput();
const hookEventName = hookInput.hook_event_name ?? "SessionStart";
const sessionId =
  hookInput.session_id ?? process.env.SIFT_DEV_SESSION_ID ?? null;
const timeoutMs = Number(process.env.SIFT_DEV_HOOK_TIMEOUT_MS ?? 15_000);
const repoRoot = extensionDevConfig.repoRoot;
const isMain = samePath(repoRoot, extensionDevConfig.mainRoot);

if (hookEventName === "SessionEnd") {
  if (sessionId) {
    await releasePreview({ sessionId });
  }
  process.exit(0);
}

let claim = readPreviewClaim();
let conflictReason = null;

if (!isMain && hookEventName === "SessionStart") {
  if (!sessionId) {
    conflictReason =
      "Sift preview requires a session ID before a worktree can claim it.";
  } else {
    const claimResult = await claimPreview({ repoRoot, sessionId });
    claim = claimResult.claim;
    if (!claimResult.claimed) {
      conflictReason =
        `Sift preview is owned by ${claim.repoRoot} ` +
        `(session=${claim.sessionId}).`;
    }
  }
}

if (!isMain && hookEventName === "PreToolUse") {
  if (
    !claim ||
    !samePath(claim.repoRoot, repoRoot) ||
    !sessionId ||
    claim.sessionId !== sessionId
  ) {
    conflictReason = claim
      ? `Sift preview is owned by ${claim.repoRoot} ` +
        `(session=${claim.sessionId}).`
      : "This worktree does not own the Sift preview.";
  }
}

if (isMain && hookEventName === "PreToolUse" && claim) {
  conflictReason =
    `Sift preview is serving ${claim.repoRoot} ` +
    `(session=${claim.sessionId}), not main.`;
}

if (conflictReason) {
  const reason =
    "Sift のプレビュー配信元を横取りしないため、ファイル変更を停止しました。" +
    ` ${conflictReason}`;

  if (hookEventName === "PreToolUse") {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      })
    );
  } else {
    console.log(
      JSON.stringify({
        systemMessage: reason,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: reason
        }
      })
    );
  }
  process.exit(0);
}

const expectedRepoRoot = isMain
  ? claim?.repoRoot ?? extensionDevConfig.mainRoot
  : repoRoot;
const readiness = await ensureReady({ expectedRepoRoot, timeoutMs });

if (readiness.ready) {
  if (hookEventName === "SessionStart") {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            `Sift extension development server is serving ${expectedRepoRoot}. ` +
            "Use dist-dev for live verification; dist is release output."
        }
      })
    );
  }
} else {
  const reason =
    "Sift の開発サーバーを準備できないため、ファイル変更を停止しました。" +
    ` ${readinessSummary(readiness)}.` +
    " `npm run ext:status` で確認し、必要なら " +
    "`npm run ext:register` または `npm run ext:restart` を実行してください。";

  if (hookEventName === "PreToolUse") {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: reason
        }
      })
    );
  } else {
    console.log(
      JSON.stringify({
        systemMessage: reason,
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext: reason
        }
      })
    );
  }
}
