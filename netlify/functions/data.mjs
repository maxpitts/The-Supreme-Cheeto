/* Public read endpoint the page polls: GET /.netlify/functions/data
   Returns whatever the last successful refresh stored — and, if that is too
   old, refreshes it on the way past.

   WHY A READ NOW REFRESHES
   The scheduled function every 15 minutes is the normal path, and it is still
   the one that does the work almost every time. But a cron alone is a single
   point of failure with nothing watching it: the day it stops firing, the site
   serves the last good blob forever and looks frozen. That is exactly what
   happened — the data sat at 16:00 for an hour and a half while the page
   dutifully re-polled every five minutes and got the same stale answer back,
   because the page was never the problem.

   So freshness no longer depends on the cron alone. If a visitor arrives and
   the data is older than the schedule should ever allow, that request pulls it
   itself. A missed fire is repaired by the next visitor, and the worst case
   degrades from "frozen until a human notices" to "one person waits two
   seconds".
*/
import { getStore } from "@netlify/blobs";
import { STORE, KEY, runRefresh } from "../lib/sources.mjs";

/* The cron is every 15 minutes; 20 lets a fire run late without every
   straggler triggering a second pull. */
const STALE_MS = 20 * 60 * 1000;

/* One refresh at a time. A burst of visitors arriving on a stale blob must not
   become a burst of scrapes against Treasury, AAA and the rest — that is how a
   site gets itself blocked by the sources it depends on. */
const LOCK_KEY = "refresh-lock";
const LOCK_MS = 120 * 1000;

async function refreshUnlessSomeoneElseIs(store) {
  let lock = null;
  try { lock = await store.get(LOCK_KEY, { type: "json" }); } catch { /* absent is fine */ }
  if (lock && Date.now() - lock.at < LOCK_MS) return null;    // another request has it

  // Read-then-write, so two requests landing in the same millisecond can both
  // get through. Deliberately not reaching for something stronger: the race
  // window is milliseconds against a twenty-minute threshold, and losing it
  // costs one extra refresh, not a wrong answer.
  try { await store.setJSON(LOCK_KEY, { at: Date.now() }); } catch { return null; }

  try {
    await runRefresh();
    return await store.get(KEY, { type: "json" });
  } catch (err) {
    // Slightly old data beats an error page. Logged rather than swallowed, so
    // a genuine outage is visible in the function log instead of silent.
    console.error("[cheeto] read-triggered refresh failed:", err?.message || err);
    return null;
  }
}

export default async () => {
  try {
    const store = getStore(STORE);
    let state = await store.get(KEY, { type: "json" });
    let healed = false;

    const age = state?.updatedAt ? Date.now() - Date.parse(state.updatedAt) : Infinity;
    if (!state || age > STALE_MS) {
      const fresh = await refreshUnlessSomeoneElseIs(store);
      if (fresh) { state = fresh; healed = true; }
    }

    if (!state) {
      return Response.json(
        { empty: true, hint: "no refresh has run yet — hit /.netlify/functions/refresh-now" },
        { headers: { "cache-control": "public, max-age=30" } }
      );
    }

    return Response.json(state, {
      // Was max-age=60 + stale-while-revalidate=600, which let the CDN serve
      // data up to TEN MINUTES old on a site whose whole promise is 15-minute
      // freshness — and made a manual refresh look like it did nothing.
      // A blob read is cheap; correctness beats the cache here.
      headers: {
        "cache-control": "public, max-age=20, must-revalidate",
        // So "is the pipeline alive?" is one curl away rather than a guess.
        "x-cheeto-age-s": String(Math.round((Date.now() - Date.parse(state.updatedAt)) / 1000)),
        "x-cheeto-healed": healed ? "1" : "0",
      },
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
};
