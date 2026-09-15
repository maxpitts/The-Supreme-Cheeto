/* =====================================================================
   THE CHEETO EXCHANGE — a voxel trading floor, inside a 1997 window.

   The joke is the frame: a 3D world running in a draggable Windows 95
   window on a fake desktop. Fullscreen would be a metaverse; a window is
   a program someone shipped on a CD-ROM in 1997, and that is funnier.

   The world is not set dressing. Every screen in here shows the site's
   real feed — the jumbotron is the actual Treasury debt figure ticking at
   the real per-second rate, the wall monitors are the same approval, gas
   and eggs numbers the desktop windows show, and the ticker band is the
   verbatim Truth feed. Same house rule as the rest of the site: real data
   from public sources, the framing carries the joke.

   ---------------------------------------------------------------------
   MULTIPLAYER: Broadcast, never Presence.

   Presence is broken on this Supabase project and has been since launch —
   a channel reports SUBSCRIBED, track() returns "ok", and presenceState()
   stays empty forever. That is why live.js counts people with a heartbeat
   and why dm.js polls.

   Broadcast, measured on this project from a real browser, is healthy:
   ~100ms round trip, 20/20 on a burst, and 36/36 delivered in order to a
   second client at 12Hz with no loss. So the roster here is built by hand
   out of broadcast messages — each client announces itself, and anyone not
   heard from in STALE_MS is removed. No presence API is touched anywhere
   in this file, deliberately. If someone "fixes" this later by switching
   to presence, the floor will silently empty.

   COST: broadcast fanout is O(n^2) — every mover's tick is delivered to
   every other person in the room. Three things keep that in hand, and all
   three matter: we only send while actually moving, we send at 8Hz rather
   than per-frame and interpolate the gaps, and a hidden tab sends nothing
   at all. That last one is not only politeness — Chrome throttles timers
   in background tabs to roughly 1Hz, so a backgrounded sender would emit
   garbage anyway.
   ===================================================================== */

