/* =====================================================================
   PREDICTION GAME — server side
   Runs inside the 15-minute refresh. Two jobs:
     1. open tomorrow's questions if they don't exist yet
     2. resolve any question whose window has closed

   Every question stores the BASELINE it was created against, so resolution
   is a comparison between two figures the job fetched itself. Nothing the
   client sends is trusted, and nothing is decided by opinion.

   Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the Netlify environment.
   Without them this module does nothing and says so — the rest of the refresh
   is unaffected.
   ===================================================================== */

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const configured = () => Boolean(SB_URL && SB_KEY);

async function sb(path, { method = "GET", body, prefer } = {}) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SB_KEY,
      authorization: `Bearer ${SB_KEY}`,
      "content-type": "application/json",
      ...(prefer ? { prefer } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

/* Questions run on Eastern days, because that's the clock the subject keeps.

   Doing this with `new Date(d.toLocaleString(...))` and a drift correction is
   the obvious approach and it is wrong — it lands four hours early, because a
   Date built from a localised string is reinterpreted in the RUNTIME's zone,
   which on Netlify is UTC. So: read the Eastern wall-clock parts explicitly,
   build the next midnight from those parts, and convert back using the offset
   in effect at that moment (which handles DST, including the two days a year
   the offset changes between now and midnight). */
function etParts(d) {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

function etOffsetMinutes(date) {
  const p = etParts(date);
  const asUTC = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return (asUTC - date.getTime()) / 60000;                  // -240 (EDT) or -300 (EST)
}

function easternMidnightAfter(d = new Date()) {
  const p = etParts(d);
  // midnight at the START of the next Eastern day, expressed as if it were UTC
  const naive = Date.UTC(p.y, p.m - 1, p.d + 1, 0, 0, 0);
  // first guess with the offset in effect now, then re-solve with the offset
  // actually in effect at the target instant (matters on DST-change days)
  let t = naive - etOffsetMinutes(d) * 60000;
  t = naive - etOffsetMinutes(new Date(t)) * 60000;
  // A question that opens at 11:50pm and shuts at midnight is not a game.
  // If tonight's cutoff is imminent, run to the following night instead.
  if (t - d.getTime() < 4 * 3600e3) {
    const p2 = etParts(new Date(t + 3600e3));
    const naive2 = Date.UTC(p2.y, p2.m - 1, p2.d + 1, 0, 0, 0);
    t = naive2 - etOffsetMinutes(new Date(naive2 - etOffsetMinutes(d) * 60000)) * 60000;
  }
  return new Date(t);
}

/* Count from the rolling ledger when we have one — the live feed only exposes
   about twenty posts, so counting straight from it undercounts a busy day and
   would score the game wrongly. Fall back to the feed only if the ledger is
   missing, and say so in the resolution note when we do. */
function postSource(state) {
  const ledger = state.postLedger;
  if (Array.isArray(ledger) && ledger.length) return { rows: ledger, complete: true };
  return { rows: state.posts?.list || [], complete: false };
}

function countPostsSince(rows, sinceMs) {
  const seen = new Set();
  for (const p of rows || []) {
    const t = Date.parse(p.at);
    if (isFinite(t) && t >= sinceMs && p.id) seen.add(p.id);
  }
  return seen.size;
}

export async function runPredictions(state) {
  if (!configured()) {
    return { ok: false, skipped: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" };
  }

  const now = new Date();
  const closes = easternMidnightAfter(now);
  const out = { opened: [], resolved: [] };

  /* ---------------- 1. open today's questions ---------------- */
  const openRows = await sb(
    `cheeto_predictions?select=id,kind,closes_at&resolved_at=is.null&closes_at=gt.${now.toISOString()}`
  );
  const haveKind = (k) => openRows.some((r) => r.kind === k);

  if (!haveKind("gas_direction") && state.gas?.ok && state.gas?.v) {
    try {
      await sb("cheeto_predictions", {
        method: "POST",
        prefer: "return=minimal,resolution=ignore-duplicates",
        body: [{
          kind: "gas_direction",
          prompt: `Gas is $${state.gas.v.toFixed(3)}/gal right now. Will the national average be HIGHER this time tomorrow?`,
          option_a: "Higher",
          option_b: "Lower or the same",
          baseline: state.gas.v,
          closes_at: closes.toISOString(),
          resolves_at: new Date(now.getTime() + 24 * 3600e3).toISOString(),
        }],
      });
      out.opened.push("gas_direction");
    } catch (e) { out.gasOpenError = e.message; }
  }

  if (!haveKind("post_count") && state.posts?.ok) {
    // Baseline is the recent daily rate, so the question is a real coin-flip
    // rather than a gimme in either direction.
    const dayAgo = Date.now() - 864e5;
    const recent = countPostsSince(postSource(state).rows, dayAgo);
    const line = Math.max(3, Math.round(recent || 8));
    try {
      await sb("cheeto_predictions", {
        method: "POST",
        prefer: "return=minimal,resolution=ignore-duplicates",
        body: [{
          kind: "post_count",
          prompt: `He posted ${recent} times in the last 24h. Will he post MORE than ${line} times in the next 24h?`,
          option_a: `More than ${line}`,
          option_b: `${line} or fewer`,
          baseline: line,
          closes_at: closes.toISOString(),
          resolves_at: new Date(now.getTime() + 24 * 3600e3).toISOString(),
        }],
      });
      out.opened.push("post_count");
    } catch (e) { out.postOpenError = e.message; }
  }

  /* ---------------- 2. resolve anything due ---------------- */
  const due = await sb(
    `cheeto_predictions?select=id,kind,baseline,baseline_at,resolves_at&resolved_at=is.null&resolves_at=lte.${now.toISOString()}`
  );

  for (const q of due) {
    let outcome = null, note = null;
    try {
      if (q.kind === "gas_direction") {
        if (!state.gas?.ok || state.gas?.v == null) continue;   // wait for a good reading
        outcome = state.gas.v > Number(q.baseline) ? "a" : "b";
        note = `Baseline $${Number(q.baseline).toFixed(3)} → $${state.gas.v.toFixed(3)}`;
      } else if (q.kind === "post_count") {
        if (!state.posts?.ok) continue;
        const src = postSource(state);
        const since = Date.parse(q.baseline_at);
        const n = countPostsSince(src.rows, since);
        outcome = n > Number(q.baseline) ? "a" : "b";
        note = `${n} posts since the question opened (line was ${q.baseline})`;
        if (!src.complete && n >= 19) {
          note += " — counted from the live feed window, which may undercount a heavy day";
        }
      } else {
        outcome = "void";
        note = "unknown question type";
      }

      if (!outcome) continue;
      await sb(`cheeto_predictions?id=eq.${q.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { resolved_at: now.toISOString(), outcome, outcome_note: note },
      });
      out.resolved.push({ id: q.id, kind: q.kind, outcome, note });
    } catch (e) {
      out[`resolveError_${q.id}`] = e.message;
    }
  }

  return { ok: true, ...out };
}
