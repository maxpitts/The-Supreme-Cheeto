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

/* =====================================================================
   THE QUESTION CATALOGUE
   Two questions on 24-hour windows meant a visitor answered everything in ten
   seconds and had nothing to do until tomorrow — the game read as dead even
   though it was working exactly as written. More kinds, and one short-window
   kind that turns over several times a day, is the fix.

   Every entry must be resolvable from figures the refresh job already fetched.
   `open` returns null when the data it needs is missing, so a failed source
   quietly skips its question instead of opening one nobody can score.
   ===================================================================== */
const HOURS = (n) => n * 3600e3;

const KINDS = [
  {
    kind: "gas_direction",
    open: (st) => (st.gas?.ok && st.gas?.v) ? {
      prompt: `Gas is $${st.gas.v.toFixed(3)}/gal. Will the national average be HIGHER this time tomorrow?`,
      a: "Higher", b: "Lower or the same",
      baseline: st.gas.v, window: HOURS(24),
    } : null,
    resolve: (st, q) => (!st.gas?.ok || st.gas?.v == null) ? null : {
      outcome: st.gas.v > Number(q.baseline) ? "a" : "b",
      note: `Baseline $${Number(q.baseline).toFixed(3)} → $${st.gas.v.toFixed(3)}`,
    },
  },
  {
    kind: "post_count",
    open: (st) => {
      if (!st.posts?.ok) return null;
      const n = countPostsSince(postSource(st).rows, Date.now() - HOURS(24));
      const line = Math.max(3, Math.round(n || 8));
      return {
        prompt: `He posted ${n} times in the last 24h. Will he post MORE than ${line} times in the next 24h?`,
        a: `More than ${line}`, b: `${line} or fewer`,
        baseline: line, window: HOURS(24),
      };
    },
    resolve: (st, q) => {
      if (!st.posts?.ok) return null;
      const src = postSource(st);
      const n = countPostsSince(src.rows, Date.parse(q.baseline_at));
      let note = `${n} posts since the question opened (line was ${q.baseline})`;
      if (!src.complete && n >= 19) note += " — counted from the live feed window, which may undercount";
      return { outcome: n > Number(q.baseline) ? "a" : "b", note };
    },
  },
  {
    /* The fast one. A four-hour window turns over several times a day, so
       there is almost always something unanswered waiting. */
    kind: "post_burst",
    open: (st) => {
      if (!st.posts?.ok) return null;
      const n = countPostsSince(postSource(st).rows, Date.now() - HOURS(4));
      const line = Math.max(1, Math.round(n || 2));
      return {
        prompt: `${n} posts in the last four hours. More than ${line} in the next four?`,
        a: `More than ${line}`, b: `${line} or fewer`,
        baseline: line, window: HOURS(4),
      };
    },
    resolve: (st, q) => {
      if (!st.posts?.ok) return null;
      const n = countPostsSince(postSource(st).rows, Date.parse(q.baseline_at));
      return {
        outcome: n > Number(q.baseline) ? "a" : "b",
        note: `${n} posts in that four-hour window (line was ${q.baseline})`,
      };
    },
  },
  {
    kind: "approval_net",
    open: (st) => {
      const a = st.approval?.approve, d = st.approval?.disapprove;
      if (!st.approval?.ok || a == null || d == null) return null;
      const net = a - d;
      return {
        prompt: `Net approval is ${net > 0 ? "+" : ""}${net.toFixed(1)}. Will it be HIGHER tomorrow?`,
        a: "Higher", b: "Lower or unchanged",
        baseline: Math.round(net * 100) / 100, window: HOURS(24),
      };
    },
    resolve: (st, q) => {
      const a = st.approval?.approve, d = st.approval?.disapprove;
      if (!st.approval?.ok || a == null || d == null) return null;
      const net = a - d;
      return {
        outcome: net > Number(q.baseline) ? "a" : "b",
        note: `Net ${Number(q.baseline).toFixed(1)} → ${net.toFixed(1)}`,
      };
    },
  },
  {
    kind: "eo_next",
    open: (st) => (st.eo?.ok && Number.isFinite(st.eo?.orders)) ? {
      prompt: `${st.eo.orders} executive orders signed so far. Will another be signed by tomorrow?`,
      a: "Yes, at least one more", b: "No new orders",
      baseline: st.eo.orders, window: HOURS(24),
    } : null,
    resolve: (st, q) => (!st.eo?.ok || !Number.isFinite(st.eo?.orders)) ? null : {
      outcome: st.eo.orders > Number(q.baseline) ? "a" : "b",
      note: `${q.baseline} → ${st.eo.orders} orders`,
    },
  },
  {
    kind: "golf_next",
    open: (st) => (st.golf?.ok && Number.isFinite(st.golf?.days)) ? {
      prompt: `${st.golf.days} days at a golf course this term. Will that go up by tomorrow?`,
      a: "Yes, another round", b: "No golf",
      baseline: st.golf.days, window: HOURS(24),
    } : null,
    resolve: (st, q) => (!st.golf?.ok || !Number.isFinite(st.golf?.days)) ? null : {
      outcome: st.golf.days > Number(q.baseline) ? "a" : "b",
      note: `${q.baseline} → ${st.golf.days} days`,
    },
  },
  {
    kind: "meter_direction",
    open: (st) => (st.cheeto == null) ? null : {
      prompt: `The Cheeto-meter reads ${st.cheeto.toFixed(1)}. Higher or lower tomorrow?`,
      a: "Higher", b: "Lower or the same",
      baseline: Math.round(st.cheeto * 100) / 100, window: HOURS(24),
    },
    resolve: (st, q) => (st.cheeto == null) ? null : {
      outcome: st.cheeto > Number(q.baseline) ? "a" : "b",
      note: `${Number(q.baseline).toFixed(1)} → ${st.cheeto.toFixed(1)}`,
    },
  },
];

