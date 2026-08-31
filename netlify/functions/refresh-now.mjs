/* Manual pull: GET /.netlify/functions/refresh-now
   Use it once right after deploy so the site has data before the first cron fire,
   or any time you want to force a refresh. Same code path as the scheduled job. */
import { runRefresh } from "../lib/sources.mjs";

export default async () => {
  const started = Date.now();
  try {
    const result = await runRefresh();
    return Response.json({ ...result, tookMs: Date.now() - started });
  } catch (err) {
    return Response.json(
      { ok: false, error: String(err?.message || err), tookMs: Date.now() - started },
      { status: 500 }
    );
  }
};
