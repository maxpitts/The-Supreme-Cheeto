/* Scheduled every 15 minutes by Netlify's cron. Not HTTP-invocable in production —
   use refresh-now for a manual pull. */
import { runRefresh } from "../lib/sources.mjs";

export default async () => {
  const started = Date.now();
  try {
    const result = await runRefresh();
    console.log("[cheeto] refresh ok", JSON.stringify({ ...result, tookMs: Date.now() - started }));
    return new Response(JSON.stringify(result), {
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    /* An unhandled throw here used to end the invocation with nothing written
       and nothing said: the blob kept its old value, the page kept serving it,
       and the only symptom was a clock that stopped. Whatever goes wrong, say
       so in a line that can be found by searching the function log for one
       word, and fail loudly enough that the platform records it. */
    console.error("[cheeto] refresh FAILED after", Date.now() - started, "ms:",
      err?.stack || err?.message || err);
    return new Response(JSON.stringify({ ok: false, error: String(err?.message || err) }),
      { status: 500, headers: { "content-type": "application/json" } });
  }
};

/* Every 5 minutes rather than 15. The read path repairs staleness anyway, so
   this is now the cheap path rather than the only one — and if the schedule
   starts firing again, most visitors never trigger a refresh themselves. */
export const config = { schedule: "*/5 * * * *" };
