// The sites Sift runs on. Declared once here because both the content script's
// own registration and anything that reasons about "the pages Sift touches" need
// the same list.
export const SITE_MATCHES = ["https://x.com/*", "https://twitter.com/*"];
