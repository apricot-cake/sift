import { homedir } from "node:os";
import path from "node:path";
import { readDevBrowserEndpoint } from "./dev-browser-endpoint.ts";

const PROFILE =
  process.env.SIFT_DEV_PROFILE || path.join(homedir(), ".sift-ext-profile");
const EXTENSION_ID = "bohbpocokkfioejlabmeaimpkpmablkm";
const PANEL_URL = `chrome-extension://${EXTENSION_ID}/sidepanel.html`;

interface CdpTarget {
  readonly type: string;
  readonly url: string;
  readonly webSocketDebuggerUrl: string;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function cdpCall<T>(
  webSocketDebuggerUrl: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(webSocketDebuggerUrl);
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error(`CDP ${method} が時間内に応答しなかった。`));
    }, 5_000);
    const finish = (callback: () => void) => {
      clearTimeout(timeout);
      socket.close();
      callback();
    };
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== 1) return;
      if (message.error) {
        finish(() => reject(new Error(message.error.message ?? method)));
      } else {
        finish(() => resolve(message.result as T));
      }
    });
    socket.addEventListener("error", () => {
      finish(() => reject(new Error(`CDP ${method} の接続に失敗した。`)));
    });
  });
}

async function panelTarget(): Promise<CdpTarget> {
  const endpoint = await readDevBrowserEndpoint(PROFILE);
  if (endpoint === null) {
    throw new Error("E2E 用 Chrome の CDP 接続先を取得できない。");
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await fetch(`${endpoint.url}/json/list`);
    if (!response.ok) {
      throw new Error("CDP からサイドパネルのターゲット一覧を読めない。");
    }
    const targets = (await response.json()) as CdpTarget[];
    const target = targets.find(
      (candidate) =>
        candidate.url === PANEL_URL && candidate.webSocketDebuggerUrl,
    );
    if (target) return target;
    await delay(250);
  }
  throw new Error(
    "実際に開いた Sift サイドパネルの CDP ターゲットを取得できない。",
  );
}

interface PanelInspection {
  readonly root: boolean;
  readonly controls: boolean;
  readonly enabled: boolean;
  readonly numberInputs: number;
  readonly switches: number;
}

const target = await panelTarget();
const result = await cdpCall<{ result: { value?: PanelInspection } }>(
  target.webSocketDebuggerUrl,
  "Runtime.evaluate",
  {
    expression: `(() => {
      const root = document.querySelector("main[data-sift-sidepanel]");
      const controls = root?.querySelector("[data-filter-controls]");
      const fieldset = controls?.querySelector("fieldset");
      return {
        root: root !== null,
        controls: controls !== null,
        enabled: fieldset instanceof HTMLFieldSetElement && !fieldset.disabled,
        numberInputs: controls?.querySelectorAll('input[type="number"]').length ?? 0,
        switches: controls?.querySelectorAll('[role="switch"]').length ?? 0,
      };
    })()`,
    returnByValue: true,
  },
);
const inspection = result.result.value;
if (
  !inspection?.root ||
  !inspection.controls ||
  !inspection.enabled ||
  inspection.numberInputs < 1 ||
  inspection.switches < 1
) {
  throw new Error(
    `サイドパネルの描画またはフィルター操作部が不完全: ${JSON.stringify(inspection)}`,
  );
}

console.log(
  `[sift] サイドパネルの描画を確認した: 数値入力 ${inspection.numberInputs}、スイッチ ${inspection.switches}`,
);