export async function runPredictions(state) {
  if (!configured()) {
    return { ok: false, skipped: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set" };
  }

  const now = new Date();
  const out = { opened: [], resolved: [], errors: [] };

  /* ---------------- 1. open anything that isn't currently running ---------- */
  const openRows = await sb(
    `cheeto_predictions?select=id,kind,closes_at&resolved_at=is.null&closes_at=gt.${now.toISOString()}`
  );
  const haveKind = (k) => openRows.some((r) => r.kind === k);

  for (const def of KINDS) {
    if (haveKind(def.kind)) continue;
    let spec = null;
    try { spec = def.open(state); } catch (e) { out.errors.push(`${def.kind}: ${e.message}`); }
    if (!spec) continue;

    // Day-long questions land on Eastern midnight so everyone's deadline is
    // the same; short ones just run their window from now.
    const closes = spec.window >= HOURS(12)
      ? easternMidnightAfter(now)
      : new Date(now.getTime() + spec.window);

    try {
      await sb("cheeto_predictions", {
        method: "POST",
        prefer: "return=minimal,resolution=ignore-duplicates",
        body: [{
          kind: def.kind,
          prompt: spec.prompt,
          option_a: spec.a,
          option_b: spec.b,
          baseline: spec.baseline,
          closes_at: closes.toISOString(),
          resolves_at: new Date(now.getTime() + spec.window).toISOString(),
        }],
      });
      out.opened.push(def.kind);
    } catch (e) { out.errors.push(`open ${def.kind}: ${e.message}`); }
  }

  /* ---------------- 2. resolve anything due ---------------- */
  const due = await sb(
    `cheeto_predictions?select=id,kind,baseline,baseline_at,resolves_at&resolved_at=is.null&resolves_at=lte.${now.toISOString()}`
  );

  for (const q of due) {
    try {
      const def = KINDS.find((k) => k.kind === q.kind);
      let res;
      if (!def) {
        res = { outcome: "void", note: "question type no longer exists" };
      } else {
        res = def.resolve(state, q);
        if (!res) continue;              // sources unhealthy: wait for a good read
      }
      await sb(`cheeto_predictions?id=eq.${q.id}`, {
        method: "PATCH",
        prefer: "return=minimal",
        body: { resolved_at: now.toISOString(), outcome: res.outcome, outcome_note: res.note },
      });
      out.resolved.push({ id: q.id, kind: q.kind, outcome: res.outcome, note: res.note });
    } catch (e) { out.errors.push(`resolve ${q.id}: ${e.message}`); }
  }

  return { ok: true, ...out };
}
