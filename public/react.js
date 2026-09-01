/* =====================================================================
   POST REACTIONS — one tap, live counts
   Loads after chat.js and shares its Supabase client and session.

   The emoji set is fixed in the database by a check constraint, not just here.
   That's deliberate: a free-text reaction would be user-generated content on
   every post, needing filtering, reporting and review. A closed set of five
   has no moderation surface, which is why it's five and not "pick any emoji".

   The set spans agreement and mockery on purpose. A row of nothing but jeers
   only lets one kind of person join in, and a counter nobody disagrees on
   isn't interesting to look at.
   ===================================================================== */

const RX_SET = [
  { e: "🇺🇸", label: "Based" },
  { e: "😂", label: "LOL" },
  { e: "🤯", label: "What" },
  { e: "💀", label: "Dead" },
  { e: "🔥", label: "Fire" },
];

const Rx = {
  counts: {},        // post_id -> { emoji: n }
  mine: {},          // post_id -> Set(emoji)
  loaded: 0,
  busy: new Set(),

  /* Scoped to any [data-rx] on the page, not just the Truth feed, so the same
     component serves user posts too. Board ids are namespaced "board:<id>" and
     Truth ids are the raw post id, so the two can never collide. */
  ids() {
    return [...document.querySelectorAll("[data-rx]")]
      .map((el) => el.dataset.rx).filter(Boolean).slice(0, 60);
  },

  async load(force) {
    const ids = this.ids();
    if (!ids.length) return;
    if (!sb) { this.paint(); return; }               // still render the buttons
    if (!force && Date.now() - this.loaded < 15000) { this.paint(); return; }

    try {
      const { data, error } = await sb.rpc("cheeto_reaction_counts", { ids });
      if (error) throw error;
      this.counts = {}; this.mine = {};
      (data || []).forEach((r) => {
        (this.counts[r.post_id] = this.counts[r.post_id] || {})[r.emoji] = Number(r.n);
        if (r.mine) (this.mine[r.post_id] = this.mine[r.post_id] || new Set()).add(r.emoji);
      });
      this.loaded = Date.now();
    } catch {
      // Counts are a nicety. If they can't be fetched the buttons still work,
      // and a failed read must never remove a working control from the page.
    }
    this.paint();
  },

  paint() {
    document.querySelectorAll("[data-rx]").forEach((box) => {
      const id = box.dataset.rx;
      const c = this.counts[id] || {};
      const m = this.mine[id] || new Set();
      const total = Object.values(c).reduce((s, n) => s + n, 0);

      box.innerHTML = RX_SET.map(({ e, label }) => {
        const n = c[e] || 0;
        const on = m.has(e);
        // Zero-count reactions stay visible so the row is tappable from cold —
        // a bar that only appears once somebody else has voted never starts.
        return `<button class="rx-b${on ? " on" : ""}" data-rxid="${esc(id)}" data-emoji="${e}"
          title="${esc(label)}${on ? " — tap to undo" : ""}" aria-pressed="${on}">
          <span class="rx-e">${e}</span>${n ? `<span class="rx-n">${n}</span>` : ""}</button>`;
      }).join("") + (total > 4 ? `<span class="rx-tot">${total} reactions</span>` : "");
    });
  },

  async tap(id, emoji, btn) {
    if (!sb) return;
    if (!me) {
      // Telling someone they need an account and then not offering one is
      // the most annoying possible response to a tap.
      promptSignIn("Reactions need an account — it's how the rate limit and ban list work. Reading and counting are open to everyone.");
      return;
    }
    const key = id + emoji;
    if (this.busy.has(key)) return;
    this.busy.add(key);

    const had = (this.mine[id] || new Set()).has(emoji);

    // Optimistic: the tap should feel instant. Rolled back below if the
    // database disagrees, so an over-count never survives a refusal.
    this.applyLocal(id, emoji, !had);
    this.paint();

    try {
      const { error } = had
        ? await sb.from("cheeto_reactions").delete()
            .eq("post_id", id).eq("user_id", me.id).eq("emoji", emoji)
        : await sb.from("cheeto_reactions")
            .insert({ post_id: id, user_id: me.id, emoji });
      if (error) throw error;
    } catch (err) {
      this.applyLocal(id, emoji, had);              // put it back
      this.paint();
      showModal("Reaction not saved", "&#9888;",
        `The database refused that.<br><br><span style="color:#555;font-size:11px">${esc(err?.message || "unknown error")}</span>
         <br><br>Usually that means your account is too new to post yet, or you're rate limited.`);
    } finally {
      this.busy.delete(key);
    }
  },

  applyLocal(id, emoji, add) {
    const c = (this.counts[id] = this.counts[id] || {});
    const m = (this.mine[id] = this.mine[id] || new Set());
    if (add) { c[emoji] = (c[emoji] || 0) + 1; m.add(emoji); }
    else { c[emoji] = Math.max(0, (c[emoji] || 1) - 1); m.delete(emoji); if (!c[emoji]) delete c[emoji]; }
  },
};

/* One delegated listener on the feed, so it survives every re-render rather
   than needing rebinding each time the feed repaints. */
document.addEventListener("click", (ev) => {
  const b = ev.target.closest?.(".rx-b");
  if (!b) return;
  ev.preventDefault();
  Rx.tap(b.dataset.rxid, b.dataset.emoji, b);
});

document.addEventListener("cheeto:data", () => Rx.load());
document.addEventListener("cheeto:auth", () => Rx.load(true));

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Rx.load());
} else {
  Rx.load();
}
