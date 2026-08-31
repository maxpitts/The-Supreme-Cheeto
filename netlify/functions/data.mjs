/* Public read endpoint the page polls: GET /.netlify/functions/data
   Returns whatever the last successful refresh stored. If the store is still
   empty (before the first cron fire) it says so, and the page falls back to the
   snapshot baked into the HTML rather than showing blanks. */
import { getStore } from "@netlify/blobs";
import { STORE, KEY } from "../lib/sources.mjs";

export default async () => {
  try {
    const state = await getStore(STORE).get(KEY, { type: "json" });
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
      headers: { "cache-control": "public, max-age=20, must-revalidate" },
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
};
