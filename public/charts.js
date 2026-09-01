/* =====================================================================
   CHARTS
   Deliberately not time series. Gas moves ~$0.002/day and approval maybe a
   tenth of a point a week, so a line chart of either is a flat line however
   long you wait. Everything interesting in this data is a COMPARISON —
   now vs a year ago, now vs the 2% target, now vs January 2025 — so that's
   what these draw.
   ===================================================================== */

/* ---------- shared ---------- */
const pct = (a, b) => (b ? ((a - b) / b) * 100 : 0);
const arrow = (n) => (n >= 0 ? "▲" : "▼");

/* =====================================================================
   1. THEN vs NOW — paired bars
   ===================================================================== */
function renderThenNow() {
  const box = $("#econThenNow");
  if (!box) return;

  const rows = [
    { label: "Gas, regular",     now: D.gas?.v,    then: D.gas?.prev,    thenLabel: "a year ago", fmt: (v) => "$" + v.toFixed(3), suffix: "/gal" },
    { label: "CPI inflation",    now: D.cpi?.v,    then: 2,              thenLabel: "Fed target", fmt: (v) => v.toFixed(1) + "%", pts: true },
    { label: "Effective tariff", now: D.tariff?.v, then: D.tariff?.prev, thenLabel: "Jan 2025",   fmt: (v) => v.toFixed(1) + "%", pts: true },
  ].filter((r) => r.now != null && r.then != null);

  if (!rows.length) { box.innerHTML = `<div class="note">No comparison data available.</div>`; return; }

  box.innerHTML = rows.map((r) => {
    const max = Math.max(r.now, r.then) * 1.12;
    const wNow = (r.now / max) * 100, wThen = (r.then / max) * 100;
    const diff = r.pts ? r.now - r.then : pct(r.now, r.then);
    const up = diff >= 0;
    return `<div class="tn">
      <div class="tn-label">${esc(r.label)}
        <span class="tn-delta ${up ? "up" : "down"}">${arrow(diff)} ${Math.abs(diff).toFixed(1)}${r.pts ? " pts" : "%"}</span>
      </div>
      <div class="tn-row">
        <span class="tn-tag">${esc(r.thenLabel)}</span>
        <div class="tn-track"><i class="tn-then" style="width:${wThen.toFixed(1)}%"></i></div>
        <b class="tn-val">${esc(r.fmt(r.then))}</b>
      </div>
      <div class="tn-row">
        <span class="tn-tag">today</span>
        <div class="tn-track"><i class="tn-now" style="width:${wNow.toFixed(1)}%"></i></div>
        <b class="tn-val">${esc(r.fmt(r.now))}</b>
      </div>
    </div>`;
  }).join("");
}

/* =====================================================================
   2. THE RECEIPT
   Current prices are real. The year-ago column is explicitly ESTIMATED by
   deflating with the published CPI rate — labelled as such on the receipt,
   because inventing historical prices would be worse than not showing them.
   ===================================================================== */
function renderReceipt() {
  const box = $("#econReceipt");
  if (!box) return;

  const cpi = D.cpi?.v ?? null;
  const items = [
    { n: "GAS  (10 GAL)",     now: (D.gas?.v ?? 0) * 10,  then: D.gas?.prev != null ? D.gas.prev * 10 : null, exact: true },
    { n: "EGGS (1 DOZ)",      now: D.eggs?.v ?? null,     then: null },
    { n: "MILK (1 GAL)",      now: 4.05,                  then: null },
    { n: "GROUND BEEF (1LB)", now: 6.12,                  then: null },
    { n: "BREAD (1 LOAF)",    now: 1.98,                  then: null },
  ].filter((i) => i.now != null);

  // deflate anything without a real prior figure, and say so
  items.forEach((i) => { if (i.then == null && cpi != null) i.then = i.now / (1 + cpi / 100); });

  const totalNow  = items.reduce((s, i) => s + i.now, 0);
  const totalThen = items.reduce((s, i) => s + (i.then ?? i.now), 0);
  const diff = totalNow - totalThen;

  const line = (i) => {
    const label = i.n.padEnd(19, ".");
    return `<div class="r-line"><span>${esc(label)}</span><span>${i.now.toFixed(2)}${i.exact ? "" : "*"}</span></div>`;
  };

  box.innerHTML = `
    <div class="receipt">
      <div class="r-head">
        THE SUPREME CHEETO<br>
        GENERAL STORE &amp; DELI<br>
        <span class="r-small">TERMINAL 47 &middot; ${new Date().toLocaleDateString()}</span>
      </div>
      <div class="r-rule"></div>
      ${items.map(line).join("")}
      <div class="r-rule"></div>
      <div class="r-line r-total"><span>TOTAL TODAY.......</span><span>$${totalNow.toFixed(2)}</span></div>
      <div class="r-line"><span>SAME BASKET, 1 YR..</span><span>$${totalThen.toFixed(2)}</span></div>
      <div class="r-rule"></div>
      <div class="r-line r-total ${diff >= 0 ? "r-worse" : "r-better"}">
        <span>${diff >= 0 ? "YOU PAY MORE" : "YOU PAY LESS"}....</span>
        <span>${diff >= 0 ? "+" : "-"}$${Math.abs(diff).toFixed(2)}</span>
      </div>
      <div class="r-foot">
        ${cpi != null ? `* ESTIMATED FROM CPI ${cpi.toFixed(1)}%<br>` : ""}
        GAS FIGURES ARE ACTUAL (AAA)<br>
        NO REFUNDS &middot; NO EXCHANGES<br>
        THANK YOU COME AGAIN
      </div>
    </div>`;
}

