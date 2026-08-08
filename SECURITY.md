# Security Policy

## Supported versions

Sift is not published to the Chrome Web Store yet; it is installed unpacked from a local build. Security fixes land on `main`, and only the current state of `main` is maintained. Older builds are not patched in parallel.

## Reporting a vulnerability

Please report security issues privately through GitHub, using the **[Report a vulnerability](https://github.com/apricot-cake/sift/security/advisories/new)** button on this repository's Security tab.

**Do not open a regular issue or pull request for a security problem.** Reproduction steps, proof-of-concept code, and details of an unfixed weakness are all things that should stay private until a fix is available.

Useful things to include, as far as you can:

- Which service the page belonged to (X, Bluesky, or a Misskey instance you added)
- The commit you built from, and your OS and Chrome version
- What an attacker gains, and what access they need to get there
- Steps to reproduce

## What to expect

Reports are reviewed privately in a draft security advisory. We will confirm the report, work on a fix there, and coordinate disclosure once a fixed version is available.

We do not commit to a fixed response time or a fixed patch deadline. Whether an advisory is published, and whether a CVE is requested, is decided per case.

## Scope notes

Sift reads the posts already rendered on the page you are looking at, and hides the ones that do not match your settings. It does not scroll for you, does not collect in the background, does not call any unofficial API, and does not store or transmit post content. The only thing it saves is your own settings, in Chrome's sync storage.

Reports that are especially relevant include anything that lets a page reach beyond that: post content leaving the browser, a host gaining the extension's privileges, the extension acting on a site it was not granted, or a Misskey host added by the reader escalating into permissions the reader did not approve.

Vulnerabilities in third-party dependencies should be reported to the project that maintains them. If a dependency issue affects Sift specifically — for example through how we call it — a report here is welcome.
