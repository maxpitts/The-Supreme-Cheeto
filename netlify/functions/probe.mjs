/* Markup probe: GET /.netlify/functions/probe?src=truth|poll|gas|golf
 *
 * Returns the RAW HTML around the markers each extractor keys off, so parsers
 * can be written against what the page actually contains instead of guessed at.
 * Read-only, no secrets, no side effects — but it's a debugging tool, so delete
 * this file once the extractors are settled.
 */
const UA = "Mozilla/5.0 (compatible; SupremeCheetoBot/1.0)";

const SRC = {
  truth: { url: "https://trumpstruth.org/", marks: ["data-status-url", "statuses/", "PM", "AM"] },
  poll:  { url: "https://fiftyplusone.news/polls/approval/president", marks: ["Approve", "Disapprove", "%"] },
  gas:   { url: "https://gasprices.aaa.com/", marks: ["Current Avg", "Year Ago", "National Average"] },
  golf:  { url: "https://donaldtrump.golf/", marks: ["golf", "days", "%"] },
};

export default async (req) => {
  const src = new URL(req.url).searchParams.get("src") || "truth";
  const cfg = SRC[src];
  if (!cfg) return new Response("unknown src. use: " + Object.keys(SRC).join("|"), { status: 400 });

  let html;
  try {
    const res = await fetch(cfg.url, { headers: { "user-agent": UA } });
    html = await res.text();
    var status = res.status;
  } catch (err) {
    return new Response("FETCH FAILED: " + err.message, { status: 502 });
  }

  const out = [
    `SOURCE : ${cfg.url}`,
    `STATUS : ${status}`,
    `BYTES  : ${html.length}`,
    "",
  ];

  for (const mark of cfg.marks) {
    const idxs = [];
    let i = html.indexOf(mark);
    while (i !== -1 && idxs.length < 3) { idxs.push(i); i = html.indexOf(mark, i + 1); }
    out.push(`===== marker "${mark}" — ${idxs.length ? idxs.length + " shown" : "NOT FOUND"} =====`);
    for (const at of idxs) {
      out.push(html.slice(Math.max(0, at - 320), at + 520).replace(/\s+/g, " "));
      out.push("-----");
    }
    out.push("");
  }

  return new Response(out.join("\n"), {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
};
