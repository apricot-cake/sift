// Sift が対応する Misskey ホスト。manifest の権限と content script の
// 配布先を同じ一覧から導く。
export const MISSKEY_HOSTS: readonly string[] = Object.freeze(["misskey.io"]);

export function originForHost(host: string): string {
  return `https://${host}/*`;
}
