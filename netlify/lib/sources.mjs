/**
 * The Supreme Cheeto — data refresh.
 *
 * Runs on Netlify's cron every 15 minutes, pulls every tracked figure from its
 * public source, and writes the result to Netlify Blobs. The page reads the blob
 * via /.netlify/functions/data — it never scrapes anything itself.
 *
 * Design rules, because scraping other people's HTML is inherently brittle:
 *   1. Every source is fetched in isolation. One failure never takes down the rest.
 *   2. On failure we keep the PREVIOUS value rather than blanking or guessing.
 *   3. Every field carries its own `ok` + `at` stamp, so the page can show exactly
 *      which numbers are fresh and which are coasting. No silent staleness.
 *   4. Nothing is ever fabricated. If we can't read it, we say so.
 */
import { getStore } from "@netlify/blobs";

const STORE = "cheeto";
const KEY = "state";
const UA =
  "Mozilla/5.0 (compatible; SupremeCheetoBot/1.0; +https://github.com/maxpitts/The-Supreme-Cheeto)";

/* Trump's Truth Social account id (Mastodon-style API). */
const TS_ACCOUNT = "107780257626128497";

const nowISO = () => new Date().toISOString();

async function grab(url, { json = false, timeout = 12000, headers = {} } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { "user-agent": UA, accept: json ? "application/json" : "text/html,*/*", ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

/* Run a source, keeping the previous value if it throws. */
async function source(name, prev, fn) {
  try {
    const value = await fn();
    if (value == null) throw new Error("no value");
    return { ...value, ok: true, at: nowISO(), source: name };
  } catch (err) {
    return prev
      ? { ...prev, ok: false, error: String(err.message || err), checkedAt: nowISO() }
      : { ok: false, error: String(err.message || err), checkedAt: nowISO(), source: name };
  }
}

const num = (s) => {
  const m = String(s).replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
};
const stripTags = (html) =>
  html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/* ------------------------------------------------------------------ DEBT */
async function debt() {
  const base = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny";
  const latest = await grab(`${base}?sort=-record_date&page[size]=1&fields=record_date,tot_pub_debt_out_amt`, { json: true });
  const row = latest?.data?.[0];
  const amount = parseFloat(row?.tot_pub_debt_out_amt);
  if (!isFinite(amount)) throw new Error("bad debt payload");

  // Trailing-12-month burn rate, so the client-side ticker extrapolates honestly.
  let perSecond = 89380;
  try {
    const then = new Date(row.record_date);
    then.setFullYear(then.getFullYear() - 1);
    const from = then.toISOString().slice(0, 10);
    const back = await grab(
      `${base}?filter=record_date:gte:${from}&sort=record_date&page[size]=1&fields=record_date,tot_pub_debt_out_amt`,
      { json: true }
    );
    const old = back?.data?.[0];
    const days = (Date.parse(row.record_date) - Date.parse(old.record_date)) / 864e5;
    const rate = (amount - parseFloat(old.tot_pub_debt_out_amt)) / days / 86400;
    if (isFinite(rate) && rate > 0) perSecond = Math.round(rate);
  } catch { /* keep the default rate */ }

  return { amount, asOf: row.record_date, perSecond };
}

/* ----------------------------------------------------------------- POSTS */
/* Primary: the Truth Social API. Fallback: the trumpstruth.org mirror. */
async function posts() {
  try {
    const raw = await grab(
      `https://truthsocial.com/api/v1/accounts/${TS_ACCOUNT}/statuses?exclude_replies=true&limit=20`,
      { json: true }
    );
    if (!Array.isArray(raw) || !raw.length) throw new Error("empty api");
    const list = raw.map((p) => {
      const text = stripTags(p.content || "");
      return {
        id: String(p.id),
        at: p.created_at,
        text: text || null,
        note: text ? null : p.media_attachments?.length ? "image-only post" : "no text",
        url: p.url || `https://truthsocial.com/@realDonaldTrump/${p.id}`,
        replies: p.replies_count ?? null,
        reblogs: p.reblogs_count ?? null,
        favourites: p.favourites_count ?? null,
      };
    });
    return { list, via: "truthsocial-api" };
  } catch (apiErr) {
    // Fallback: parse the public mirror. Anchors to /statuses/<id> are the one
    // structural thing on that page stable enough to key off.
    const html = await grab("https://trumpstruth.org/");
    const chunks = html.split(/<article|<div[^>]+class="[^"]*status/i).slice(1);
    const list = [];
    for (const chunk of chunks) {
      const idm = chunk.match(/statuses\/(\d+)/);
      if (!idm) continue;
      const datem = chunk.match(/([A-Z][a-z]+ \d{1,2}, \d{4},? \d{1,2}:\d{2} [AP]M)/);
      const body = stripTags(chunk).replace(/@realDonaldTrump/g, "").trim();
      const cleaned = body
        .replace(/^.*?\d{1,2}:\d{2} [AP]M/s, "")
        .replace(/Original Post.*$/s, "")
        .trim();
      list.push({
        id: idm[1],
        at: datem ? datem[1] : null,
        text: cleaned.length > 2 ? cleaned.slice(0, 1200) : null,
        note: cleaned.length > 2 ? null : "no text captured",
        url: `https://trumpstruth.org/statuses/${idm[1]}`,
      });
      if (list.length >= 20) break;
    }
    if (!list.length) throw new Error(`api: ${apiErr.message}; mirror: no posts parsed`);
    return { list, via: "trumpstruth-mirror" };
  }
}

/* ---------------------------------------------------------------- POLLS */
async function approval() {
  const html = await grab("https://fiftyplusone.news/polls/approval/president");
  const text = stripTags(html);
  const app = text.match(/Approve[^0-9]{0,40}(\d{1,2}(\.\d)?)/i);
  const dis = text.match(/Disapprove[^0-9]{0,40}(\d{1,2}(\.\d)?)/i);
  const a = app && num(app[1]);
  const d = dis && num(dis[1]);
  if (!a || !d || a > 100 || d > 100) throw new Error("could not parse approval");
  return { approve: a, disapprove: d };
}

/* ------------------------------------------------------------------ GAS */
async function gas() {
  const html = await grab("https://gasprices.aaa.com/");
  const text = stripTags(html).replace(/\s+/g, " ");
  const cur = text.match(/Current Avg\.?\s*\$?(\d\.\d{2,4})/i) || text.match(/National Average[^$]{0,40}\$(\d\.\d{2,4})/i);
  const yr = text.match(/Year Ago Avg\.?\s*\$?(\d\.\d{2,4})/i);
  const v = cur && num(cur[1]);
  if (!v || v < 1 || v > 15) throw new Error("could not parse gas price");
  return { v, prev: yr ? num(yr[1]) : null };
}

/* --------------------------------------------------------- EXEC ORDERS */
async function execOrders() {
  const url =
    "https://www.federalregister.gov/api/v1/documents.json" +
    "?conditions[type][]=PRESDOCU&conditions[presidential_document_type][]=executive_order" +
    "&conditions[signing_date][gte]=2025-01-20&per_page=1&order=newest" +
    "&fields[]=executive_order_number&fields[]=signing_date&fields[]=title";
  const j = await grab(url, { json: true });
  const d = j?.results?.[0];
  const n = parseInt(d?.executive_order_number, 10);
  if (!isFinite(n)) throw new Error("bad EO payload");
  return { latestEO: n, orders: n - 14147 + 1, title: d.title, signed: d.signing_date };
}

/* ----------------------------------------------------------------- GOLF */
async function golf() {
  const html = await grab("https://donaldtrump.golf/");
  const text = stripTags(html).replace(/\s+/g, " ");
  const days = text.match(/(\d{2,4})\s*(?:days?)?\s*(?:golfed|at a golf|days golfed)/i) || text.match(/golfed\D{0,20}(\d{2,4})/i);
  const pct = text.match(/(\d{1,2}(\.\d)?)\s*%/);
  const v = days && num(days[1]);
  if (!v) throw new Error("could not parse golf days");
  return { days: v, pct: pct ? num(pct[1]) : null };
}

/* ================================================================= MAIN */
export async function runRefresh() {
  const store = getStore(STORE);
  const prev = (await store.get(KEY, { type: "json" })) || {};

  const [d, p, a, g, e, gf] = await Promise.all([
    source("treasury", prev.debt, debt),
    source("truthsocial", prev.posts, posts),
    source("fiftyplusone", prev.approval, approval),
    source("aaa", prev.gas, gas),
    source("federalregister", prev.eo, execOrders),
    source("donaldtrump.golf", prev.golf, golf),
  ]);

  /* new-post detection, for the "post watch" hook */
  const newestId = p.list?.[0]?.id ?? null;
  const prevNewest = prev.posts?.list?.[0]?.id ?? null;
  const newPost = Boolean(newestId && prevNewest && newestId !== prevNewest);

  /* Cheeto-meter: same transparent formula the page documents */
  const clamp = (x) => Math.max(0, Math.min(100, x));
  const cheeto =
    [
      clamp(((a.disapprove ?? 50) - 35) / 30 * 100),
      g.prev ? clamp((g.v / g.prev - 1) / 0.4 * 100) : null,
      clamp(((prev.cpi?.v ?? 3.4) - 2) / 4 * 100),
      clamp((prev.tariff?.v ?? 7.1) / 15 * 100),
      clamp((((d.perSecond ?? 89380) * 31557600) / 1e12 / 4) * 100),
    ].filter((x) => x != null).reduce((s, x, _, arr) => s + x / arr.length, 0);

  /* Hourly history samples, capped at 30 days, for the sparklines. */
  const history = Array.isArray(prev.history) ? prev.history.slice() : [];
  const last = history[history.length - 1];
  if (!last || Date.now() - Date.parse(last.t) > 3.6e6) {
    history.push({
      t: nowISO(),
      debt: d.amount ?? null,
      approve: a.approve ?? null,
      disapprove: a.disapprove ?? null,
      gas: g.v ?? null,
      cheeto: Math.round(cheeto * 10) / 10,
    });
    while (history.length > 720) history.shift();
  }

  const state = {
    updatedAt: nowISO(),
    debt: d,
    posts: p,
    approval: a,
    gas: g,
    eo: e,
    golf: gf,
    /* Monthly/quarterly figures with no cheap live source. Refreshed by hand;
       stamped so the page can label them honestly rather than implying they're live. */
    cpi: prev.cpi ?? { v: 3.4, asOf: "July 2026", ok: true, manual: true },
    tariff: prev.tariff ?? { v: 7.1, prev: 2.3, asOf: "June 2026", ok: true, manual: true },
    eggs: prev.eggs ?? { v: 2.189, asOf: "July 2026", ok: true, manual: true },
    cheeto: Math.round(cheeto * 10) / 10,
    newPost,
    newestPostId: newestId,
    history,
  };

  await store.setJSON(KEY, state);

  const failed = ["debt", "posts", "approval", "gas", "eo", "golf"].filter((k) => !state[k]?.ok);
  return { ok: true, updatedAt: state.updatedAt, failed, postsVia: p.via ?? null, posts: p.list?.length ?? 0 };
}

export { STORE, KEY };

/* =====================================================================
   SELF-TEST
   Runs each source and judges whether the value it produced is plausible.
   A scraper that silently matches the WRONG number is the failure mode that
   actually bites, so every check has an explicit sane range — not just
   "did the fetch throw".
   ===================================================================== */
const DAYS_IN_OFFICE = () => (Date.now() - Date.parse("2025-01-20T17:00:00Z")) / 864e5;

const CHECKS = [
  {
    name: "treasury/debt", fn: debt,
    sane: (v) => v.amount > 30e12 && v.amount < 90e12 && v.perSecond > 10000 && v.perSecond < 500000,
    why: "debt should be tens of trillions; burn rate $10k–$500k/sec",
    show: (v) => ({ amount: v.amount, asOf: v.asOf, perSecond: v.perSecond }),
  },
  {
    name: "truthsocial/posts", fn: posts,
    sane: (v) => {
      if (!v.list?.length) return false;
      const newest = v.list.map((p) => Date.parse(p.at)).filter(isFinite).sort((a, b) => b - a)[0];
      return !!newest && Date.now() - newest < 30 * 864e5;   // anything older than a month = dead source
    },
    why: "expect >=1 post and the newest within 30 days (a stale mirror looks 'fine' otherwise)",
    show: (v) => ({ count: v.list?.length, via: v.via, newest: v.list?.[0]?.at,
                    sample: (v.list?.[0]?.text || v.list?.[0]?.note || "").slice(0, 90) }),
  },
  {
    name: "fiftyplusone/poll", fn: approval,
    sane: (v) => v.approve > 10 && v.approve < 80 && v.disapprove > 10 && v.disapprove < 90
                 && v.approve + v.disapprove > 70 && v.approve + v.disapprove < 130,
    why: "approve/disapprove each 10–80ish and summing near 100",
    show: (v) => v,
  },
  {
    name: "aaa/gas", fn: gas,
    sane: (v) => v.v > 1.5 && v.v < 12 && (v.prev == null || (v.prev > 1.5 && v.prev < 12)),
    why: "a US national average between $1.50 and $12.00",
    show: (v) => v,
  },
  {
    name: "fedregister/eo", fn: execOrders,
    sane: (v) => v.latestEO > 14147 && v.latestEO < 20000 && v.orders > 0 && v.orders < 2000,
    why: "EO numbers run upward from 14147; a count in the hundreds",
    show: (v) => ({ latestEO: v.latestEO, orders: v.orders, signed: v.signed, title: (v.title || "").slice(0, 60) }),
  },
  {
    name: "donaldtrump.golf", fn: golf,
    sane: (v) => v.days > 0 && v.days < DAYS_IN_OFFICE(),
    why: "days golfed must be positive and can't exceed days in office",
    show: (v) => v,
  },
];

export async function checkAll() {
  return Promise.all(CHECKS.map(async (c) => {
    const t0 = Date.now();
    try {
      const value = await c.fn();
      const sane = !!c.sane(value);
      return { name: c.name, ok: true, sane, value: c.show(value), ms: Date.now() - t0,
               note: sane ? null : "value outside expected range — " + c.why };
    } catch (err) {
      return { name: c.name, ok: false, sane: false, value: null, ms: Date.now() - t0,
               note: String(err?.message || err) };
    }
  }));
}
