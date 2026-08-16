const body = process.env.PR_BODY ?? "";

if (body.includes("\\n")) {
  console.error("PR 本文には実際の改行を使う。文字列としての \\n は使わない。");
  process.exitCode = 1;
}
