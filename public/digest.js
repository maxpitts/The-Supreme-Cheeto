/* =====================================================================
   WHILE YOU WERE OUT — the returning-visitor digest
   Snapshots the numbers you saw last time into localStorage, then on your next
   visit diffs them against what's live now and shows what moved.

   Every line is a subtraction between two figures this site actually displayed.
   Nothing is estimated, nothing is invented, and if a figure is missing from
   either snapshot that line is simply omitted rather than guessed at. The joke
   is the Windows-95 "unread mail" framing, not the numbers.
   ===================================================================== */

const Digest = {
  KEY: "cheeto_lastvisit_v1",
  MIN_GAP: 30 * 60e3,        // don't greet a page refresh as a return visit
  MAX_GAP: 45 * 864e5,       // beyond a month and a half, the diff is noise
  shown: false,

  read() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "null"); } catch { return null; }
  },

  /* Only the handful of figures a diff can be honest about. */
  snapshot() {
    return {
      t: Date.now(),
      debt: D.debt?.amount ?? null,
      approve: D.approval?.approve ?? null,
      disapprove: D.approval?.disapprove ?? null,
      gas: D.gas?.v ?? null,
      cheeto: D.cheeto ?? null,
      golf: D.golf?.days ?? null,
      eo: D.eo?.orders ?? null,
      newestPostId: D.posts?.list?.[0]?.id ?? null,
      postIds: (D.posts?.list || []).slice(0, 40).map((p) => p.id).filter(Boolean),
    };
  },

  write() {
    try { localStorage.setItem(this.KEY, JSON.stringify(this.snapshot())); } catch {}
  },

  /* ---------------- the diff ---------------- */
  lines(was, now) {
    const out = [];
    const both = (k) => was[k] != null && now[k] != null;

    if (both("debt")) {
      const d = now.debt - was.debt;
      if (Math.abs(d) > 1e6) {
        out.push({
          icon: "&#128181;",
          text: `The national debt went <b>${d > 0 ? "up" : "down"} ${money(Math.abs(d), 0)}</b>
                 — that's ${money(Math.abs(d) / POPULATION, 2)} more per person, including yours.`,
          tone: d > 0 ? "bad" : "good",
        });
      }
    }

    if (both("approve") && both("disapprove")) {
      const net = (now.approve - now.disapprove) - (was.approve - was.disapprove);
      if (Math.abs(net) >= 0.2) {
        out.push({
          icon: "&#128499;",
          text: `Net approval moved <b>${net > 0 ? "+" : ""}${net.toFixed(1)} points</b>,
                 to ${(now.approve - now.disapprove).toFixed(1)}.`,
          tone: net > 0 ? "good" : "bad",
        });
      }
    }

    if (both("gas")) {
      const d = now.gas - was.gas;
      if (Math.abs(d) >= 0.01) {
        out.push({
          icon: "&#9981;",
          text: `Gas is <b>${d > 0 ? "up" : "down"} ${Math.abs(d * 100).toFixed(1)}&cent;</b>
                 a gallon, at $${now.gas.toFixed(3)}.`,
          tone: d > 0 ? "bad" : "good",
        });
      }
    }

    // New posts: count IDs we hold now that weren't in the last snapshot. If the
    // old snapshot has no ID list (first version, or a very old visit) this is
    // skipped rather than reported as "everything is new".
    if (Array.isArray(was.postIds) && was.postIds.length && Array.isArray(now.postIds)) {
      const seen = new Set(was.postIds);
      const fresh = now.postIds.filter((id) => !seen.has(id)).length;
      if (fresh) {
        out.push({
          icon: "&#128226;",
          text: `<b>${fresh} new post${fresh === 1 ? "" : "s"}</b> on the feed${fresh >= 20 ? " (at least — that's as far back as the feed goes)" : ""}.`,
          tone: "note",
        });
      }
    }

    if (both("golf")) {
      const d = now.golf - was.golf;
      if (d > 0) out.push({ icon: "&#9971;", text: `<b>${d} more golf day${d === 1 ? "" : "s"}</b>, ${now.golf} total.`, tone: "note" });
    }

    if (both("eo")) {
      const d = now.eo - was.eo;
      if (d > 0) out.push({ icon: "&#9998;", text: `<b>${d} new executive order${d === 1 ? "" : "s"}</b> signed.`, tone: "note" });
    }

    if (both("cheeto")) {
      const d = now.cheeto - was.cheeto;
      if (Math.abs(d) >= 0.5) {
        out.push({
          icon: "&#129472;",
          text: `The Cheeto-meter is <b>${d > 0 ? "up" : "down"} ${Math.abs(d).toFixed(1)}</b>, reading ${now.cheeto.toFixed(1)} / 100.`,
          tone: d > 0 ? "bad" : "good",
        });
      }
    }

    return out;
  },

  /* ---------------- show it ---------------- */
  maybeShow() {
    if (this.shown || D.seeded) return;           // wait for real data
    const was = this.read();

    // First ever visit: just record the baseline. Nothing to diff against, and
    // a "welcome back" for someone who has never been here would be a lie.
    if (!was || !was.t) { this.write(); this.shown = true; return; }

    const gap = Date.now() - was.t;
    if (gap < this.MIN_GAP || gap > this.MAX_GAP) { this.write(); this.shown = true; return; }

    const now = this.snapshot();
    const lines = this.lines(was, now);
    this.write();
    this.shown = true;
    if (!lines.length) return;                    // nothing moved: say nothing

    const box = document.getElementById("digestBody");
    if (!box) return;

    box.innerHTML = `
      <div class="dg-head">
        <span class="dg-glyph">&#128231;</span>
        <div>
          <b>You have ${lines.length} unread change${lines.length === 1 ? "" : "s"}.</b>
          <div class="dg-since">Since your last visit, ${esc(ago(gap))} ago.</div>
        </div>
      </div>
      <ul class="dg-list">
        ${lines.map((l) => `<li class="dg-${l.tone}"><span class="dg-i">${l.icon}</span><span>${l.text}</span></li>`).join("")}
      </ul>
      <div class="dg-foot">
        <button class="b95" id="dgOk">OK</button>
        <button class="b95" id="dgOff">Don't show this again</button>
      </div>`;

    WM.open("w-digest");
    document.getElementById("dgOk")?.addEventListener("click", () => WM.close(WM.byId("w-digest")));
    document.getElementById("dgOff")?.addEventListener("click", () => {
      try { localStorage.setItem("cheeto_digest_off", "1"); } catch {}
      WM.close(WM.byId("w-digest"));
      showModal("Digest off", "&#128231;", "No more catch-up summaries.<br><br><span style='color:#555;font-size:11px'>Your last-visit snapshot is still kept, so turning it back on isn't a problem — clear the site data if you want it truly gone.</span>");
    });
  },

  disabled() {
    try { return localStorage.getItem("cheeto_digest_off") === "1"; } catch { return false; }
  },
};

/* Runs on the first real data payload of the session and never again — the
   15-minute background refreshes shouldn't keep reopening a "welcome back". */
document.addEventListener("cheeto:data", () => {
  if (!Digest.shown && !Digest.disabled()) setTimeout(() => Digest.maybeShow(), 1200);
  else if (Digest.disabled()) Digest.write();      // keep the baseline current
});

// Also refresh the stored baseline as you leave, so a long session doesn't
// report changes you already watched happen.
window.addEventListener("pagehide", () => { if (!D.seeded) Digest.write(); });
