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
      // Short cache: the data changes every 15 min, and stale-while-revalidate
      // keeps the page instant without ever serving something very old.
      headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" },
    });
  } catch (err) {
    return Response.json({ error: String(err?.message || err) }, { status: 500 });
  }
};
