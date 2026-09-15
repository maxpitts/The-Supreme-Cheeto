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

  /* ------------------------------------------------------ AD INVENTORY
     Sellable slots on the floor. Fill an entry to sell a board; leave it
     out and the slot shows ADVERTISE HERE with the site address on it,
     which is itself the pitch. Selling a slot is editing this array and
     nothing else.

     Deliberately not pre-filled with STAX — that partnership ended, and a
     house ad for a lapsed partner is worse than an empty slot. Slot 1 is a
     T&G house ad; change or remove it freely.

     Shape: { slot: <index>, title, line, tint }  — text only, on purpose.
     An image here would mean fetching a third-party asset into the world
     on every load, and the 90s screen look is better served by type. */
  ADS: [
    { slot: 1, title: "TRADES & GAINS", line: "tradesandgains.io", tint: 0x1a4a8a },
  ],

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
  self: { x: 0, z: 2, ry: Math.PI, moving: false },
  /* Camera sits high and looks at chest height rather than at the player's
     feet. Framed lower than this, a third of the screen is empty floor and
     the jumbotron crops off the top — which is the one thing in the room
     people are actually meant to look at. */
    /* Orbit camera. yaw and pitch both come from dragging, dist from the
     wheel or a pinch — the fixed height/look pair this replaced could only
     ever frame one part of the room, which is why the flag and the big
     boards kept ending up off the top of the screen. */
  cam: { yaw: Math.PI, pitch: 0.22, dist: 11.5 },
  PITCH_MIN: -0.30, PITCH_MAX: 0.95, DIST_MIN: 5, DIST_MAX: 22,
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

  /* One texture for all fifty-five small screens.
     The rim screens on the posts and the booth monitors were plain black
     boxes — from inside the room that reads as "every screen is off",
     which is exactly how it was reported. Giving each its own canvas would
     mean fifty-five texture uploads a frame; instead there is ONE tall
     canvas of rows, and each screen's geometry has its UVs pointed at a
     different band of it. Repainting the canvas updates all of them at
     once, for the cost of a single upload. */
  DW_ROWS: 32,

  buildDataWall() {
    const T = window.THREE;
    const c = document.createElement("canvas");
    c.width = 512; c.height = 1024;
    this.dwCanvas = c;
    this.dwG = c.getContext("2d");
    const tex = new T.CanvasTexture(c);
    tex.generateMipmaps = true;
    tex.minFilter = T.LinearMipmapLinearFilter;
    tex.anisotropy = this.renderer.capabilities?.getMaxAnisotropy?.() || 1;
    this.dwTex = tex;
    this.smallMat = new T.MeshBasicMaterial({ map: tex });
    this.paintDataWall();
    return this.smallMat;
  },

  paintDataWall() {
    const g = this.dwG, c = this.dwCanvas;
    if (!g) return;
    const d = this.D() || {};
    const debt = this.debtNow();
    // Real figures, repeated down the wall with a rolling offset so the
    // screens are never all showing the same line.
    const rows = [
      ["DEBT", debt == null ? "—" : "$" + Math.round(debt / 1e9).toLocaleString("en-US") + "B", 1],
      ["GAS", this.vGas(), isFinite(d.gas?.v) && isFinite(d.gas?.prev) ? (d.gas.v > d.gas.prev ? 1 : -1) : 0],
      ["EGGS", this.vEggs(), 0],
      ["CPI", isFinite(d.cpi?.v) ? d.cpi.v.toFixed(1) + "%" : "—", 0],
      ["APPR", this.vApproval(), -1],
      ["DISA", isFinite(d.approval?.disapprove) ? d.approval.disapprove.toFixed(1) + "%" : "—", 1],
      ["TARIFF", isFinite(d.tariff?.v) ? d.tariff.v.toFixed(1) + "%" : "—", 1],
      ["CHEETO", this.vCheeto(), 0],
      ["GOLF", this.vGolf(), 1],
      ["EO", isFinite(d.eo?.orders) ? String(d.eo.orders) : "—", 1],
      ["FLOOR", String(this.peers.size + 1), 0],
      ["POSTS", String((d.posts?.list || []).length), 0],
    ];
    const RH = c.height / this.DW_ROWS;
    g.fillStyle = "#05090d"; g.fillRect(0, 0, c.width, c.height);
    const roll = Math.floor((this._dwRoll || 0));
    for (let i = 0; i < this.DW_ROWS; i++) {
      const [k, v, dir] = rows[(i + roll) % rows.length];
      const y = i * RH;
      if (i % 2) { g.fillStyle = "#0a1119"; g.fillRect(0, y, c.width, RH); }
      g.font = "bold 19px 'Courier New', monospace";
      g.textAlign = "left";
      g.fillStyle = "#5d6f83";
      g.fillText(k, 12, y + RH * 0.68);
      g.textAlign = "right";
      g.fillStyle = dir > 0 ? "#3ddc7a" : dir < 0 ? "#ff5f5f" : "#ffb04a";
      g.fillText((dir > 0 ? "\u25B2" : dir < 0 ? "\u25BC" : " ") + v, c.width - 12, y + RH * 0.68);
    }
    if (this.dwTex) this.dwTex.needsUpdate = true;
  },

  /* A screen plane whose UVs show one band of the shared wall. */
  smallScreen(w, h, band) {
    const T = window.THREE;
    const geo = new T.PlaneGeometry(w, h);
    const uv = geo.attributes.uv;
    const BANDS = 8;
    const b = band % BANDS;
    const v0 = b / BANDS, v1 = (b + 1) / BANDS;
    uv.setXY(0, 0, v1); uv.setXY(1, 1, v1); uv.setXY(2, 0, v0); uv.setXY(3, 1, v0);
    uv.needsUpdate = true;
    return new T.Mesh(geo, this.smallMat);
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

    this.buildDataWall();

    this.scene.add(new T.AmbientLight(0xffffff, 0.62));
    const key = new T.DirectionalLight(0xfff0dd, 0.85);
    key.position.set(12, 24, 8);
    this.scene.add(key);
    const fill = new T.DirectionalLight(0x66ccff, 0.3);
    fill.position.set(-14, 8, -12);
    this.scene.add(fill);

    const R = this.ROOM, H = 16;
    /* Declared here, not next to the trading posts. It used to be reset to
       [] halfway down buildWorld, which silently discarded every collider
       registered above that line — the columns and the wall booths — so
       two thirds of the room stayed walk-through. */
    this.colliders = [];
    const box = (w, h, d, color, x, y, z, flat) => {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d),
        new T.MeshLambertMaterial({ color, flatShading: !!flat }));
      m.position.set(x, y, z);
      this.scene.add(m);
      return m;
    };

    /* ---- floor ----
       Warm stone, not cold grey. The real floor is beige marble under warm
       light; a blue-grey room reads as an office, not an exchange. */
    box(R, 0.6, R, 0xa39b8c, 0, -0.3, 0);
    const grid = new T.GridHelper(R, R / 3, 0x6d6557, 0x8d8576);
    grid.position.y = 0.012;
    this.scene.add(grid);

    /* ---- walls + ceiling ---- */
    box(R, H, 1, 0x2a2118, 0, H / 2, -R / 2);
    box(1, H, R, 0x2a2118, -R / 2, H / 2, 0);
    box(1, H, R, 0x2a2118, R / 2, H / 2, 0);
    box(R, H, 1, 0x2a2118, 0, H / 2, R / 2);
    box(R, 1, R, 0x18120d, 0, H, 0);
    // A coffered band where wall meets ceiling — cheap, and it stops the
    // room reading as a cardboard box.
    box(R, 0.7, R - 2, 0x3a2e21, 0, H - 1, 0);

    /* ---- columns ---- */
    for (const cx of [-16, 16]) {
      for (const cz of [-15, 0, 15]) {
        this.colliders.push({ t: "b", x: cx, z: cz, hw: 1.5, hd: 1.5, h: 14 });
        box(2.2, H - 2, 2.2, 0xded5c2, cx, (H - 2) / 2, cz, true);
        box(3, 0.8, 3, 0xefe7d6, cx, H - 2.2, cz);
        box(3, 0.8, 3, 0xefe7d6, cx, 0.4, cz);
      }
    }

    /* ---- arched windows down the right wall ----
       Not real geometry — lit panels behind a frame. At this fidelity the
       only job is to say "daylight is over there", and a MeshBasicMaterial
       costs nothing because it ignores lighting entirely. */
    for (const wz of [-13, -4, 5, 14]) {
      const pane = new T.Mesh(new T.PlaneGeometry(4.6, 8),
        new T.MeshBasicMaterial({ color: 0xbcd8ee }));
      pane.position.set(R / 2 - 0.55, 7.5, wz);
      pane.rotation.y = -Math.PI / 2;
      this.scene.add(pane);
      box(0.4, 9, 5.4, 0x4a3a28, R / 2 - 0.75, 7.5, wz);
      const arch = new T.Mesh(new T.CylinderGeometry(2.7, 2.7, 0.4, 16, 1, false, 0, Math.PI),
        new T.MeshLambertMaterial({ color: 0x4a3a28 }));
      arch.rotation.z = -Math.PI / 2;
      arch.rotation.y = Math.PI / 2;
      arch.position.set(R / 2 - 0.75, 11.5, wz);
      this.scene.add(arch);
    }

    /* ---- perimeter booths down the left wall ---- */
    for (const bz of [-14, -7, 0, 7, 14]) {
      this.colliders.push({ t: "b", x: -R / 2 + 2.2, z: bz, hw: 1.5, hd: 2.6, h: 2.1 });
      box(2.6, 1.2, 5, 0x3d2f20, -R / 2 + 2.2, 0.6, bz);
      box(2.8, 0.18, 5.2, 0xb08d4a, -R / 2 + 2.2, 1.26, bz);
      for (const d of [-1.4, 0, 1.4]) {
        box(0.2, 1.15, 1.6, 0x0c1119, -R / 2 + 1.3, 1.9, bz + d);
        const scr = this.smallScreen(1.35, 0.9, bz + d);
        scr.position.set(-R / 2 + 1.42, 1.9, bz + d);
        scr.rotation.y = Math.PI / 2;
        this.scene.add(scr);
      }
    }

    /* ---- trading posts ----
       No mast. The monitors used to sit on a 4.2-unit black pole rising out
       of every post, which at eye height put a row of black bars straight
       across the middle of the view — fine in a plan, awful from inside the
       room. Real floors hang their displays from the ceiling, which both
       looks right and gets them out of the sightline entirely. */
    this.posts = [];
    /* Solid things. Walking through a trading post was the giveaway that
       this was a diorama rather than a room — you notice it within about
       two seconds of moving. Circles for the round objects, boxes for the
       square ones; resolved against the player every frame. */
    const postAt = (x, z, meta) => {
      const g = new T.Group();
      const base = new T.Mesh(new T.CylinderGeometry(2.7, 3.0, 1.5, 8),
        new T.MeshLambertMaterial({ color: 0x2b3340, flatShading: true }));
      base.position.y = 0.75;
      g.add(base);
      const trim = new T.Mesh(new T.CylinderGeometry(2.9, 2.7, 0.28, 8),
        new T.MeshLambertMaterial({ color: 0xb08d4a }));
      trim.position.y = 1.62;
      g.add(trim);
      // A bank of small screens around the rim, which is what a post is.
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const hous = new T.Mesh(new T.BoxGeometry(1.6, 1.05, 0.18),
          new T.MeshLambertMaterial({ color: 0x0c1119 }));
        hous.position.set(Math.cos(a) * 2.55, 2.3, Math.sin(a) * 2.55);
        hous.rotation.y = -a + Math.PI / 2;
        g.add(hous);
        const scr = this.smallScreen(1.34, 0.82, i + (x + z));
        scr.position.set(Math.cos(a) * 2.66, 2.3, Math.sin(a) * 2.66);
        scr.rotation.y = -a + Math.PI / 2;
        g.add(scr);
      }
      /* The terminal in the middle of the post. This is the thing you walk
         up to — the ceiling monitor tells you what the post IS from across
         the room, and this is what you actually use. Before it existed the
         middle of every post was a flat empty disc, which is both ugly and
         confusing: nothing said where to stand. */
      const ped = new T.Mesh(new T.CylinderGeometry(0.75, 0.95, 2.1, 8),
        new T.MeshLambertMaterial({ color: 0x1b2430, flatShading: true }));
      ped.position.y = 2.6; g.add(ped);
      const crt = new T.Mesh(new T.BoxGeometry(2.0, 1.6, 1.5),
        new T.MeshLambertMaterial({ color: 0xd8d2c4 }));
      crt.position.y = 4.35; crt.rotation.y = Math.PI / 8; g.add(crt);
      const face = new T.Mesh(new T.PlaneGeometry(1.5, 1.1),
        new T.MeshBasicMaterial({ color: meta.c }));
      face.position.set(Math.sin(Math.PI / 8) * 0.76, 4.4, Math.cos(Math.PI / 8) * 0.76);
      face.rotation.y = Math.PI / 8; g.add(face);
      g.userData.face = face;
      const kb = new T.Mesh(new T.BoxGeometry(1.5, 0.16, 0.6),
        new T.MeshLambertMaterial({ color: 0xc9c2b2 }));
      kb.position.set(0, 3.62, 0.85); g.add(kb);

      // Floor paint in the post's colour — the cheapest way to break up a
      // room that was otherwise beige from wall to wall.
      const ring = new T.Mesh(new T.RingGeometry(3.2, 4.5, 28),
        new T.MeshBasicMaterial({ color: meta.c, transparent: true, opacity: 0.22,
                                  side: T.DoubleSide }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.015, z);
      this.scene.add(ring);

      // A light in the post's colour, so the glow pools on the floor.
      const lamp = new T.PointLight(meta.c, 0.85, 16, 2);
      lamp.position.set(x, 8.2, z);
      this.scene.add(lamp);

      g.position.set(x, 0, z);
      this.scene.add(g);
      this.posts.push(g);
      this.colliders.push({ t: "c", x, z, r: 3.1, h: 3.0 });
      return g;
    };
    /* Each post is a colour and a name, used by its banner, its floor
       paint, its light and its terminal. One table so they can never drift
       apart — the failure mode otherwise is a green banner over an orange
       post, which reads as a bug even though nothing is broken. */
    const POSTS = [[-8, -6], [8, -6], [-8, 6], [8, 6], [0, -13]];
    this.POSTMETA = [
      { c: 0xff7a00, n: "CHEETO-METER", win: "w-meter" },
      { c: 0x2f7fe0, n: "APPROVAL",     win: "w-polls" },
      { c: 0x35b06a, n: "KITCHEN TABLE", win: "w-econ" },
      { c: 0xe0b020, n: "EGGS",         win: "w-econ" },
      { c: 0xd94f4f, n: "GOLF",         win: "w-golf" },
    ];
    POSTS.forEach(([x, z], i) => postAt(x, z, this.POSTMETA[i]));

    /* ---- order slips all over the floor ----
       One InstancedMesh, so sixty bits of litter cost one draw call. It is
       a small thing and it does more for "this is a trading floor" than any
       other object in here. */
    const slipGeo = new T.PlaneGeometry(0.42, 0.58);
    const slips = new T.InstancedMesh(slipGeo,
      new T.MeshLambertMaterial({ color: 0xf2ecdc, side: T.DoubleSide }), 90);
    const dummy = new T.Object3D();
    for (let i = 0; i < 90; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 19;
      dummy.position.set(Math.cos(a) * r, 0.02, Math.sin(a) * r);
      dummy.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI);
      dummy.updateMatrix();
      slips.setMatrixAt(i, dummy.matrix);
    }
    slips.instanceMatrix.needsUpdate = true;
    this.scene.add(slips);

    /* ------------------------------------------------- the screens ---- */
    this.boards = [];

    /* The flag. Every photograph of this building has it, and nothing else
       says "New York Stock Exchange" in one object. Drawn rather than
       loaded so there is no asset to fetch. */
    this.addBoard({
      w: 18, h: 5.2, x: 0, y: 13.1, z: -R / 2 + 1.05, ry: 0,
      px: 1024, py: 512, draw: (c, g) => this.drawFlag(c, g),
    });

    // Jumbotron: the debt. Biggest screen in the room, as it should be.
    this.addBoard({
      w: 20, h: 5, x: 0, y: 8.4, z: -R / 2 + 1.1, ry: 0,
      px: 1024, py: 256, draw: (c, g) => this.drawDebt(c, g),
    });

    // The big boards flanking it — rows of live figures with up/down marks.
    this.addBoard({
      w: 9.5, h: 6.4, x: -16.5, y: 8.6, z: -R / 2 + 1.1, ry: 0,
      px: 512, py: 512, draw: (c, g) => this.drawBigBoard(c, g, 0),
    });
    this.addBoard({
      w: 9.5, h: 6.4, x: 16.5, y: 8.6, z: -R / 2 + 1.1, ry: 0,
      px: 512, py: 512, draw: (c, g) => this.drawBigBoard(c, g, 1),
    });

    // Post monitors, hung from the ceiling on thin cables.
    const MON = [
      { draw: (c, g) => this.drawStat(c, g, "CHEETO-METER", this.vCheeto()) },
      { draw: (c, g) => this.drawStat(c, g, "APPROVAL", this.vApproval()) },
      { draw: (c, g) => this.drawStat(c, g, "GAS", this.vGas()) },
      { draw: (c, g) => this.drawStat(c, g, "EGGS", this.vEggs()) },
      { draw: (c, g) => this.drawStat(c, g, "GOLF DAYS", this.vGolf()) },
    ];
    // Colour-coded banners hung above the monitors — sector signage, which
    // is what a real floor uses to tell you which post is which.
    MON.forEach((m, i) => {
      const [bx, bz] = POSTS[i];
      const meta = this.POSTMETA[i];
      const ban = new T.Mesh(new T.PlaneGeometry(5.4, 1.1),
        new T.MeshBasicMaterial({ color: meta.c, side: T.DoubleSide }));
      ban.position.set(bx, 12.9, bz);
      this.scene.add(ban);
      box(5.6, 0.16, 0.16, 0x11161d, bx, 13.5, bz);
    });
    MON.forEach((m, i) => {
      const [x, z] = POSTS[i];
      const Y = 10.4;
      box(0.07, H - Y - 1.4, 0.07, 0x0b0f14, x - 1.9, (H - 1) - (H - Y - 1.4) / 2, z);
      box(0.07, H - Y - 1.4, 0.07, 0x0b0f14, x + 1.9, (H - 1) - (H - Y - 1.4) / 2, z);
      box(4.5, 0.3, 1.2, 0x11161d, x, Y + 1.2, z);
      this.addBoard({ w: 4.0, h: 2.0, x, y: Y, z, ry: 0,
                      px: 1024, py: 512, draw: m.draw, double: true });
    });

    // Side wall monitors.
    this.addBoard({ w: 8, h: 4, x: -R / 2 + 1.1, y: 9, z: -8, ry: Math.PI / 2,
      px: 512, py: 256, draw: (c, g) => this.drawApprovalBars(c, g) });
    this.addBoard({ w: 8, h: 4, x: -R / 2 + 1.1, y: 9, z: 4, ry: Math.PI / 2,
      px: 512, py: 256, draw: (c, g) => this.drawEcon(c, g) });

    this.addBoard({ w: 4.6, h: 2.3, x: -R / 2 + 1.15, y: 9.5, z: 16, ry: Math.PI / 2,
      px: 512, py: 256, draw: (c, g) => this.drawClock(c, g) });

    /* ---- ad boards ----
       Positioned where a real floor puts sponsor signage: between the
       windows and flanking the entrance. Six slots. */
    const AD_AT = [
      { x: R / 2 - 1.15, y: 4.2, z: -8.5, ry: -Math.PI / 2, w: 7, h: 2.6 },
      { x: R / 2 - 1.15, y: 4.2, z: 0.5, ry: -Math.PI / 2, w: 7, h: 2.6 },
      { x: R / 2 - 1.15, y: 4.2, z: 9.5, ry: -Math.PI / 2, w: 7, h: 2.6 },
      { x: -R / 2 + 1.15, y: 4.6, z: -18, ry: Math.PI / 2, w: 6.5, h: 2.4 },
      { x: -R / 2 + 1.15, y: 4.6, z: 12, ry: Math.PI / 2, w: 6.5, h: 2.4 },
      { x: 0, y: 2.4, z: R / 2 - 1.15, ry: Math.PI, w: 9, h: 2.2 },
    ];
    AD_AT.forEach((a, i) => {
      this.addBoard({ w: a.w, h: a.h, x: a.x, y: a.y, z: a.z, ry: a.ry,
        px: 512, py: 256, draw: (c, g) => this.drawAd(c, g, i) });
    });

    // The ticker band: verbatim Truth posts crawling across the back wall.
    this.tickerBoard = this.addBoard({
      w: R - 3, h: 1.4, x: 0, y: 4.5, z: -R / 2 + 1.1, ry: 0,
      px: 2048, py: 64, draw: (c, g) => this.drawTicker(c, g),
    });

    /* ---- the opening bell, on a balcony above the floor ----
       Which is where it actually is, and it means the bell is visible from
       anywhere in the room rather than being a thing you trip over. */
    const balc = new T.Group();
    this.colliders.push({ t: "b", x: 0, z: R / 2 - 3.2, hw: 4.6, hd: 2.6, h: 4.8 });
    box(9, 0.6, 5, 0x3d2f20, 0, 3.4, R / 2 - 3.2);
    box(9, 0.22, 0.3, 0xb08d4a, 0, 4.55, R / 2 - 5.6);
    for (const rx of [-4.2, -1.4, 1.4, 4.2]) box(0.16, 1.1, 0.16, 0xb08d4a, rx, 4.0, R / 2 - 5.6);
    for (const sx of [-3.6, 3.6]) box(0.5, 3.4, 0.5, 0x3d2f20, sx, 1.7, R / 2 - 3.2);
    // steps up
    for (let i = 0; i < 4; i++) box(4, 0.8, 0.9, 0x4a3a28, 0, 0.4 + i * 0.8, R / 2 - 0.9 - i * 0.9);
    const bell = new T.Mesh(new T.CylinderGeometry(0.6, 1.05, 1.25, 12),
      new T.MeshLambertMaterial({ color: 0xe8b53a, flatShading: true }));
    bell.position.set(0, 5.6, R / 2 - 3.6);
    this.scene.add(bell);
    box(0.24, 1.2, 0.24, 0x11161d, 0, 6.6, R / 2 - 3.6);
    this.bell = bell;
    this.scene.add(balc);

    /* ---- what you can walk up to ---- */
    this.hot = [
      { x: -8, z: -6, r: 4.6, label: "THE_CHEETO-METER.EXE", win: "w-meter" },
      { x: 8, z: -6, r: 4.6, label: "APPROVAL_RATING.EXE", win: "w-polls" },
      { x: -8, z: 6, r: 4.6, label: "KITCHEN_TABLE.EXE", win: "w-econ" },
      { x: 8, z: 6, r: 4.6, label: "EGG_PRICES.EXE", win: "w-econ" },
      { x: 0, z: -13, r: 4.6, label: "GOLF_TRACKER.EXE", win: "w-golf" },
      { x: 0, z: -19, r: 6.5, label: "NATIONAL_DEBT.EXE", win: "w-debt" },
      { x: -17, z: -19, r: 5.5, label: "TRUTH_SOCIAL.EXE", win: "w-truth" },
      { x: 0, z: R / 2 - 8, r: 4.2, label: "RING THE OPENING BELL", act: "bell" },
    ];
    this.near = null;

    /* ---- the player ---- */
    this.avatar = this.buildBody(this.myColor(), true);
    this.scene.add(this.avatar);

    /* ---- NPC traders ----
       These used to orbit the room on fixed circles, which from inside read
       exactly as what it was: people gliding round on invisible carousels.
       They now walk to a destination, stand there a while, occasionally
       throw a hand up like they are calling a bid, and then pick somewhere
       else. Destinations are weighted towards the trading posts, because a
       real floor is knots of people around the posts and stragglers in
       between, not an even scatter.

       Jacket colours are mostly blue on purpose — the floor uniform is a
       blue smock, and a rainbow crowd reads as a video game rather than an
       exchange. */
    this.npcs = [];
    const JACKETS = [0x2f6fd0, 0x3a7fe0, 0x24589f, 0x4a8ae8, 0x2f6fd0,
                     0x3a7fe0, 0xc9a227, 0xd94f4f, 0x51b06a, 0x8a5fd9];
    this.POSTXZ = POSTS;
    for (let i = 0; i < 20; i++) {
      const g = this.buildBody(JACKETS[i % JACKETS.length], false);
      const st = this.npcGoal();
      g.position.set(st.tx, 0, st.tz);
      g.userData = Object.assign(this.npcGoal(), {
        sp: 2.6 + Math.random() * 2.2,
        phase: Math.random() * 9,
        wait: Math.random() * 4,
        shout: 0,
      });
      this.scene.add(g);
      this.npcs.push(g);
    }

    /* ---- ticker tape ----
       One InstancedMesh of 160 scraps, parked under the floor until the
       bell goes. Ringing a bell that does nothing visible is a button, not
       an event; this is what makes anyone ring it twice. */
    const tapeGeo = new T.PlaneGeometry(0.3, 0.5);
    this.tape = new T.InstancedMesh(tapeGeo,
      new T.MeshBasicMaterial({ side: T.DoubleSide, vertexColors: true }), 160);
    this.tape.instanceColor = new T.InstancedBufferAttribute(new Float32Array(160 * 3), 3);
    const TAPE_COLS = [[1, .48, 0], [1, 1, 1], [.2, .86, .48], [1, .69, .29], [.85, .2, .2]];
    this.tapeBits = [];
    const dum = new T.Object3D();
    for (let i = 0; i < 160; i++) {
      const col = TAPE_COLS[i % TAPE_COLS.length];
      this.tape.instanceColor.setXYZ(i, col[0], col[1], col[2]);
      this.tapeBits.push({ x: 0, y: -50, z: 0, vx: 0, vy: 0, vz: 0, r: 0, vr: 0, life: 0 });
      dum.position.set(0, -50, 0); dum.updateMatrix();
      this.tape.setMatrixAt(i, dum.matrix);
    }
    this.tape.instanceColor.needsUpdate = true;
    this.tape.instanceMatrix.needsUpdate = true;
    this.tape.frustumCulled = false;
    this.scene.add(this.tape);
    this._dummy = new T.Object3D();

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

  /* The flag, drawn rather than fetched. 13 stripes and a canton; the
     stars are a grid of dots because at this distance an accurate 50-star
     arrangement and a tidy grid are the same handful of pixels. */
  drawFlag(c, g) {
    const sh = c.height / 13;
    for (let i = 0; i < 13; i++) {
      g.fillStyle = i % 2 === 0 ? "#b22234" : "#f4f4f4";
      g.fillRect(0, i * sh, c.width, sh + 1);
    }
    const cw = c.width * 0.42, ch = sh * 7;
    g.fillStyle = "#3c3b6e";
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = "#fff";
    for (let r = 0; r < 9; r++) {
      for (let col = 0; col < (r % 2 ? 5 : 6); col++) {
        const x = (cw / 12) * (r % 2 ? 2 + col * 2 : 1 + col * 2);
        const y = (ch / 10) * (1 + r);
        g.beginPath(); g.arc(x, y, cw / 46, 0, Math.PI * 2); g.fill();
      }
    }
    return "flag";                                 // static; paints once
  },

  /* The big board. Rows of live figures with an up/down mark where we hold
     a previous value to compare against — and NO mark where we don't,
     rather than inventing a direction. */
  bigRows(which) {
    const d = this.D() || {};
    const dir = (v, prev) => (!isFinite(v) || !isFinite(prev)) ? "" : v > prev ? "up" : v < prev ? "dn" : "";
    const A = [
      ["GAS", this.vGas(), dir(d.gas?.v, d.gas?.prev)],
      ["EGGS", this.vEggs(), ""],
      ["CPI", isFinite(d.cpi?.v) ? d.cpi.v.toFixed(1) + "%" : "—", ""],
      ["TARIFF", isFinite(d.tariff?.v) ? d.tariff.v.toFixed(1) + "%" : "—", dir(d.tariff?.v, d.tariff?.prev)],
      ["CHEETO", this.vCheeto(), ""],
    ];
    const B = [
      ["APPROVE", this.vApproval(), ""],
      ["DISAPP", isFinite(d.approval?.disapprove) ? d.approval.disapprove.toFixed(1) + "%" : "—", ""],
      ["EXEC ORD", isFinite(d.eo?.orders) ? String(d.eo.orders) : "—", ""],
      ["GOLF DAYS", this.vGolf(), ""],
      ["ON FLOOR", String(this.peers.size + 1), ""],
    ];
    return which ? B : A;
  },

  drawBigBoard(c, g, which) {
    const rows = this.bigRows(which);
    g.fillStyle = "#05080b"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#0b1119"; g.fillRect(8, 8, c.width - 16, c.height - 16);
    g.textAlign = "left";
    rows.forEach(([k, v, d], i) => {
      const y = 78 + i * 88;
      if (i % 2) { g.fillStyle = "#0f1720"; g.fillRect(12, y - 54, c.width - 24, 74); }
      g.font = "bold 34px 'Courier New', monospace";
      g.fillStyle = "#6c7d90";
      g.fillText(k, 26, y);
      g.textAlign = "right";
      g.fillStyle = d === "up" ? "#3ddc7a" : d === "dn" ? "#ff5f5f" : "#ffb04a";
      this.fit(g, (d === "up" ? "\u25B2 " : d === "dn" ? "\u25BC " : "") + v,
               c.width - 26, y, c.width * 0.6, 44);
      g.textAlign = "left";
    });
    return rows.map((r) => r[1] + r[2]).join("|");
  },

  /* An ad slot, or the pitch for one. */
  drawAd(c, g, i) {
    const ad = (this.ADS || []).find((a) => a.slot === i);
    if (ad) {
      g.fillStyle = "#" + (ad.tint ?? 0x1a2a3a).toString(16).padStart(6, "0");
      g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = "rgba(255,255,255,.10)";
      g.fillRect(10, 10, c.width - 20, c.height - 20);
      g.textAlign = "center";
      g.fillStyle = "#ffffff";
      this.fit(g, String(ad.title || ""), c.width / 2, 118, c.width - 60, 72);
      g.fillStyle = "#cfe0f2";
      this.fit(g, String(ad.line || ""), c.width / 2, 186, c.width - 60, 42, "normal");
      return "ad" + i + ad.title + ad.line;
    }
    g.fillStyle = "#12161c"; g.fillRect(0, 0, c.width, c.height);
    g.strokeStyle = "#3a4654"; g.lineWidth = 6;
    g.setLineDash([16, 12]);
    g.strokeRect(16, 16, c.width - 32, c.height - 32);
    g.setLineDash([]);
    g.textAlign = "center";
    g.fillStyle = "#8a99aa";
    g.font = "bold 62px 'Courier New', monospace";
    g.fillText("ADVERTISE HERE", c.width / 2, 120);
    g.fillStyle = "#5d6b7a";
    g.font = "34px 'Courier New', monospace";
    g.fillText("supremecheeto.club", c.width / 2, 178);
    return "empty" + i;
  },

  /* A clock, and whether the real market is open. NYSE hours in Eastern,
     weekdays only — the holiday calendar is not modelled, so a holiday
     shows OPEN and that is a known and deliberate limit rather than a
     claim. */
  drawClock(c, g) {
    const now = new Date();
    const et = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", hour12: false,
      weekday: "short", hour: "2-digit", minute: "2-digit",
    }).formatToParts(now).reduce((o, p) => (o[p.type] = p.value, o), {});
    const hh = +et.hour % 24, mm = +et.minute;
    const wk = !["Sat", "Sun"].includes(et.weekday);
    const mins = hh * 60 + mm;
    const open = wk && mins >= 570 && mins < 960;
    const txt = String(hh).padStart(2, "0") + ":" + String(mm).padStart(2, "0");
    g.fillStyle = "#05080b"; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = "center";
    g.fillStyle = "#6c7d90";
    g.font = "bold 30px 'Courier New', monospace";
    g.fillText("NEW YORK", c.width / 2, 52);
    g.fillStyle = "#ffb04a";
    this.fit(g, txt, c.width / 2, 150, c.width - 50, 110);
    g.fillStyle = open ? "#3ddc7a" : "#ff5f5f";
    g.font = "bold 34px 'Courier New', monospace";
    g.fillText(open ? "MARKET OPEN" : "MARKET CLOSED", c.width / 2, 210);
    return txt + open;
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

  /* Push a point out of anything solid. Two passes, because sliding out of
     one collider can push you into its neighbour — the gap between two
     trading posts is exactly the case that needs the second pass. */
  resolve(x, z, rad) {
    for (let pass = 0; pass < 2; pass++) {
      for (const c of this.colliders || []) {
        if (c.t === "c") {
          const dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz), min = c.r + rad;
          if (d < min) {
            if (d < 1e-4) { x = c.x + min; }
            else { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; }
          }
        } else {
          const hw = c.hw + rad, hd = c.hd + rad;
          const dx = x - c.x, dz = z - c.z;
          if (Math.abs(dx) < hw && Math.abs(dz) < hd) {
            // Leave by the nearest face, which is what "sliding along a
            // wall" actually is.
            const px = hw - Math.abs(dx), pz = hd - Math.abs(dz);
            if (px < pz) x = c.x + (dx < 0 ? -hw : hw);
            else z = c.z + (dz < 0 ? -hd : hd);
          }
        }
      }
    }
    return { x, z };
  },

  /* Is this point inside something solid, at this height? Height matters
     for the camera and not for the player: you can look over the balcony
     rail from above, you cannot walk through it. */
  solidAt(x, z, pad, y) {
    for (const c of this.colliders || []) {
      if (y != null && c.h != null && y > c.h) continue;
      if (c.t === "c") {
        if (Math.hypot(x - c.x, z - c.z) < c.r + pad) return true;
      } else if (Math.abs(x - c.x) < c.hw + pad && Math.abs(z - c.z) < c.hd + pad) {
        return true;
      }
    }
    return false;
  },

  /* How far the camera can actually sit behind you before something gets in
     the way. Walk backwards towards the bell balcony and the camera used to
     end up inside it, filling the screen with the underside of a wooden
     platform. Standard third-person fix: march out along the desired ray
     and stop at the last clear step. */
  clearDist(want, cp) {
    const STEPS = 8;
    for (let i = STEPS; i >= 1; i--) {
      const d = want * (i / STEPS);
      const x = this.self.x - Math.sin(this.cam.yaw) * cp * d;
      const z = this.self.z - Math.cos(this.cam.yaw) * cp * d;
      const y = Math.max(1.1, Math.sin(this.cam.pitch) * d + 2.0);
      if (!this.solidAt(x, z, 0.6, y)) return d;
    }
    return want * 0.18;
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
  throwTape() {
    if (!this.tapeBits) return;
    const R = this.ROOM / 2;
    for (const b of this.tapeBits) {
      b.x = (Math.random() * 2 - 1) * (R - 6);
      b.z = (Math.random() * 2 - 1) * (R - 6);
      b.y = 13 + Math.random() * 2.5;
      b.vx = (Math.random() - 0.5) * 1.1;
      b.vz = (Math.random() - 0.5) * 1.1;
      b.vy = -(1.7 + Math.random() * 1.6);
      b.r = Math.random() * 6.28;
      b.vr = (Math.random() - 0.5) * 7;
      b.life = 7 + Math.random() * 2.5;
    }
  },

  stepTape(dt) {
    if (!this.tape || !this.tapeBits) return;
    let live = 0;
    const d = this._dummy;
    for (let i = 0; i < this.tapeBits.length; i++) {
      const b = this.tapeBits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.x += b.vx * dt; b.z += b.vz * dt; b.y += b.vy * dt;
      b.r += b.vr * dt;
      // Flutter rather than fall like gravel — scraps of paper drift.
      b.vx += Math.sin(b.r * 1.7) * dt * 0.5;
      if (b.y <= 0.03) { b.y = 0.03; b.vy = 0; b.vx *= 0.9; b.vz *= 0.9; b.vr *= 0.9; }
      d.position.set(b.x, b.y, b.z);
      d.rotation.set(b.y <= 0.04 ? -Math.PI / 2 : b.r * 0.7, b.r, b.r * 0.4);
      d.updateMatrix();
      this.tape.setMatrixAt(i, d.matrix);
      live++;
    }
    if (live) this.tape.instanceMatrix.needsUpdate = true;
    else if (this._tapeLive) {
      // Park them out of sight once the last one expires.
      for (let i = 0; i < this.tapeBits.length; i++) {
        d.position.set(0, -50, 0); d.updateMatrix();
        this.tape.setMatrixAt(i, d.matrix);
      }
      this.tape.instanceMatrix.needsUpdate = true;
    }
    this._tapeLive = live > 0;
  },

  ringBell(mine) {
    this._bellT = performance.now();
    this.throwTape();
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
    const pts = new Map();
    let lastX = 0, lastY = 0, pinch = 0;
    const clampCam = () => {
      this.cam.pitch = Math.max(this.PITCH_MIN, Math.min(this.PITCH_MAX, this.cam.pitch));
      this.cam.dist = Math.max(this.DIST_MIN, Math.min(this.DIST_MAX, this.cam.dist));
    };
    dom.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      lastX = e.clientX; lastY = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      dom.setPointerCapture?.(e.pointerId);
    });
    dom.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        // Pinch to zoom. Two fingers never means "turn".
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) { this.cam.dist *= pinch / (d || 1); clampCam(); }
        pinch = d;
        return;
      }
      this.cam.yaw -= (e.clientX - lastX) * 0.007;
      this.cam.pitch += (e.clientY - lastY) * 0.005;
      clampCam();
      lastX = e.clientX; lastY = e.clientY;
    });
    const endDrag = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = 0;
      dom.releasePointerCapture?.(e.pointerId);
    };
    dom.addEventListener("pointerup", endDrag);
    dom.addEventListener("pointercancel", endDrag);
    dom.addEventListener("wheel", (e) => {
      this.cam.dist *= 1 + Math.sign(e.deltaY) * 0.12;
      clampCam();
      e.preventDefault();
    }, { passive: false });

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
      let nx = Math.max(-lim, Math.min(lim, this.self.x + dx * SPEED * dt));
      let nz = Math.max(-lim, Math.min(lim, this.self.z + dz * SPEED * dt));
      const fixed = this.resolve(nx, nz, 0.75);
      this.self.x = Math.max(-lim, Math.min(lim, fixed.x));
      this.self.z = Math.max(-lim, Math.min(lim, fixed.z));
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
    const cp = Math.cos(this.cam.pitch), sp = Math.sin(this.cam.pitch);
    const useD = this.clearDist(this.cam.dist, cp);
    const cx = Math.max(-wall, Math.min(wall,
      this.self.x - Math.sin(this.cam.yaw) * cp * useD));
    const cz = Math.max(-wall, Math.min(wall,
      this.self.z - Math.cos(this.cam.yaw) * cp * useD));
    const cy = Math.max(1.1, sp * useD + 2.0);
    this.camera.position.lerp(new T.Vector3(cx, cy, cz), 1 - Math.pow(0.0016, dt));
    this.camera.lookAt(this.self.x, 2.3, this.self.z);

    /* ---- peers: ease toward their last known target ---- */
    const k = 1 - Math.pow(0.0009, dt);
    for (const e of this.peers.values()) {
      e.g.position.x += (e.tx - e.g.position.x) * k;
      e.g.position.z += (e.tz - e.g.position.z) * k;
      /* Other people get pushed out of solid objects too. Their authority
         is their own client, so this is cosmetic — but a peer standing
         inside a trading post looks broken to everyone except them. */
      const pf = this.resolve(e.g.position.x, e.g.position.z, 0.7);
      e.g.position.x = pf.x; e.g.position.z = pf.z;
      let d = e.try_ - e.g.rotation.y;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      e.g.rotation.y += d * k;
      this.swing(e.g, e.mv === 1, t);
    }

    /* ---- NPCs ---- */
    for (const n of this.npcs) this.stepNpc(n, dt, t);

    /* ---- screens ---- */
    this._tick = (this._tick || 0) + dt * 190;
    this.paintBoard(this.tickerBoard, true);
    // Everything else only when its content actually changed. The debt
    // board changes constantly, the rest almost never — paintBoard's
    // signature check sorts that out without a special case per screen.
    // Roll the small-screen wall on its own slower beat — one texture
    // upload every two seconds updates all fifty-five of them.
    if (!this._dwT || t - this._dwT > 2) {
      this._dwT = t;
      this._dwRoll = (this._dwRoll || 0) + 1;
      this.paintDataWall();
    }
    if (!this._boardT || t - this._boardT > 0.2) {
      this._boardT = t;
      for (const b of this.boards) if (b !== this.tickerBoard) this.paintBoard(b, false);
    }

    /* ---- what you're standing next to ---- */
    const n = this.nearest();
    if (n !== this.near) { this.near = n; this.paintPrompt(); }
    // The terminal you can use glows; the rest sit still. Without this the
    // prompt is the only feedback and you have to read it to know which
    // machine you are actually at.
    if (this.posts && this.POSTMETA) {
      for (let i = 0; i < this.posts.length; i++) {
        const face = this.posts[i].userData.face;
        if (!face) continue;
        const live = n && n.win === this.POSTMETA[i].win
          && Math.hypot(this.POSTMETA[i]._x ?? n.x, 0) >= 0;
        const at = n && Math.hypot(this.posts[i].position.x - this.self.x,
                                   this.posts[i].position.z - this.self.z) < 4.8;
        face.material.opacity = 1;
        face.material.transparent = true;
        face.scale.setScalar(at ? 1 + Math.sin(t * 6) * 0.04 : 1);
        face.material.color.setHex(this.POSTMETA[i].c);
        if (!at) face.material.color.multiplyScalar(0.55);
      }
    }

    this.stepTape(dt);

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

  /* Pick somewhere to go. Two thirds of the time that is a spot around one
     of the trading posts, which is what makes the crowd clump instead of
     spreading out into an even lattice. */
  npcGoal() {
    const lim = this.ROOM / 2 - 4;
    if (Math.random() < 0.66 && this.POSTXZ?.length) {
      const [px, pz] = this.POSTXZ[(Math.random() * this.POSTXZ.length) | 0];
      const a = Math.random() * Math.PI * 2;
      const r = 3.4 + Math.random() * 2.2;
      return { tx: px + Math.cos(a) * r, tz: pz + Math.sin(a) * r, wait: 0 };
    }
    for (let i = 0; i < 12; i++) {
      const tx = (Math.random() * 2 - 1) * lim, tz = (Math.random() * 2 - 1) * lim;
      if (!this.solidAt(tx, tz, 1.0)) return { tx, tz, wait: 0 };
    }
    return { tx: 0, tz: 0, wait: 0 };
  },

  stepNpc(n, dt, t) {
    const u = n.userData;

    if (u.wait > 0) {
      u.wait -= dt;
      // Standing around. Every so often somebody calls a bid.
      if (u.shout > 0) {
        u.shout -= dt;
        const L = n.userData.armL, R = n.userData.armR;
        if (L && R) { L.rotation.x = -2.1; R.rotation.x = -2.1; }
        n.position.y = 0;
      } else {
        if (Math.random() < dt * 0.22) u.shout = 0.5 + Math.random() * 0.7;
        this.swing(n, false, t + u.phase);
      }
      if (u.wait <= 0) Object.assign(u, this.npcGoal());
      return;
    }

    const dx = u.tx - n.position.x, dz = u.tz - n.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.5) { u.wait = 2.5 + Math.random() * 8; u.shout = 0; return; }
    const step = Math.min(d, u.sp * dt);
    let nx = n.position.x + (dx / d) * step;
    let nz = n.position.z + (dz / d) * step;
    /* Traders were walking straight through the posts, which is the thing
       that most gave the room away — you collide, and then a man in a blue
       jacket strolls through a solid desk beside you. Same solver as the
       player; if a goal turns out to be unreachable they give up and pick
       another rather than grinding against a wall forever. */
    const fx = this.resolve(nx, nz, 0.7);
    if (Math.hypot(fx.x - n.position.x, fx.z - n.position.z) < step * 0.25) {
      u.stuck = (u.stuck || 0) + dt;
      if (u.stuck > 0.9) { u.stuck = 0; Object.assign(u, this.npcGoal()); }
    } else u.stuck = 0;
    n.position.x = fx.x;
    n.position.z = fx.z;
    // Turn towards travel rather than snapping, or they pivot like turrets.
    let turn = Math.atan2(dx, dz) - n.rotation.y;
    while (turn > Math.PI) turn -= Math.PI * 2;
    while (turn < -Math.PI) turn += Math.PI * 2;
    n.rotation.y += turn * Math.min(1, dt * 7);
    this.swing(n, true, t + u.phase);
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