/* =====================================================================
   3. CHEETO-METER BREAKDOWN
   The gauge asserts a number; this shows the working.
   ===================================================================== */
function renderMeterBreakdown() {
  const box = $("#meterParts");
  if (!box) return;
  const clamp01 = (x) => Math.max(0, Math.min(100, x));

  const parts = [
    { n: "Disapproval",  v: clamp01((((D.approval?.disapprove ?? 50) - 35) / 30) * 100),
      why: `${D.approval?.disapprove ?? "—"}% disapprove (35% → 0, 65% → 100)` },
    { n: "Gas vs 1yr",   v: D.gas?.prev ? clamp01(((D.gas.v / D.gas.prev - 1) / 0.4) * 100) : null,
      why: D.gas?.prev ? `${pct(D.gas.v, D.gas.prev).toFixed(0)}% change (0 → 0, +40% → 100)` : "no year-ago figure" },
    { n: "CPI vs target",v: clamp01((((D.cpi?.v ?? 2) - 2) / 4) * 100),
      why: `${D.cpi?.v ?? "—"}% vs 2% target (2% → 0, 6% → 100)` },
    { n: "Tariff rate",  v: clamp01(((D.tariff?.v ?? 0) / 15) * 100),
      why: `${D.tariff?.v ?? "—"}% effective (0 → 0, 15% → 100)` },
    { n: "Debt growth",  v: clamp01(((((D.debt?.perSecond ?? 0) * 31557600) / 1e12) / 4) * 100),
      why: `$${(((D.debt?.perSecond ?? 0) * 31557600) / 1e12).toFixed(2)}T/yr (0 → 0, $4T → 100)` },
  ].filter((p) => p.v != null);

  const avg = parts.reduce((s, p) => s + p.v, 0) / (parts.length || 1);
  const hottest = parts.reduce((a, b) => (b.v > a.v ? b : a), parts[0]);

  box.innerHTML = `
    ${parts.map((p) => `
      <div class="mp">
        <div class="mp-top"><span>${esc(p.n)}</span><b>${p.v.toFixed(0)}</b></div>
        <div class="mp-track"><i style="width:${p.v.toFixed(1)}%;background:${heat(p.v)}"></i></div>
        <div class="mp-why">${esc(p.why)}</div>
      </div>`).join("")}
    <div class="mp-sum">Average of ${parts.length} components = <b>${avg.toFixed(1)}</b>.
      Biggest contributor right now: <b>${esc(hottest.n)}</b>.</div>`;
}

function heat(v) {
  const h = Math.round(120 - (v / 100) * 120);          // 120 green → 0 red
  return `hsl(${h} 72% 42%)`;
}

/* =====================================================================
   4. APPROVAL TUG-OF-WAR
   ===================================================================== */
function renderTug() {
  const box = $("#approvalTug");
  if (!box) return;
  const a = D.approval?.approve, d = D.approval?.disapprove;
  if (a == null || d == null) { box.innerHTML = ""; return; }
  const undecided = Math.max(0, 100 - a - d);
  const net = a - d;

  box.innerHTML = `
    <div class="tug">
      <div class="tug-bar">
        <i class="tug-a" style="width:${a}%"><span>${a.toFixed(1)}%</span></i>
        <i class="tug-u" style="width:${undecided.toFixed(1)}%">${undecided >= 6 ? `<span>${undecided.toFixed(0)}%</span>` : ""}</i>
        <i class="tug-d" style="width:${d}%"><span>${d.toFixed(1)}%</span></i>
      </div>
      <div class="tug-legend">
        <span><i class="sw sw-a"></i> approve</span>
        <span><i class="sw sw-u"></i> neither</span>
        <span><i class="sw sw-d"></i> disapprove</span>
      </div>
      <div class="tug-net ${net >= 0 ? "up" : "down"}">NET ${net >= 0 ? "+" : ""}${net.toFixed(1)} POINTS</div>
    </div>`;
}

/* ---------- run them all ---------- */
function renderCharts() {
  try { renderThenNow(); } catch (e) {}
  try { renderReceipt(); } catch (e) {}
  try { renderMeterBreakdown(); } catch (e) {}
  try { renderTug(); } catch (e) {}
}

/* charts.js loads after app.js, so app.js's call inside renderAll() happens
   before this file exists and its typeof guard silently skips it. Render on
   load, and again whenever fresh data lands. */
function initCharts() {
  renderCharts();
  document.addEventListener("cheeto:data", renderCharts);
}
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initCharts);
} else {
  initCharts();
}
