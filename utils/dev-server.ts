// 開発サーバーの住所。1箇所にまとめてあるのは、3者がこれで一致していなければ
// ならないから＝wxt.config.ts（サーバーを起動する）・開発時の service worker
// （そこへ送る）・エンドポイントに答える Vite のプラグイン。
//
// 交渉せず固定してある。拡張機能はこの住所に対してビルドされるし、開発サーバーは
// 同時に1つしか立てられない＝2つ目がそれを知る手段がポートの奪い合い。
//
// ホストもその一致の一部で、両側で同じ綴りでなければならない。WXT の既定の
// 開発サーバーのホストは `localhost` で、この機械ではそれが ::1 に解決され、
// そこにしか束縛されない＝worker が 127.0.0.1 へ送ったものは全部拒まれ、
// 拡張機能が記録したものは1つもログファイルへ届かなかった（2026-08-02 に
// 確認・#31）。ホストを固定することで、worker のオリジン・manifest のホスト
// 権限・ページの CSP・HMR ソケットの名前が1つの住所になる。
export const DEV_SERVER_HOST = "127.0.0.1";
export const DEV_SERVER_PORT = 51732;
export const DEV_SERVER_ORIGIN = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
export const ERROR_LOG_ENDPOINT = "/__sift_error_log";
// どのサーバーのプロセスが立っているかを答える＝worker が「自分が繋がっている
// サーバー」と「自分より後に起動したサーバー」を見分けられるように。
// utils/dev-link.ts を参照。
export const DEV_PING_ENDPOINT = "/__sift_dev_ping";
