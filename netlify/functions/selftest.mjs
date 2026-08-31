/* Source self-test: GET /.netlify/functions/selftest
 *
 * Runs every source and reports what it ACTUALLY extracted, plus a sanity
 * verdict on each value. This exists because the HTML scrapers can't be tested
 * anywhere except from Netlify's own network — and because a regex that matches
 * the WRONG number fails silently, which is worse than one that matches nothing.
 *
 * Hit this after any deploy. Eyeball the values. If a number looks wrong, the
 * extractor for that source needs fixing in netlify/lib/sources.mjs.
 */
import { checkAll } from "../lib/sources.mjs";

export default async () => {
  const started = Date.now();
  const results = await checkAll();

  const rows = results.map((r) => {
    const mark = r.ok ? (r.sane ? "PASS" : "SUSPECT") : "FAIL";
    return { source: r.name, status: mark, value: r.value ?? null, note: r.note || null, ms: r.ms };
  });

  const summary = {
    ok: rows.every((r) => r.status === "PASS"),
    pass: rows.filter((r) => r.status === "PASS").length,
    suspect: rows.filter((r) => r.status === "SUSPECT").length,
    fail: rows.filter((r) => r.status === "FAIL").length,
    tookMs: Date.now() - started,
  };

  /* Plain-text output — easier to read in a browser tab than raw JSON. */
  const text =
    "THE SUPREME CHEETO — SOURCE SELF-TEST\n" +
    "=====================================\n" +
    `run at   : ${new Date().toISOString()}\n` +
    `verdict  : ${summary.pass} pass · ${summary.suspect} suspect · ${summary.fail} fail  (${summary.tookMs}ms)\n\n` +
    rows.map((r) =>
      `[${r.status.padEnd(7)}] ${r.source.padEnd(18)} ${r.ms}ms\n` +
      `            value: ${JSON.stringify(r.value)}\n` +
      (r.note ? `            note : ${r.note}\n` : "")
    ).join("\n") +
    "\nSUSPECT means the fetch worked but the number looks implausible —\n" +
    "the page probably restyled and the extractor is grabbing the wrong thing.\n" +
    "Fix the matching function in netlify/lib/sources.mjs.\n";

  return new Response(text, {
    status: summary.fail || summary.suspect ? 207 : 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};