const Exchange = {
  /* three.js is ~600KB. It is deliberately NOT in the service worker
     precache and NOT a <script> tag — it loads the first time someone
     opens the window and never for anyone who doesn't. */
  THREE_URL: "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js",

  TOPIC: "cheeto-exchange-floor",
  TICK_HZ: 8,
  STALE_MS: 6000,
  KEEPALIVE_MS: 2500,
  MAX_PEERS: 24,
  ROOM: 46,                 // floor is ROOM x ROOM units

  booted: false,
  running: false,
  loading: false,
  err: null,
  peers: new Map(),
  boards: [],
  keys: Object.create(null),
  self: { x: 0, z: 8, ry: Math.PI, moving: false },
  /* Camera sits high and looks at chest height rather than at the player's
     feet. Framed lower than this, a third of the screen is empty floor and
     the jumbotron crops off the top — which is the one thing in the room
     people are actually meant to look at. */
  cam: { yaw: Math.PI, dist: 10.5, height: 6.9, look: 2.6 },
  lastSend: 0,
  lastMoveSend: 0,
  raf: 0,

  /* ---------------------------------------------------------- lifecycle */
  init() {
    document.addEventListener("click", (ev) => {
      const el = ev.target.closest?.("[data-open-exchange]");
      if (!el) return;
      ev.preventDefault(); ev.stopPropagation();
      this.open();
    });
    document.addEventListener("visibilitychange", () => {
      // Both a courtesy and a correctness fix: a throttled background tab
      // cannot produce a sane tick, so it should produce none.
      if (document.visibilityState === "hidden") this.pause();
      else if (this.booted && !document.getElementById("w-exchange")?.hidden) this.resume();
    });
  },

  open() { WM.open("w-exchange"); },

  async boot() {
    if (this.loading) return;
    if (this.booted) { this.resume(); this.resize(); return; }
    this.loading = true;
    this.paintStatus("Loading the floor&hellip;");
    try {
      await this.loadThree();
      this.buildWorld();
      this.bindControls();
      this.connect();
      this.booted = true;
      this.err = null;
      this.resume();
    } catch (e) {
      this.err = String(e?.message || e);
      this.paintStatus(
        `<b>Couldn't open the floor.</b><br><span class="xc-err">${esc(this.err)}</span>` +
        `<br><br>Your browser may not support WebGL, or the 3D library didn't load.`);
    }
    this.loading = false;
  },

  paintStatus(html) {
    const el = document.getElementById("xcStatus");
    if (el) { el.hidden = false; el.innerHTML = html; }
  },
  hideStatus() { const el = document.getElementById("xcStatus"); if (el) el.hidden = true; },

  loadThree() {
    if (window.THREE) return Promise.resolve();
    return new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = this.THREE_URL;
      s.async = true;
      s.onload = () => window.THREE ? res() : rej(new Error("three.js loaded but defined nothing"));
      s.onerror = () => rej(new Error("could not fetch three.js"));
      document.head.appendChild(s);
      setTimeout(() => { if (!window.THREE) rej(new Error("three.js timed out")); }, 20000);
    });
  },

  /* ------------------------------------------------------------- world */
  buildWorld() {
    const T = window.THREE;
    const host = document.getElementById("xcCanvas");
    if (!host) throw new Error("no canvas host");

    this.scene = new T.Scene();
    this.scene.background = new T.Color(0x0b1016);
    this.scene.fog = new T.Fog(0x0b1016, 34, 78);

    this.camera = new T.PerspectiveCamera(58, 1, 0.1, 220);

    this.renderer = new T.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
    // Capped, not devicePixelRatio. A 3x phone screen rendering a 3D scene
    // at native density is how you turn a browser tab into a hand warmer.
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    host.appendChild(this.renderer.domElement);

    this.scene.add(new T.AmbientLight(0xffffff, 0.62));
    const key = new T.DirectionalLight(0xfff0dd, 0.85);
    key.position.set(12, 24, 8);
    this.scene.add(key);
    const fill = new T.DirectionalLight(0x66ccff, 0.3);
    fill.position.set(-14, 8, -12);
    this.scene.add(fill);

    const R = this.ROOM, H = 15;
    const box = (w, h, d, color, x, y, z, flat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d),
        new T.MeshLambertMaterial({ color, flatShading: !!flat }));
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };

    /* ---- floor: a chequer of two greys, built as one merged plane of
       tiles would be nicer, but 2 big planes + a grid helper is far cheaper
       and reads identically at this scale. */
    box(R, 0.6, R, 0x8d9299, 0, -0.3, 0);
    const grid = new T.GridHelper(R, R / 2, 0x3a4048, 0x2a3037);
    grid.position.y = 0.011;
    this.scene.add(grid);

    /* ---- walls + ceiling ---- */
    box(R, H, 1, 0x1d2430, 0, H / 2, -R / 2);
    box(1, H, R, 0x1d2430, -R / 2, H / 2, 0);
    box(1, H, R, 0x1d2430, R / 2, H / 2, 0);
    box(R, H, 1, 0x1d2430, 0, H / 2, R / 2);
    box(R, 1, R, 0x141a22, 0, H, 0);

    /* ---- columns: the neoclassical bit, rendered as blocks ---- */
    for (const cx of [-15, 15]) {
      for (const cz of [-14, 0, 14]) {
        box(2.2, H - 1, 2.2, 0xd8d2c4, cx, (H - 1) / 2, cz, true);
        box(3, 0.8, 3, 0xeae5d8, cx, H - 1.2, cz);
        box(3, 0.8, 3, 0xeae5d8, cx, 0.4, cz);
      }
    }

    /* ---- trading posts: chunky octagonal-ish podiums people gather at ---- */
    this.posts = [];
    const postAt = (x, z) => {
      const g = new T.Group();
      const base = new T.Mesh(new T.CylinderGeometry(2.6, 2.9, 1.5, 8),
        new T.MeshLambertMaterial({ color: 0x243447, flatShading: true }));
      base.position.y = 0.75;
      g.add(base);
      const top = new T.Mesh(new T.CylinderGeometry(2.8, 2.6, 0.3, 8),
        new T.MeshLambertMaterial({ color: 0xff7a00 }));
      top.position.y = 1.62;
      g.add(top);
      const mast = new T.Mesh(new T.BoxGeometry(0.35, 4.2, 0.35),
        new T.MeshLambertMaterial({ color: 0x11161d }));
      mast.position.y = 3.6;
      g.add(mast);
      g.position.set(x, 0, z);
      this.scene.add(g);
      this.posts.push(g);
      return g;
    };
    const POSTS = [[-8, -6], [8, -6], [-8, 6], [8, 6], [0, -13]];
    POSTS.forEach(([x, z]) => postAt(x, z));

    /* ------------------------------------------------- the screens ---- */
    this.boards = [];

    // Jumbotron: the debt. Biggest object in the room, as it should be.
    this.addBoard({
      w: 22, h: 5.5, x: 0, y: 8.6, z: -R / 2 + 1.1, ry: 0,
      px: 1024, py: 256, draw: (c, g) => this.drawDebt(c, g),
    });

    // Post-top monitors — one per trading post, each a different tracker.
    const MON = [
      { at: POSTS[0], draw: (c, g) => this.drawStat(c, g, "CHEETO-METER", this.vCheeto()) },
      { at: POSTS[1], draw: (c, g) => this.drawStat(c, g, "APPROVAL", this.vApproval()) },
      { at: POSTS[2], draw: (c, g) => this.drawStat(c, g, "GAS", this.vGas()) },
      { at: POSTS[3], draw: (c, g) => this.drawStat(c, g, "EGGS", this.vEggs()) },
      { at: POSTS[4], draw: (c, g) => this.drawStat(c, g, "GOLF DAYS", this.vGolf()) },
    ];
    MON.forEach((m, i) => {
      const [x, z] = POSTS[i];
      /* 512x300 rather than 360x210: these screens are small and far away,
         so the texture is heavily minified, and at the lower resolution the
         decimal points in "63.4" and "41.2%" were being filtered out of
         existence. A number that silently loses its decimal point is worse
         than no number. */
      this.addBoard({ w: 4.4, h: 2.2, x, y: 5.4, z, ry: 0, px: 1024, py: 512, draw: m.draw, double: true });
    });

    // Side wall monitors, angled in.
    this.addBoard({ w: 9, h: 4.5, x: -R / 2 + 1.1, y: 8, z: -6, ry: Math.PI / 2,
      px: 512, py: 256, draw: (c, g) => this.drawApprovalBars(c, g) });
    this.addBoard({ w: 9, h: 4.5, x: R / 2 - 1.1, y: 8, z: -6, ry: -Math.PI / 2,
      px: 512, py: 256, draw: (c, g) => this.drawEcon(c, g) });

    // The ticker band: verbatim Truth posts crawling around the back wall.
    this.tickerBoard = this.addBoard({
      w: R - 2, h: 1.4, x: 0, y: 4.6, z: -R / 2 + 1.1, ry: 0,
      px: 2048, py: 64, draw: (c, g) => this.drawTicker(c, g),
    });

    /* ---- the opening bell ----
       Every trading floor has one and it is the only object in here that
       does something purely because it is fun. Ringing it is broadcast, so
       it goes off for everybody standing on the floor at once. */
    const bellPost = new T.Group();
    const stand = new T.Mesh(new T.CylinderGeometry(0.9, 1.2, 1.4, 8),
      new T.MeshLambertMaterial({ color: 0x2a3444, flatShading: true }));
    stand.position.y = 0.7; bellPost.add(stand);
    const bell = new T.Mesh(new T.CylinderGeometry(0.55, 0.95, 1.1, 10),
      new T.MeshLambertMaterial({ color: 0xe8b53a, flatShading: true }));
    bell.position.y = 2.0; bellPost.add(bell);
    const yoke = new T.Mesh(new T.BoxGeometry(0.22, 1.1, 0.22),
      new T.MeshLambertMaterial({ color: 0x11161d }));
    yoke.position.y = 1.5; bellPost.add(yoke);
    bellPost.position.set(14, 0, 10);
    this.scene.add(bellPost);
    this.bell = bell;

    /* ---- what you can walk up to ----
       Each monitor is a shortcut to the desktop window that owns the same
       number, which is the point of putting the site inside a room: you
       walk to the thing you want and it opens the real window behind. */
    this.hot = [
      { x: -8, z: -6, r: 4.4, label: "THE_CHEETO-METER.EXE", win: "w-meter" },
      { x: 8, z: -6, r: 4.4, label: "APPROVAL_RATING.EXE", win: "w-polls" },
      { x: -8, z: 6, r: 4.4, label: "KITCHEN_TABLE.EXE", win: "w-econ" },
      { x: 8, z: 6, r: 4.4, label: "EGG_PRICES.EXE", win: "w-econ" },
      { x: 0, z: -13, r: 4.4, label: "GOLF_TRACKER.EXE", win: "w-golf" },
      { x: 0, z: -19, r: 6.0, label: "NATIONAL_DEBT.EXE", win: "w-debt" },
      { x: -16, z: -18, r: 5.0, label: "TRUTH_SOCIAL.EXE", win: "w-truth" },
      { x: 14, z: 10, r: 3.4, label: "RING THE OPENING BELL", act: "bell" },
    ];
    this.near = null;

    /* ---- the player ---- */
    this.avatar = this.buildBody(this.myColor(), true);
    this.scene.add(this.avatar);

    /* ---- NPC traders: the floor should never look abandoned ---- */
    this.npcs = [];
    const NPC_COLORS = [0xd94f4f, 0x4f7fd9, 0x51b06a, 0xc9a227, 0x8a5fd9, 0xcf6a2e];
    for (let i = 0; i < 14; i++) {
      const g = this.buildBody(NPC_COLORS[i % NPC_COLORS.length], false);
      const a = (i / 14) * Math.PI * 2;
      const r = 7 + (i % 4) * 3.4;
      g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
      g.userData = { a, r, sp: 0.12 + (i % 5) * 0.045, bob: Math.random() * 6 };
      this.scene.add(g);
      this.npcs.push(g);
    }

    this.clock = new T.Clock();
    this.resize();
  },

  /* A screen. Canvas texture, redrawn only when its content changes — a
     texture upload every frame for five static monitors is pure waste. */
  addBoard({ w, h, x, y, z, ry, px, py, draw, double }) {
    const T = window.THREE;
    const canvas = document.createElement("canvas");
    canvas.width = px; canvas.height = py;
    const g2 = canvas.getContext("2d");
    const tex = new T.CanvasTexture(canvas);
    /* Mipmaps, and therefore power-of-two canvases everywhere.
       This is what was eating the decimal points. A screen 1024px wide
       displayed at ~150 screen pixels is a 7:1 minification; with
       LinearFilter and no mipmaps the GPU point-samples it, so a 2px
       decimal point either survives or vanishes depending on where the
       sample lands — which is why "41.2%" kept rendering as "41 2%" and
       "$4.081" as "4 .081". Mipmapping averages it down instead, so the
       dot becomes a soft pixel rather than disappearing. WebGL1 only
       mipmaps power-of-two textures, hence the sizes above. */
    tex.generateMipmaps = true;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.magFilter = T.LinearFilter;
    tex.anisotropy = this.renderer.capabilities?.getMaxAnisotropy?.() || 1;
    const mesh = new T.Mesh(new T.PlaneGeometry(w, h),
      new T.MeshBasicMaterial({ map: tex, side: double ? T.DoubleSide : T.FrontSide }));
    mesh.position.set(x, y, z);
    mesh.rotation.y = ry || 0;
    this.scene.add(mesh);

    // Bezel behind it, so a screen reads as a screen and not a floating decal.
    const bez = new T.Mesh(new T.BoxGeometry(w + 0.5, h + 0.5, 0.3),
      new T.MeshLambertMaterial({ color: 0x0c1016 }));
    bez.position.set(x, y, z);
    bez.rotation.y = ry || 0;
    bez.translateZ(-0.22);
    this.scene.add(bez);

    const b = { canvas, g: g2, tex, draw, last: "" };
    this.boards.push(b);
    this.paintBoard(b, true);
    return b;
  },

  paintBoard(b, force) {
    const sig = b.draw(b.canvas, b.g, true);      // draw returns a signature
    if (!force && sig === b.last) return;
    b.last = sig;
    b.tex.needsUpdate = true;
  },

  /* Draw text at the largest size that still fits the width available.
     Every value on these screens comes from a live feed, so its length is
     not ours to predict — the debt gains a digit, a percentage goes to
     three figures, a price gains a decimal. Rather than picking font sizes
     that happen to suit today's numbers, measure and shrink. */
  fit(g, text, cx, y, maxW, startPx, weight) {
    let px = startPx;
    const set = () => { g.font = `${weight || "bold"} ${px}px 'Courier New', monospace`; };
    set();
    while (px > 8 && g.measureText(text).width > maxW) { px -= 2; set(); }
    g.fillText(text, cx, y);
    return px;
  },

  /* -------------------------------------------------- screen contents */
  D() { return (typeof D === "object" && D) ? D : null; },

  debtNow() {
    const d = this.D()?.debt;
    if (!d || !isFinite(d.amount)) return null;
    // Same extrapolation the desktop odometer uses, so the two agree.
    const base = Date.parse(d.asOf + "T00:00:00Z");
    const secs = isFinite(base) ? (Date.now() - base) / 1000 : 0;
    return d.amount + (Number(d.perSecond) || 0) * Math.max(0, secs);
  },

  vCheeto()   { const v = this.D()?.cheeto; return isFinite(v) ? v.toFixed(1) : "—"; },
  vApproval() { const a = this.D()?.approval; return a && isFinite(a.approve) ? a.approve.toFixed(1) + "%" : "—"; },
  vGas()      { const g = this.D()?.gas; return g && isFinite(g.v) ? "$" + g.v.toFixed(3) : "—"; },
  vEggs()     { const e = this.D()?.eggs; return e && isFinite(e.v) ? "$" + e.v.toFixed(3) : "—"; },
  vGolf()     { const g = this.D()?.golf; return g && isFinite(g.days) ? String(g.days) : "—"; },

  drawDebt(c, g) {
    const n = this.debtNow();
    const txt = n == null ? "—" :
      "$" + Math.floor(n).toLocaleString("en-US");
    g.fillStyle = "#04070a"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#0d1a12"; g.fillRect(8, 8, c.width - 16, c.height - 16);
    g.textAlign = "center";
    g.font = "bold 30px 'Courier New', monospace";
    g.fillStyle = "#7d8a80";
    g.fillText("UNITED STATES NATIONAL DEBT", c.width / 2, 46);
    g.fillStyle = "#2bff88";
    this.fit(g, txt, c.width / 2, 140, c.width - 48, 92);
    g.font = "20px 'Courier New', monospace";
    g.fillStyle = "#5f6d64";
    const per = this.D()?.debt?.perSecond;
    g.fillText(isFinite(per) ? `+$${Number(per).toLocaleString("en-US")} EVERY SECOND · TREASURY, DEBT TO THE PENNY`
                             : "SOURCE: TREASURY, DEBT TO THE PENNY", c.width / 2, 186);
    g.font = "17px 'Courier New', monospace";
    g.fillStyle = "#3d4a42";
    g.fillText("THE CHEETO EXCHANGE", c.width / 2, 226);
    return txt;
  },

  drawStat(c, g, label, value) {
    g.fillStyle = "#04070a"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#0a1420"; g.fillRect(6, 6, c.width - 12, c.height - 12);
    g.textAlign = "center";
    g.fillStyle = "#7c8ca1";
    this.fit(g, label, c.width / 2, 120, c.width - 70, 66);
    g.fillStyle = "#ffb04a";
    this.fit(g, value, c.width / 2, 330, c.width - 70, 210);
    g.font = "34px 'Courier New', monospace";
    g.fillStyle = "#4c5a6a";
    g.fillText("LIVE · PUBLIC SOURCES", c.width / 2, 440);
    return label + value;
  },

  drawApprovalBars(c, g) {
    const a = this.D()?.approval;
    const ap = a && isFinite(a.approve) ? a.approve : null;
    const di = a && isFinite(a.disapprove) ? a.disapprove : null;
    g.fillStyle = "#04070a"; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = "left";
    g.font = "bold 28px 'Courier New', monospace";
    g.fillStyle = "#7d8a95";
    g.fillText("APPROVAL", 24, 44);
    const bar = (y, pct, col, lbl) => {
      g.fillStyle = "#121a22"; g.fillRect(24, y, c.width - 48, 46);
      if (pct != null) { g.fillStyle = col; g.fillRect(24, y, (c.width - 48) * (pct / 100), 46); }
      g.fillStyle = "#fff";
      g.font = "bold 24px 'Courier New', monospace";
      g.fillText(`${lbl} ${pct == null ? "—" : pct.toFixed(1) + "%"}`, 36, y + 32);
    };
    bar(68, ap, "#2f8f3f", "APPROVE");
    bar(126, di, "#a83232", "DISAPPROVE");
    g.font = "16px 'Courier New', monospace";
    g.fillStyle = "#4a5661";
    g.fillText("POLLING AVERAGE · fiftyplusone.news", 24, 214);
    return `${ap}|${di}`;
  },

  drawEcon(c, g) {
    const d = this.D() || {};
    const rows = [
      ["GAS", this.vGas()],
      ["EGGS", this.vEggs()],
      ["CPI", isFinite(d.cpi?.v) ? d.cpi.v.toFixed(1) + "%" : "—"],
      ["TARIFF", isFinite(d.tariff?.v) ? d.tariff.v.toFixed(1) + "%" : "—"],
    ];
    g.fillStyle = "#04070a"; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = "left";
    g.font = "bold 28px 'Courier New', monospace";
    g.fillStyle = "#7d8a95";
    g.fillText("KITCHEN TABLE", 24, 42);
    g.font = "bold 32px 'Courier New', monospace";
    rows.forEach(([k, v], i) => {
      const y = 88 + i * 42;
      g.fillStyle = "#63707d"; g.fillText(k, 24, y);
      g.fillStyle = "#ffb04a"; g.textAlign = "right";
      g.fillText(v, c.width - 24, y);
      g.textAlign = "left";
    });
    return rows.map((r) => r[1]).join("|");
  },

  /* The crawl. Verbatim post text, exactly as the feed window shows it —
     no paraphrasing anywhere on this site, including in here. */
  tickerText() {
    const list = this.D()?.posts?.list || [];
    const bits = list.slice(0, 8).map((p) =>
      p.text ? p.text.replace(/\s+/g, " ").slice(0, 220)
             : `[ ${p.note || "no caption"} ]`);
    if (!bits.length) return "THE CHEETO EXCHANGE  ///  NO POSTS ON THE WIRE  ///  ";
    return bits.join("   ///   ") + "   ///   ";
  },

  drawTicker(c, g) {
    const txt = this.tickerText();
    g.fillStyle = "#12080a"; g.fillRect(0, 0, c.width, c.height);
    g.font = "bold 36px 'Courier New', monospace";
    g.textAlign = "left";
    g.fillStyle = "#ff5d3b";
    const w = g.measureText(txt).width || 1;
    let x = -((this._tick || 0) % (w + 80));
    // Draw twice so the tail seamlessly follows the head.
    while (x < c.width) { g.fillText(txt, x, 45); x += w + 80; }
    return "t";                                   // always repaints; it moves
  },

  /* ------------------------------------------------------------ bodies */
  myColor() {
    const src = (typeof me === "object" && me?.id) ? String(me.id) : "anon";
    let h = 0;
    for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) >>> 0;
    const PAL = [0xff7a00, 0x37b6ff, 0x53c46b, 0xe0c341, 0xa06bdd, 0xf2603c, 0x21c2b0, 0xe8628f];
    return PAL[h % PAL.length];
  },

  myName() {
    if (typeof me === "object" && me) {
      const p = (typeof myProfile === "object" && myProfile) ? myProfile : null;
      return (p?.display_name || p?.handle || "TRADER").toString().slice(0, 18);
    }
    return "GUEST";
  },

  buildBody(color, isSelf) {
    const T = window.THREE;
    const g = new T.Group();
    const part = (w, h, d, col, x, y, z) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), new T.MeshLambertMaterial({ color: col }));
      m.position.set(x, y, z);
      g.add(m);
      return m;
    };
    part(1.1, 1.3, 0.62, color, 0, 1.45, 0);               // torso
    part(0.34, 1.0, 0.34, 0x22303f, -0.32, 0.5, 0);        // legs
    part(0.34, 1.0, 0.34, 0x22303f, 0.32, 0.5, 0);
    g.userData.armL = part(0.28, 1.0, 0.28, color, -0.72, 1.45, 0);
    g.userData.armR = part(0.28, 1.0, 0.28, color, 0.72, 1.45, 0);
    const head = part(0.82, 0.78, 0.78, 0xf2a25c, 0, 2.5, 0);
    head.material.flatShading = true;
    part(0.86, 0.22, 0.82, 0xf3dc86, 0, 2.92, 0);          // the hair
    part(0.1, 0.12, 0.06, 0x101010, -0.18, 2.56, 0.4);     // eyes
    part(0.1, 0.12, 0.06, 0x101010, 0.18, 2.56, 0.4);
    part(0.2, 0.9, 0.08, 0xc02a2a, 0, 1.5, 0.34);          // the tie
    if (isSelf) {
      // A ring under your own feet — in third person on a busy floor you
      // lose track of which blocky person is you within about four seconds.
      const ring = new T.Mesh(new T.RingGeometry(0.85, 1.05, 20),
        new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55,
                                  side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.03;
      g.add(ring);
    }
    return g;
  },

  nameTag(text) {
    const T = window.THREE;
    const c = document.createElement("canvas");
    c.width = 256; c.height = 64;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(6,10,14,.82)";
    g.fillRect(0, 0, 256, 64);
    g.strokeStyle = "#ff7a00"; g.lineWidth = 3; g.strokeRect(1.5, 1.5, 253, 61);
    g.font = "bold 30px 'Courier New', monospace";
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(text).slice(0, 14), 128, 34);
    const tex = new T.CanvasTexture(c);
    tex.minFilter = T.LinearFilter;
    const s = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    s.scale.set(2.6, 0.65, 1);
    s.position.y = 3.65;
    return s;
  },

  /* ------------------------------------------------------ interaction */
  nearest() {
    let best = null, bd = Infinity;
    for (const h of this.hot || []) {
      const d = Math.hypot(h.x - this.self.x, h.z - this.self.z);
      if (d < h.r && d < bd) { bd = d; best = h; }
    }
    return best;
  },

  paintPrompt() {
    const el = document.getElementById("xcPrompt");
    if (!el) return;
    const h = this.near;
    el.hidden = !h;
    if (h) el.innerHTML = `<b>${esc(h.label)}</b><span class="xc-key">E</span>`;
  },

  activate() {
    const h = this.near;
    if (!h) return;
    if (h.act === "bell") { this.ringBell(true); return; }
    if (h.win) {
      WM.open(h.win);
      // Deliberately does NOT close the Exchange. Two windows open at once
      // is the entire aesthetic of this site.
      if (typeof Sfx === "object") Sfx.play("winOpen");
    }
  },

  /* --------------------------------------------------------- the bell */
  ringBell(mine) {
    this._bellT = performance.now();
    if (typeof Sfx === "object") Sfx.play("chime");
    if (mine && this.chan && this.netOK) {
      this.chan.send({ type: "broadcast", event: "bell",
                       payload: { id: this.id, n: this.myName() } });
    }
  },

  flash(msg) {
    const el = document.getElementById("xcFlash");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(this._flashT);
    this._flashT = setTimeout(() => { el.hidden = true; }, 3200);
  },

  /* ------------------------------------------------------------ emotes
     A fixed palette, not a text box. Broadcast cannot be moderated —
     anything a client can put on the channel reaches every other client
     without passing through Postgres, so a free-text field here would be
     an unfilterable public channel on a site whose every other word goes
     through an RLS-enforced blocklist. Six emoji cannot be abused into
     anything the site doesn't already show on its own reaction buttons. */
  EMOTES: ["\u{1F1FA}\u{1F1F8}", "\u{1F602}", "\u{1F92F}", "\u{1F480}", "\u{1F525}", "\u{1F4C8}"],

  emote(ch) {
    if (!this.EMOTES.includes(ch)) return;          // never trust the caller
    this.bubble(this.avatar, ch);
    if (this.chan && this.netOK) {
      this.chan.send({ type: "broadcast", event: "emote", payload: { id: this.id, e: ch } });
    }
  },

  bubble(group, ch) {
    if (!group) return;
    const T = window.THREE;
    if (group.userData.bub) { group.remove(group.userData.bub); group.userData.bub = null; }
    const c = document.createElement("canvas");
    c.width = 128; c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(255,255,255,.94)";
    g.beginPath();
    (g.roundRect ? g.roundRect(6, 6, 116, 100, 16) : g.rect(6, 6, 116, 100));
    g.fill();
    g.font = "72px serif";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(ch, 64, 58);
    const tex = new T.CanvasTexture(c);
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.5, 1.5, 1);
    sp.position.y = 4.6;
    group.add(sp);
    group.userData.bub = sp;
    clearTimeout(group.userData.bubT);
    group.userData.bubT = setTimeout(() => {
      if (group.userData.bub === sp) { group.remove(sp); group.userData.bub = null; }
      tex.dispose(); sp.material.dispose();
    }, 6000);
  },

  /* ---------------------------------------------------------- controls */
  bindControls() {
    const host = document.getElementById("xcCanvas");
    const dom = this.renderer.domElement;
    dom.style.touchAction = "none";

    const down = (e) => {
      // Only while the window has focus, or WASD steals typing everywhere else.
      if (!this.running) return;
      const t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright"].includes(k)) {
        this.keys[k] = true;
        e.preventDefault();
      }
      if (k === "e") { this.activate(); e.preventDefault(); }
    };
    const up = (e) => { this.keys[e.key.toLowerCase()] = false; };
    document.addEventListener("keydown", down);
    document.addEventListener("keyup", up);
    this._unkey = () => {
      document.removeEventListener("keydown", down);
      document.removeEventListener("keyup", up);
    };

    /* Drag to look. Pointer events so mouse and touch are one code path —
       pointer lock is tempting but a locked cursor inside a draggable
       window that the person still has to move and close is hostile. */
    let dragging = false, lastX = 0;
    dom.addEventListener("pointerdown", (e) => {
      dragging = true; lastX = e.clientX;
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.cam.yaw -= (e.clientX - lastX) * 0.007;
      lastX = e.clientX;
    });
    const endDrag = (e) => { dragging = false; dom.releasePointerCapture?.(e.pointerId); };
    dom.addEventListener("pointerup", endDrag);
    dom.addEventListener("pointercancel", endDrag);

    /* Touch stick. Only rendered on coarse pointers; see the CSS. */
    const stick = document.getElementById("xcStick");
    const knob = document.getElementById("xcKnob");
    if (stick && knob) {
      let sid = null, cx = 0, cy = 0;
      const start = (e) => {
        sid = e.pointerId; const r = stick.getBoundingClientRect();
        cx = r.left + r.width / 2; cy = r.top + r.height / 2;
        stick.setPointerCapture?.(sid);
        e.preventDefault();
      };
      const move = (e) => {
        if (e.pointerId !== sid) return;
        const dx = e.clientX - cx, dy = e.clientY - cy;
        const R = 42, d = Math.hypot(dx, dy) || 1, k = Math.min(1, R / d);
        knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
        this.stick = { x: Math.max(-1, Math.min(1, dx / R)), y: Math.max(-1, Math.min(1, dy / R)) };
        e.preventDefault();
      };
      const end = (e) => {
        if (e.pointerId !== sid) return;
        sid = null; this.stick = null;
        knob.style.transform = "translate(0,0)";
      };
      stick.addEventListener("pointerdown", start);
      stick.addEventListener("pointermove", move);
      stick.addEventListener("pointerup", end);
      stick.addEventListener("pointercancel", end);
    }

    document.getElementById("xcPrompt")?.addEventListener("click", () => this.activate());
    document.querySelectorAll("[data-xc-emote]").forEach((b) =>
      b.addEventListener("click", () => this.emote(b.dataset.xcEmote)));

    this._ro = new ResizeObserver(() => this.resize());
    if (host) this._ro.observe(host);
  },

  resize() {
    const host = document.getElementById("xcCanvas");
    if (!host || !this.renderer) return;
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  },

  /* -------------------------------------------------------- networking */
  connect() {
    if (!window.sb || this.chan) return;
    this.id = (typeof me === "object" && me?.id)
      ? "u" + me.id.slice(0, 8)
      : "g" + Math.random().toString(36).slice(2, 10);

    this.chan = sb.channel(this.TOPIC, { config: { broadcast: { self: false } } });

    this.chan.on("broadcast", { event: "move" }, (m) => this.onPeer(m.payload));
    this.chan.on("broadcast", { event: "bye" }, (m) => this.dropPeer(m.payload?.id));
    this.chan.on("broadcast", { event: "emote" }, (m) => {
      const e = this.peers.get(m.payload?.id);
      if (e && this.EMOTES.includes(m.payload?.e)) this.bubble(e.g, m.payload.e);
    });
    this.chan.on("broadcast", { event: "bell" }, (m) => {
      this.ringBell(false);
      this.flash(`${String(m.payload?.n || "Someone").slice(0, 18)} rang the opening bell`);
    });
    this.chan.subscribe((status) => {
      this.netOK = status === "SUBSCRIBED";
      this.paintHud();
      // Announce immediately so people already standing there see you
      // without waiting for your first step.
      if (this.netOK) this.send(true);
    });

    // Say goodbye on the way out. Best effort — the STALE_MS sweep is the
    // real guarantee, because a closed laptop never sends anything.
    this._bye = () => { try { this.chan?.send({ type: "broadcast", event: "bye", payload: { id: this.id } }); } catch {} };
    window.addEventListener("pagehide", this._bye);
  },

  send(force) {
    if (!this.chan || !this.netOK) return;
    if (document.visibilityState === "hidden") return;
    const now = Date.now();
    const gap = 1000 / this.TICK_HZ;
    if (!force) {
      // Moving: tick. Standing still: a keepalive every few seconds so the
      // other clients' stale sweep doesn't delete a motionless person.
      if (this.self.moving) { if (now - this.lastSend < gap) return; }
      else if (now - this.lastSend < this.KEEPALIVE_MS) return;
    }
    this.lastSend = now;
    this.chan.send({
      type: "broadcast", event: "move",
      payload: {
        id: this.id, n: this.myName(), c: this.myColor(),
        x: +this.self.x.toFixed(2), z: +this.self.z.toFixed(2),
        ry: +this.self.ry.toFixed(2), mv: this.self.moving ? 1 : 0,
      },
    });
  },

  onPeer(p) {
    if (!p || !p.id || p.id === this.id) return;
    let e = this.peers.get(p.id);
    if (!e) {
      if (this.peers.size >= this.MAX_PEERS) return;   // a room has a capacity
      const g = this.buildBody(Number(p.c) || 0x888888, false);
      g.add(this.nameTag(p.n || "TRADER"));
      g.position.set(Number(p.x) || 0, 0, Number(p.z) || 0);
      this.scene.add(g);
      e = { g, tx: g.position.x, tz: g.position.z, try_: g.rotation.y, mv: 0, last: 0 };
      this.peers.set(p.id, e);
      this.paintHud();
    }
    // Store as a TARGET. Snapping to each packet at 8Hz looks like a
    // slideshow; the frame loop eases toward these.
    e.tx = Number(p.x) || 0;
    e.tz = Number(p.z) || 0;
    e.try_ = Number(p.ry) || 0;
    e.mv = p.mv ? 1 : 0;
    e.last = Date.now();
  },

  dropPeer(id) {
    const e = this.peers.get(id);
    if (!e) return;
    this.scene.remove(e.g);
    e.g.traverse?.((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); });
    this.peers.delete(id);
    this.paintHud();
  },

  sweep() {
    const now = Date.now();
    for (const [id, e] of this.peers) if (now - e.last > this.STALE_MS) this.dropPeer(id);
  },

  paintHud() {
    const el = document.getElementById("xcHud");
    if (!el) return;
    const n = this.peers.size + 1;
    el.innerHTML = this.netOK
      ? `<b>${n}</b> on the floor`
      : `<span class="xc-off">offline &mdash; you're alone in here</span>`;
  },

  /* ------------------------------------------------------------- loop */
  resume() {
    if (this.running || !this.booted) return;
    this.running = true;
    this.clock?.start();
    const step = () => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(step);
      this.frame();
    };
    this.raf = requestAnimationFrame(step);
    this.hideStatus();
  },

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  },

  frame() {
    const T = window.THREE;
    /* Self-policing rather than hook-policing. The window can go away by
       being closed, minimised, or rolled up, and on a phone WM.close is a
       no-op entirely — so instead of trying to catch every one of those
       paths, the loop checks whether it is still on screen and stops if it
       isn't. A 3D render loop running behind a closed window is the single
       most expensive bug this file could ship with. */
    const win = document.getElementById("w-exchange");
    if (!win || win.hidden) { this.pause(); return; }

    const dt = Math.min(0.05, this.clock.getDelta());
    const t = performance.now() / 1000;

    /* ---- input -> intent ---- */
    let ix = 0, iz = 0;
    if (this.keys.w || this.keys.arrowup) iz -= 1;
    if (this.keys.s || this.keys.arrowdown) iz += 1;
    if (this.keys.a || this.keys.arrowleft) ix -= 1;
    if (this.keys.d || this.keys.arrowright) ix += 1;
    if (this.stick) { ix += this.stick.x; iz += this.stick.y; }
    const mag = Math.hypot(ix, iz);
    this.self.moving = mag > 0.12;

    if (this.self.moving) {
      // Movement is relative to where the camera is looking, which is what
      // every third-person control scheme since about 1998 has done.
      const yaw = this.cam.yaw;
      const fx = Math.sin(yaw), fz = Math.cos(yaw);
      const dx = (ix * fz - iz * fx) / (mag || 1);
      const dz = (-ix * fx - iz * fz) / (mag || 1);
      const SPEED = 7.2;
      const lim = this.ROOM / 2 - 2.2;
      this.self.x = Math.max(-lim, Math.min(lim, this.self.x + dx * SPEED * dt));
      this.self.z = Math.max(-lim, Math.min(lim, this.self.z + dz * SPEED * dt));
      this.self.ry = Math.atan2(dx, dz);
    }

    /* ---- our body ---- */
    const a = this.avatar;
    a.position.set(this.self.x, 0, this.self.z);
    a.rotation.y = this.self.ry;
    this.swing(a, this.self.moving, t);

    /* ---- camera: trail behind, ease in, and STAY IN THE ROOM ----
       Without the clamp the camera walks straight through the walls: at the
       old spawn of z=14 the camera trailed to z=24.5 while the back wall is
       at 23, so the world opened with the view already outside the building
       looking in through a wall. That is what "the scaling is off" actually
       was — not the scale of anything, but a camera standing in the street. */
    const wall = this.ROOM / 2 - 1.6;
    const cx = Math.max(-wall, Math.min(wall, this.self.x - Math.sin(this.cam.yaw) * this.cam.dist));
    const cz = Math.max(-wall, Math.min(wall, this.self.z - Math.cos(this.cam.yaw) * this.cam.dist));
    this.camera.position.lerp(new T.Vector3(cx, this.cam.height, cz), 1 - Math.pow(0.0016, dt));
    this.camera.lookAt(this.self.x, this.cam.look, this.self.z);

    /* ---- peers: ease toward their last known target ---- */
    const k = 1 - Math.pow(0.0009, dt);
    for (const e of this.peers.values()) {
      e.g.position.x += (e.tx - e.g.position.x) * k;
      e.g.position.z += (e.tz - e.g.position.z) * k;
      let d = e.try_ - e.g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.g.rotation.y += d * k;
      this.swing(e.g, e.mv === 1, t);
    }

    /* ---- NPCs ---- */
    for (const n of this.npcs) {
      const u = n.userData;
      u.a += u.sp * dt;
      n.position.x = Math.cos(u.a) * u.r;
      n.position.z = Math.sin(u.a) * u.r;
      n.rotation.y = -u.a + Math.PI / 2;
      this.swing(n, true, t + u.bob);
    }

    /* ---- screens ---- */
    this._tick = (this._tick || 0) + dt * 190;
    this.paintBoard(this.tickerBoard, true);
    // Everything else only when its content actually changed. The debt
    // board changes constantly, the rest almost never — paintBoard's
    // signature check sorts that out without a special case per screen.
    if (!this._boardT || t - this._boardT > 0.2) {
      this._boardT = t;
      for (const b of this.boards) if (b !== this.tickerBoard) this.paintBoard(b, false);
    }

    /* ---- what you're standing next to ---- */
    const n = this.nearest();
    if (n !== this.near) { this.near = n; this.paintPrompt(); }

    /* ---- the bell swings when it's been rung ---- */
    if (this.bell) {
      const age = (performance.now() - (this._bellT || -1e9)) / 1000;
      this.bell.rotation.z = age < 2 ? Math.sin(age * 22) * 0.28 * (1 - age / 2) : 0;
    }

    /* ---- net ---- */
    this.send(false);
    if (!this._sweepT || t - this._sweepT > 1) { this._sweepT = t; this.sweep(); }

    this.renderer.render(this.scene, this.camera);
  },

  swing(g, moving, t) {
    const L = g.userData?.armL, R = g.userData?.armR;
    if (!L || !R) return;
    const s = moving ? Math.sin(t * 9) * 0.55 : Math.sin(t * 1.6) * 0.06;
    L.rotation.x = s; R.rotation.x = -s;
    g.position.y = moving ? Math.abs(Math.sin(t * 9)) * 0.09 : 0;
  },

  /* --------------------------------------------------------- teardown */
  shutdown() {
    this.pause();
    this._bye?.();
    try { window.removeEventListener("pagehide", this._bye); } catch {}
    try { if (this.chan) sb.removeChannel(this.chan); } catch {}
    this.chan = null; this.netOK = false;
  },
};

/* Both entry points run through WM.open, same as SUPREME.EXE, so a desktop
   icon can't bypass boot. */
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => Exchange.init());
} else {
  Exchange.init();
}
