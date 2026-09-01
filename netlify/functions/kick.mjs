/* Live status for the stream windows: GET /.netlify/functions/kick
 *
 * This exists only because the browser can't call Kick's API directly —
 * it's a different origin and doesn't send CORS headers, so the request is
 * refused before it ever reaches Kick. The function is a thin relay.
 *
 * The channel list is FIXED here on purpose. Accepting a channel name from the
 * query string would turn this endpoint into a general-purpose Kick API proxy
 * that anyone could point anywhere and run on Max's bandwidth. Two names, hard
 * coded, is the whole surface.
 *
 * No API key is involved: this endpoint is public. If Kick changes that, this
 * returns ok:false and the site simply stops showing live badges, which is the
 * correct failure — a badge that's wrong is worse than no badge.
 */

const CHANNELS = ["bobbyjayyy", "benp90"];
const UA = "SupremeCheetoBot/1.0 (+https://supremecheeto.club)";

async function one(slug) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try {
    const res = await fetch(`https://kick.com/api/v2/channels/${encodeURIComponent(slug)}`, {
      signal: ctl.signal,
      headers: { "user-agent": UA, accept: "application/json" },
    });
    if (!res.ok) return { name: slug, ok: false, error: `HTTP ${res.status}` };
    const j = await res.json();

    // Shape defensively: livestream is null when offline, an object when live.
    const ls = j?.livestream;
    const live = Boolean(ls && ls.is_live !== false);
    return {
      name: slug,
      ok: true,
      live,
      title: live ? String(ls.session_title || "").slice(0, 140) || null : null,
      viewers: live && Number.isFinite(ls.viewer_count) ? ls.viewer_count : null,
      startedAt: live ? (ls.start_time || null) : null,
      followers: Number.isFinite(j?.followers_count) ? j.followers_count : null,
    };
  } catch (err) {
    return { name: slug, ok: false, error: String(err?.message || err).slice(0, 80) };
  } finally {
    clearTimeout(t);
  }
}

export default async () => {
  const channels = await Promise.all(CHANNELS.map(one));
  const anyOk = channels.some((c) => c.ok);

  return Response.json(
    { ok: anyOk, at: new Date().toISOString(), channels },
    {
      headers: {
        // Short cache: live status changes on the order of minutes, and this
        // keeps a busy page from hammering Kick once per viewer per minute.
        "cache-control": "public, max-age=30, must-revalidate",
      },
    }
  );
};
