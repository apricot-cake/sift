// The development server's address, in one place because three parties have to
// agree on it: wxt.config.js (which starts the server), the development service
// worker (which posts to it), and the Vite plugin that answers the endpoints.
//
// Fixed rather than negotiated. The extension is built against this address, and
// only one dev server can be up at a time — taking the port is how a second one
// finds out.
//
// THE HOST IS PART OF THAT AGREEMENT and has to be spelled the same way on both
// sides. WXT defaults the dev server host to `localhost`, which on this machine
// resolves to ::1 and binds there ONLY: everything the worker posted to
// 127.0.0.1 was refused, so nothing the extension recorded ever reached the log
// file (measured 2026-08-02, #31). Pinning the host makes the worker's origin,
// the manifest's host permission, the page CSP and the HMR socket name one
// address.
export const DEV_SERVER_HOST = "127.0.0.1";
export const DEV_SERVER_PORT = 51732;
export const DEV_SERVER_ORIGIN = `http://${DEV_SERVER_HOST}:${DEV_SERVER_PORT}`;
export const ERROR_LOG_ENDPOINT = "/__sift_error_log";
// Answers which server process is up, so the worker can tell "the server I am
// connected to" from "a server that started after I did". See utils/dev-link.js.
export const DEV_PING_ENDPOINT = "/__sift_dev_ping";
