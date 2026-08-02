// The development server's address, in one place because three parties have to
// agree on it: wxt.config.js (which starts the server), the development service
// worker (which posts to it), and the Vite plugin that answers the endpoint.
//
// Fixed rather than negotiated. The extension is built against this address, and
// only one dev server can be up at a time — taking the port is how a second one
// finds out.
export const DEV_SERVER_PORT = 51732;
export const DEV_SERVER_ORIGIN = `http://127.0.0.1:${DEV_SERVER_PORT}`;
export const ERROR_LOG_ENDPOINT = "/__sift_error_log";
