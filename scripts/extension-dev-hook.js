import { ensureReady } from "./extension-dev-control.js";
import { readinessSummary } from "./extension-dev-common.js";

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
const timeoutMs = Number(process.env.SIFT_DEV_HOOK_TIMEOUT_MS ?? 15_000);
const readiness = await ensureReady({ timeoutMs });

if (readiness.ready) {
  if (hookEventName === "SessionStart") {
    console.log(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "SessionStart",
          additionalContext:
            "Sift extension development server is ready. Use dist-dev for live verification; dist is release output."
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
