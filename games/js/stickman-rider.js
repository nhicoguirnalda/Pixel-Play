/* ============================================================
   Stickman Rider — original game for PixelPlay
   Side-view motorbike trials: seeded hilly terrain, ramps,
   gaps, rocks, logs, swinging log pendulums, springy
   suspension physics, air lean, backflip bonuses, coins and a
   nine-level championship. Keyboard first, on-screen buttons
   for touch.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'stickman-rider';
  var FONT = '"Segoe UI", system-ui, sans-serif';

  /* GameShell is provided by ../js/game-page.js, which loads first.
     The no-op fallback only exists so this file can never throw. */
  var GameShell = window.GameShell;
  if (!GameShell) {
    GameShell = {
      hud: function () {},
      overlay: { show: function () {}, hide: function () {} },
      best: { get: function (k, f) { return f || 0; }, set: function () {} }
    };
  }

  /* ---------------- level configs (hand-tuned, easiest → hardest) ----------------
     Every row is strictly harder than the row above: longer course, rougher and
     taller terrain, more chasms and wider gaps, more rocks/logs, more swinging
     logs at higher speed, and a tighter clock per pixel. `hazard` scales the
     height of rock/log bumps. */
  var LEVELS = [
    { name: 'Sunny Slopes', seed: 13579, len: 2400, amp: 30, rough: 4.0,
      gaps: [[1520, 104]], rocks: 5, logs: 6, coins: 6, time: 28, swingers: 1, hazard: 1.00 },
    { name: 'Rocky Ridge', seed: 24680, len: 2800, amp: 37, rough: 5.4,
      gaps: [[1350, 108], [2150, 110]], rocks: 7, logs: 8, coins: 7, time: 31, swingers: 1, hazard: 1.05 },
    { name: 'Timber Trail', seed: 31415, len: 3200, amp: 44, rough: 6.8,
      gaps: [[850, 108], [1650, 110], [2450, 112]], rocks: 9, logs: 10, coins: 8, time: 34, swingers: 2, hazard: 1.10 },
    { name: 'Craggy Pass', seed: 42424, len: 3650, amp: 51, rough: 8.2,
      gaps: [[800, 110], [1550, 112], [2300, 114], [3050, 112]], rocks: 10, logs: 11, coins: 9, time: 37, swingers: 2, hazard: 1.15 },
    { name: 'Boulder Basin', seed: 55551, len: 4100, amp: 58, rough: 9.6,
      gaps: [[850, 112], [1650, 114], [2450, 116], [3250, 114]], rocks: 12, logs: 12, coins: 10, time: 40, swingers: 3, hazard: 1.20 },
    { name: 'Devils Drop', seed: 66613, len: 4550, amp: 65, rough: 11.0,
      gaps: [[800, 114], [1600, 115], [2400, 116], [3200, 117], [4000, 116]], rocks: 14, logs: 13, coins: 12, time: 43, swingers: 3, hazard: 1.25 },
    { name: 'Rattler Ridge', seed: 70707, len: 5000, amp: 72, rough: 12.4,
      gaps: [[850, 116], [1650, 117], [2450, 118], [3250, 119], [4050, 118]], rocks: 16, logs: 14, coins: 13, time: 46, swingers: 4, hazard: 1.30 },
    { name: 'Scorpion Steps', seed: 80808, len: 5500, amp: 79, rough: 13.8,
      gaps: [[800, 118], [1600, 119], [2400, 120], [3200, 121], [4000, 120], [4800, 119]], rocks: 18, logs: 15, coins: 15, time: 49, swingers: 4, hazard: 1.35 },
    { name: 'Nightfall Gauntlet', seed: 90909, len: 6000, amp: 86, rough: 15.2,
      gaps: [[800, 120], [1650, 121], [2500, 122], [3350, 123], [4200, 122], [5050, 121]], rocks: 20, logs: 17, coins: 17, time: 52, swingers: 5, hazard: 1.40 }
  ];

  /* One score derived from every difficulty lever. Because each input rises
     with the level index, the score is strictly increasing too. */
  function levelStats(i) {
    var c = LEVELS[clampLevel(i)];
    var maxGap = 0, g;
    for (g = 0; g < c.gaps.length; g++) if (c.gaps[g][1] > maxGap) maxGap = c.gaps[g][1];
    var speed = c.len / c.time;
    var score = Math.round(10 * (
      (i + 1) * 1.0 +
      maxGap * 0.12 +
      c.gaps.length * 1.2 +
      c.rocks * 0.35 +
      c.logs * 0.30 +
      (c.swingers || 0) * 0.9 +
      c.amp * 0.06 +
      c.rough * 0.30 +
      (c.hazard - 1) * 10 +
      (speed - 85) * 0.20
    ));
    return {
      tier: i + 1,
      score: score,
      maxGap: maxGap,
      requiredSpeed: Math.round(speed * 10) / 10,
      timePerPixel: Math.round((c.time / c.len) * 100000) / 100000,
      hazardFactor: c.hazard,
      nextHarder: i < LEVELS.length - 1
    };
  }

  function clampLevel(n) {
    n = n | 0;
    return n < 0 ? 0 : (n > LEVELS.length - 1 ? LEVELS.length - 1 : n);
  }


  /* ---------------- physics constants ---------------- */

  var GRAV = 1000;          /* px/s^2 */
  var K_SPRING = 190;       /* suspension spring per px of wheel penetration */
  var C_SPRING = 15;        /* suspension damping */
  var WR = 11;              /* wheel radius */
  var WOFF = [{ x: -24, y: 10 }, { x: 24, y: 10 }];
  var INERTIA = 1400;
  var LEAN_A = 55;          /* lean angular accel in the air */
  var LEAN_GROUND = 0.5;    /* lean effectiveness while grounded */
  var AV_CAP = 12;          /* max spin rate, rad/s */
  var DRIVE = 820, BRAKE_F = 900, REVERSE_F = 420;
  var MU = 1.7;             /* traction limit vs normal force */
  var ROLL_GAS = 0.07, ROLL_COAST = 0.30;
  var DAMP_ROLL = 2.5;
  var ASSIST_F = 380;        /* gentle push along tangent to prevent stalls */
  var DRAG = 0.004;         /* quadratic air drag */
  var HEAD = { x: 6, y: -30 }, HEAD_R = 5.5;
  var RIDE_H = 21;          /* body centre height above ground when level */
  var RAMP_W = 170;         /* kicker width */
  var RAMP_BASE = 26;       /* first-level kicker height */
  var RAMP_STEP = 3;        /* extra kicker height per level */
  var BOWL_BASE = 30;       /* landing bowl depth on level one */
  var BOWL_STEP = 3;        /* extra bowl depth per level */
  var SWING_OMEGA = 1.9;    /* pendulum angular speed on level one, rad/s */
  var SWING_STEP = 0.075;   /* +0.075 rad/s per level */
  var SWING_ROPE = 118;     /* pendulum rope length, px */
  var SWING_AMP = 0.95;     /* swing amplitude, radians */
  var SWING_R = 13;         /* log bob radius */
  var SWING_HIT = 9;        /* extra collision margin around the bob */
  var SWING_PIVOT_H = 158;  /* pivot height above the trail */

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | crashed | won | over */
  var levelIdx = 0;
  var score = 0;
  var lives = 3;
  var best = GameShell.best.get(BEST_KEY, 0);
  var timeLeft = LEVELS[0].time;
  var hudSec = -1, hudDirty = true, flipTotal = 0;

  var cfg = null;
  var hs = [];                    /* terrain height samples, step TS */
  var gaps = [];                  /* [startX, width] chasms */
  var rocks = [], logs = [], coins = [];
  var swingers = [];
  var swingClock = 0;
  var TS = 6;

  var bike = { x: 120, y: 400, vx: 0, vy: 0, ang: 0, av: 0, spin: 0 };
  var grounded = false, airTime = 0, airRot = 0;
  var keys = { gas: false, brake: false, back: false, fwd: false };

  var cam = { x: 0 };
  var pops = [];                  /* floating texts */
  var stars = [];                 /* cartoon crash stars */
  var crashT = 0, crashMsg = '', crashX = 0, crashY = 0;
  var shake = 0;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      var t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function smoothstep(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }

  /* ---------------- terrain ---------------- */

  function buildLevel(idx) {
    cfg = LEVELS[idx];
    var rnd = mulberry32(cfg.seed);
    var n = Math.ceil((cfg.len + 900) / TS) + 2;
    var i;

    /* rolling hills from layered sines with seeded phases */
    var ph1 = rnd() * TAU, ph2 = rnd() * TAU, ph3 = rnd() * TAU;
    var w1 = 640 + rnd() * 260, w2 = 340 + rnd() * 140, w3 = 170 + rnd() * 70;
    hs = new Array(n);
    for (i = 0; i < n; i++) {
      var x = i * TS;
      var y = 460;
      y -= Math.sin(x / w1 * TAU + ph1) * cfg.amp;
      y -= Math.sin(x / w2 * TAU + ph2) * cfg.amp * 0.5;
      y -= Math.sin(x / w3 * TAU + ph3) * cfg.amp * 0.26;
      hs[i] = y;
    }

    /* seeded roughness: smoothed random walk */
    var acc = 0;
    for (i = 0; i < n; i++) {
      acc = acc * 0.82 + (rnd() - 0.5) * cfg.rough;
      hs[i] += acc;
    }

    /* keep the spawn zone flat and the course on screen */
    for (i = 0; i < n; i++) {
      var sx = i * TS;
      hs[i] = clamp(hs[i], 262, 520);
      if (sx < 380) hs[i] = 460 + (hs[i] - 460) * smoothstep(sx / 380);
    }

    /* hand-tuned gaps (chasms) with a kicker ramp before each one.
       A smoothed run-up strip precedes every kicker so the bike approaches
       on the ground instead of bouncing off a bump short of the lip. */
    gaps = cfg.gaps.slice();
    for (i = 0; i < gaps.length; i++) {
      var g0 = gaps[i][0], gw = gaps[i][1];
      var rampW = RAMP_W, rampH = RAMP_BASE + levelIdx * RAMP_STEP;
      var runUp = 260;
      /* Tilt the whole approach (run-up + kicker zone) into one straight line
         from entry height to the pre-ramp height at g0, feathering both ends
         so there is no slope kink that could bounce the bike off line. The
         quadratic kicker is subtracted afterwards; its slope is zero at t=0,
         so the base slope stays continuous. */
      var r0 = Math.floor((g0 - rampW - runUp) / TS), r1 = Math.floor(g0 / TS);
      var hA = (r0 >= 1 && r0 < n) ? hs[r0] : null;
      var hB = (r1 >= 1 && r1 < n) ? hs[r1] : null;
      if (hA !== null && hB !== null && r1 > r0) {
        var feather = Math.floor(50 / TS);
        for (var rc = r0 + 1; rc < r1; rc++) {
          if (rc < 0 || rc >= n) continue;
          var line = hA + (hB - hA) * ((rc - r0) / (r1 - r0));
          var dEnd = Math.min(rc - r0, r1 - rc);
          var wgt = dEnd >= feather ? 1 : smoothstep((dEnd + 1) / (feather + 1));
          hs[rc] = hs[rc] + (line - hs[rc]) * wgt;
        }
      }
      var i0 = Math.floor((g0 - rampW) / TS), i1 = Math.floor(g0 / TS);
      for (var j = i0; j <= i1; j++) {
        if (j < 0 || j >= n) continue;
        var t = (j * TS - (g0 - rampW)) / rampW;
        /* quadratic profile: unlike smoothstep, the lip keeps a positive
           slope so the bike is actually launched upward over the chasm */
        hs[j] -= rampH * t * t;
      }
      /* descending landing bowl past the chasm: gives arriving riders a
         slope to run down instead of a wall to slam into. Sine profile is
         C1-smooth at both ends, so no step for the physics to catch on. */
      var z0 = g0 + gw, z3 = z0 + 320;
      var jA = Math.ceil(z0 / TS), jB2 = Math.floor(z3 / TS);
      if (jA >= 0 && jB2 < n && jB2 > jA) {
        var lipH = hs[Math.min(i1, n - 1)];
        var bowl = BOWL_BASE + levelIdx * BOWL_STEP;
        for (var jd = jA; jd <= jB2; jd++) {
          var s = (jd * TS - z0) / (z3 - z0);
          hs[jd] += bowl * Math.sin(Math.PI * s);
          if (hs[jd] < lipH + 6) hs[jd] = lipH + 6;   /* never above the lip */
        }
      }
    }

    /* rocks and logs as gentle bumps you can bounce over.
       Slots are laid out evenly across the safe stretches between chasms (so
       later, longer trails really do carry more obstacles) and the two kinds
       are interleaved with a seeded shuffle. Heights scale with `hazard`. */
    rocks = []; logs = [];
    var hz = cfg.hazard || 1;
    function addBump(px, halfW, isLog) {
      var lo = (isLog ? 7 : 9) * hz;
      var hi = (isLog ? 10 : 14) * hz;
      var h = lo + rnd() * (hi - lo);
      if (isLog) logs.push({ x: px, h: h, w: halfW });
      else rocks.push({ x: px, h: h, w: halfW });
      var k0 = Math.floor((px - halfW) / TS), k1 = Math.ceil((px + halfW) / TS);
      for (var k = k0; k <= k1; k++) {
        if (k < 0 || k >= n) continue;
        var d = (k * TS - px) / halfW;
        if (Math.abs(d) > 1) continue;
        hs[k] -= h * Math.exp(-d * d * 2.4);
      }
    }
    (function placeObstacles() {
      var startX = 460, endX = cfg.len - 340;
      var gapBefore = 165, gapAfter = 140;
      var blocked = [], g;
      for (g = 0; g < gaps.length; g++) {
        blocked.push([gaps[g][0] - gapBefore, gaps[g][0] + gaps[g][1] + gapAfter]);
      }
      blocked.sort(function (a, b) { return a[0] - b[0]; });
      var spans = [], cursor = startX;
      for (g = 0; g < blocked.length; g++) {
        if (blocked[g][0] > cursor) spans.push([cursor, Math.min(blocked[g][0], endX)]);
        if (blocked[g][1] > cursor) cursor = blocked[g][1];
        if (cursor >= endX) break;
      }
      if (cursor < endX) spans.push([cursor, endX]);

      var total = 0, i;
      for (i = 0; i < spans.length; i++) total += Math.max(0, spans[i][1] - spans[i][0]);
      var count = cfg.rocks + cfg.logs;
      if (total <= 0 || count <= 0) return;

      /* Allocate exactly `count` slots across the spans, proportionally to
         their length (largest-remainder rounding), then space them evenly. */
      var alloc = [], remainders = [], used = 0;
      for (i = 0; i < spans.length; i++) {
        var ideal = count * Math.max(0, spans[i][1] - spans[i][0]) / total;
        var base = Math.floor(ideal);
        alloc.push(base);
        remainders.push({ i: i, frac: ideal - base });
        used += base;
      }
      remainders.sort(function (a, b) { return b.frac - a.frac; });
      var guard = 0;
      for (i = 0; used < count && guard++ < 400; i = (i + 1) % remainders.length) {
        var spanIdx = remainders[i].i;
        if (spans[spanIdx][1] - spans[spanIdx][0] >= (alloc[spanIdx] + 1) * 48) {
          alloc[spanIdx]++;
          used++;
        }
      }

      var slots = [];
      for (i = 0; i < spans.length; i++) {
        var a = spans[i][0], b = spans[i][1], nSlots = alloc[i];
        for (var s = 0; s < nSlots; s++) {
          slots.push(Math.round(a + (b - a) * (s + 0.5) / nSlots));
        }
      }

      /* seeded interleave of rock/log types */
      var types = [], r;
      for (i = 0; i < cfg.rocks; i++) types.push(0);
      for (i = 0; i < cfg.logs; i++) types.push(1);
      for (i = types.length - 1; i > 0; i--) {
        r = Math.floor(rnd() * (i + 1));
        var tmp = types[i]; types[i] = types[r]; types[r] = tmp;
      }
      for (i = 0; i < slots.length; i++) {
        var isLog = types[i % types.length] === 1;
        addBump(slots[i], isLog ? 18 : 16, isLog);
      }
    })();

    /* slope limiter: no wall steeper than ~40 degrees, and cap per-sample steps too */
    for (var pass = 0; pass < 5; pass++) {
      for (i = 1; i < n - 1; i++) {
        var sl = (hs[i + 1] - hs[i - 1]) / (2 * TS);
        if (sl > 0.85) {
          var fix = (sl - 0.85) * TS;
          hs[i] -= fix * 0.5; hs[i - 1] += fix * 0.25; hs[i + 1] += fix * 0.25;
        } else if (sl < -0.85) {
          var fix2 = (sl + 0.85) * TS;
          hs[i] -= fix2 * 0.5; hs[i - 1] += fix2 * 0.25; hs[i + 1] += fix2 * 0.25;
        }
      }
      var maxStep = 0.8 * TS;
      for (i = 0; i < n - 1; i++) {
        var d = hs[i + 1] - hs[i];
        if (d > maxStep) {
          var ov = (d - maxStep) / 2;
          hs[i] += ov; hs[i + 1] -= ov;
        } else if (d < -maxStep) {
          var ov2 = (-d - maxStep) / 2;
          hs[i] -= ov2; hs[i + 1] += ov2;
        }
      }
      for (i = 0; i < n; i++) hs[i] = clamp(hs[i], 258, 524);
    }

    /* coins float above the route, arcing over the jumps */
    coins = [];
    for (i = 0; i < cfg.coins; i++) {
      var cx = Math.round((500 + (cfg.len - 780) * (i + 0.5) / cfg.coins + (rnd() - 0.5) * 90) / TS) * TS;
      var gy = groundAt(cx);
      coins.push({ x: cx, y: (gy === null ? 400 : gy) - 64 - rnd() * 26, got: false });
    }

    /* swinging log pendulums: fixed frames that sweep the trail.
       Prefer a flat stretch so the log sweeps at a readable height, but fall
       back to the spread-out slot on rough courses. The pivot is anchored to
       the highest ground nearby so the log never dips into a rider on a
       downhill. */
    function flatSpan(x, half, tol) {
      var lo = 1e9, hi = -1e9;
      for (var fx = x - half; fx <= x + half; fx += 10) {
        var fy = groundAt(fx);
        if (fy === null) return false;
        if (fy < lo) lo = fy;
        if (fy > hi) hi = fy;
        if (Math.abs(groundSlope(fx)) > 0.42) return false;
      }
      return (hi - lo) <= tol;
    }

    function freeOfGaps(x) {
      for (var zg = 0; zg < gaps.length; zg++) {
        /* keep the whole kicker run-up and landing bowl clear: a swinging log
           in a landing zone is unfair, not just hard */
        if (x > gaps[zg][0] - 170 && x < gaps[zg][0] + gaps[zg][1] + 380) return false;
      }
      return true;
    }

    swingers = [];
    swingClock = 0;
    var ns = cfg.swingers || 0;

    function swingerTooClose(cx) {
      for (var q = 0; q < swingers.length; q++) {
        if (Math.abs(swingers[q].x - cx) < 220) return true;
      }
      return false;
    }

    function addSwinger(sx, idx) {
      var pivotBase = -1e9;
      for (var pg = sx - 60; pg <= sx + 60; pg += 10) {
        var pgy = groundAt(pg);
        if (pgy !== null && pgy > pivotBase) pivotBase = pgy;
      }
      if (pivotBase < -1e8) pivotBase = groundAt(sx);
      swingers.push({
        x: sx,
        phase: idx * 2.1,
        omega: SWING_OMEGA + levelIdx * SWING_STEP,
        pivotBase: pivotBase
      });
    }

    for (i = 0; i < ns; i++) {
      var base = 700 + (cfg.len - 1600) * (i + 0.5) / Math.max(1, ns);
      var sx = -1, pass, off, ci;
      /* pass 0-1: near the nominal slot, flat first then rougher */
      for (pass = 0; pass < 2 && sx < 0; pass++) {
        var tol = pass === 0 ? 34 : 95;
        for (off = 0; off <= 600 && sx < 0; off += 24) {
          var cand = off === 0 ? [base] : [base + off, base - off];
          for (ci = 0; ci < cand.length; ci++) {
            var cx = Math.round(cand[ci] / TS) * TS;
            if (cx < 900 || cx > cfg.len - 320) continue;
            if (!freeOfGaps(cx) || groundAt(cx) === null || swingerTooClose(cx)) continue;
            if (!flatSpan(cx, 95, tol)) continue;
            sx = cx;
            break;
          }
        }
      }
      /* pass 2: near the nominal slot even if the ground is not flat */
      if (sx < 0) {
        for (off = 0; off <= 600 && sx < 0; off += 24) {
          cand = off === 0 ? [base] : [base + off, base - off];
          for (ci = 0; ci < cand.length; ci++) {
            var cx1 = Math.round(cand[ci] / TS) * TS;
            if (cx1 < 900 || cx1 > cfg.len - 320) continue;
            if (!freeOfGaps(cx1) || groundAt(cx1) === null || swingerTooClose(cx1)) continue;
            sx = cx1;
            break;
          }
        }
      }
      /* pass 3: scan the whole course for a readable flat stretch */
      if (sx < 0) {
        for (var cx2 = 900; cx2 <= cfg.len - 320; cx2 += 24) {
          if (!freeOfGaps(cx2) || groundAt(cx2) === null || swingerTooClose(cx2)) continue;
          if (!flatSpan(cx2, 95, 120)) continue;
          sx = cx2;
          break;
        }
      }
      /* pass 4: last resort, any clear spot away from chasms */
      if (sx < 0) {
        for (var cx3 = 900; cx3 <= cfg.len - 320; cx3 += 24) {
          if (!freeOfGaps(cx3) || groundAt(cx3) === null || swingerTooClose(cx3)) continue;
          sx = cx3;
          break;
        }
      }
      if (sx >= 0) addSwinger(Math.round(sx / TS) * TS, i);
    }
  }

  function groundAt(x) {
    var g;
    for (g = 0; g < gaps.length; g++) {
      if (x >= gaps[g][0] && x <= gaps[g][0] + gaps[g][1]) return null;
    }
    var i = Math.floor(x / TS);
    if (i < 0) i = 0;
    if (i >= hs.length - 1) return hs[hs.length - 1];
    var f = x - i * TS;
    return hs[i] + (hs[i + 1] - hs[i]) * (f / TS);
  }

  function groundSlope(x) {
    var i = clamp(Math.floor(x / TS), 1, hs.length - 2);
    return (hs[i + 1] - hs[i - 1]) / (2 * TS);
  }

  /* ---------------- bike physics ---------------- */

  function stepPhysics(h) {
    var b = bike;
    var i;

    /* accumulate contact forces from the two wheels (suspension) */
    var fx = -DRAG * b.vx * Math.abs(b.vx);
    var fy = GRAV - DRAG * b.vy * Math.abs(b.vy);
    var torque = 0;
    var contacts = 0;
    var sumTx = 0, sumTy = 0;
    var c = Math.cos(b.ang), s = Math.sin(b.ang);

    for (i = 0; i < 2; i++) {
      var ow = WOFF[i];
      var wx = b.x + ow.x * c - ow.y * s;
      var wy = b.y + ow.x * s + ow.y * c;
      var g = groundAt(wx);
      if (g === null) continue;
      var pen = (wy + WR) - g;
      if (pen <= 0) continue;
      contacts++;

      var sl = groundSlope(wx);
      var nl = Math.sqrt(1 + sl * sl);
      var nx = sl / nl, ny = -1 / nl;          /* surface normal, pointing up */
      var tx = -ny, ty = nx;                   /* tangent, pointing forward */

      var rx = wx - b.x, ry = wy - b.y;
      var vpx = b.vx - b.av * ry;
      var vpy = b.vy + b.av * rx;
      var vn = vpx * nx + vpy * ny;            /* < 0 = moving into the ground */
      var vt = vpx * tx + vpy * ty;

      var fn = K_SPRING * pen - C_SPRING * vn;
      if (fn < 0) fn = 0;

      sumTx += tx; sumTy += ty;

      fx += nx * fn; fy += ny * fn;
      torque += rx * (ny * fn) - ry * (nx * fn);

      /* throttle / brake / reverse along the tangent, traction limited */
      var drive = 0;
      if (keys.gas) drive += DRIVE;
      if (keys.brake) drive += (vt > 14) ? -BRAKE_F : -REVERSE_F;
      var maxT = MU * fn;
      drive = clamp(drive, -maxT, maxT);
      drive *= (ow.x < 0 ? 1 : 0.85);         /* rear-biased, both wheels driven */
      fx += tx * drive; fy += ty * drive;
      torque += rx * (ty * drive) - ry * (tx * drive);

      /* rolling resistance: viscous, capped by Coulomb friction */
      var cap = (keys.gas || keys.brake ? ROLL_GAS : ROLL_COAST) * fn;
      var fric = clamp(-vt * DAMP_ROLL, -cap, cap);
      fx += tx * fric; fy += ty * fric;
      torque += rx * (ty * fric) - ry * (tx * fric);
    }

    /* lean input (full in the air, softened on the ground) */
    if (state === 'running' && (keys.back || keys.fwd)) {
      var scale = contacts > 0 ? LEAN_GROUND : 1;
      if (keys.back) torque -= INERTIA * LEAN_A * scale;
      if (keys.fwd) torque += INERTIA * LEAN_A * scale;
    }

    /* low-speed climbing assist: on very steep faces the spring geometry alone
       can stall the bike at a local minimum. When the rider holds throttle and
       is barely moving, push gently along the average ground tangent. */
    if (grounded && contacts > 0 && (keys.gas || keys.brake)) {
      var tl2 = Math.sqrt(sumTx * sumTx + sumTy * sumTy) || 1;
      var atx = sumTx / tl2, aty = sumTy / tl2;
      var fwd2 = b.vx * atx + b.vy * aty;
      if (keys.gas && fwd2 < 42) {
        var push = ASSIST_F * (1 - Math.max(0, fwd2) / 42);
        fx += atx * push; fy += aty * push;
      }
    }

    /* integrate (semi-implicit, sub-stepped by the caller) */
    b.vx = clamp(b.vx + fx * h, -380, 640);
    b.vy = clamp(b.vy + fy * h, -950, 1250);
    b.av = clamp(b.av + (torque / INERTIA) * h, -AV_CAP, AV_CAP);
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.ang += b.av * h;
    b.spin += (b.vx / WR) * h;

    var prevGrounded = grounded;
    grounded = contacts > 0;
    if (grounded) {
      b.av *= Math.max(0, 1 - 5 * h);         /* suspension scrubs spin on landing */
      if (b.ang > TAU * 50 || b.ang < -TAU * 50) b.ang = b.ang % TAU;
    }

    /* crash: the stickman's head touches the ground */
    c = Math.cos(b.ang); s = Math.sin(b.ang);
    var hx = b.x + HEAD.x * c - HEAD.y * s;
    var hy = b.y + HEAD.x * s + HEAD.y * c;
    var hg = groundAt(hx);
    if (hg !== null && hy + HEAD_R >= hg + 1) { crash('The rider hit the ground!'); return; }

    /* fell into a chasm */
    if (b.y > H + 60) { crash('You fell into a gap!'); return; }

    /* landing bookkeeping: flip bonuses */
    if (!grounded) {
      airTime += h;
      airRot += b.av * h;
    } else if (!prevGrounded) {
      if (airTime > 0.4) {
        var flips = Math.floor((Math.abs(airRot) + 0.4 * TAU) / TAU);
        if (flips > 0 && state === 'running') awardFlip(flips);
      }
      airTime = 0; airRot = 0;
    }
  }

  function awardFlip(n) {
    var bonus = 250 * n;
    score += bonus;
    flipTotal += n;
    var word = n === 1 ? 'FLIP!' : (n === 2 ? 'DOUBLE FLIP!' : (n === 3 ? 'TRIPLE FLIP!' : n + '× FLIP!'));
    pops.push({ x: bike.x, y: bike.y - 54, text: word + ' +' + bonus, life: 1.3, life0: 1.3, col: '#f5b12b' });
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('point');
    hudDirty = true;
  }

  /* ---------------- states ---------------- */

  function releaseKeys() {
    keys.gas = keys.brake = keys.back = keys.fwd = false;
  }

  function resetBike() {
    var gy = groundAt(120);
    bike.x = 120;
    bike.y = (gy === null ? 460 : gy) - RIDE_H;
    bike.vx = 0; bike.vy = 0;
    bike.ang = Math.atan(groundSlope(120));
    bike.av = 0; bike.spin = 0;
    grounded = false; airTime = 0; airRot = 0;
    crashMsg = '';
    cam.x = 0;
    releaseKeys();
  }

  function start() {
    levelIdx = 0;
    score = 0;
    lives = 3;
    buildLevel(levelIdx);
    timeLeft = cfg.time;
    pops = []; stars = []; shake = 0;
    resetBike();
    state = 'running';
    last = now();
    hudDirty = true; hudSec = -1;
    GameShell.overlay.hide();
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('select');
    updateHud();
    ensureLoop();
  }

  function restartLevel() {
    if (state === 'ready') { start(); return; }
    buildLevel(levelIdx);
    timeLeft = cfg.time;
    pops = []; stars = []; shake = 0;
    crashT = 0;
    resetBike();
    state = 'running';
    last = now();
    hudDirty = true; hudSec = -1;
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function nextLevel() {
    if (levelIdx >= LEVELS.length - 1) { start(); return; }
    levelIdx++;
    buildLevel(levelIdx);
    timeLeft = cfg.time;
    pops = []; stars = []; shake = 0;
    resetBike();
    state = 'running';
    last = now();
    hudDirty = true; hudSec = -1;
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    releaseKeys();
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Catch your breath — the trail will wait.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Level', value: (levelIdx + 1) + '/' + LEVELS.length },
        { label: 'Tier', value: (levelIdx + 1) + '/9' },
        { label: 'Time', value: Math.ceil(timeLeft) + 's' }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function crash(msg) {
    if (state !== 'running') return;
    state = 'crashed';
    lives = Math.max(0, lives - 1);
    crashT = 1.25;
    crashMsg = msg;
    crashX = bike.x;
    crashY = bike.y + HEAD.y;
    shake = 10;
    releaseKeys();
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('explode');
    stars = [];
    for (var i = 0; i < 7; i++) {
      stars.push({
        a: (i / 7) * TAU,
        r: 20 + (i % 3) * 7,
        sp: 2.6 + (i % 3) * 0.8,
        sz: 5 + (i % 3) * 1.6
      });
    }
    hudDirty = true;
  }

  function gameOver() {
    state = 'over';
    crashT = 0;
    releaseKeys();
    if (score > best) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('lose');
    hudDirty = true;
    updateHud();
    GameShell.overlay.show({
      title: 'Out of lives!',
      msg: 'You used all three lives on ' + cfg.name + '. The trail is tough — reset and ride it again.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Level', value: (levelIdx + 1) + '/' + LEVELS.length }
      ],
      btn: '▶ Try again',
      action: start
    });
  }

  function win() {
    if (state !== 'running') return;
    state = 'won';
    releaseKeys();
    var bonus = 500 + (levelIdx + 1) * 150 + Math.floor(timeLeft) * 10;
    score += bonus;
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('win');
    hudDirty = true;
    updateHud();
    var lastLevel = levelIdx >= LEVELS.length - 1;
    GameShell.overlay.show({
      title: lastLevel ? 'Trail complete!' : 'Level cleared!',
      msg: (lastLevel ? 'You conquered all ' + LEVELS.length + ' trails of ' : 'You crossed ') + cfg.name +
           ' with ' + Math.ceil(timeLeft) + ' seconds left.' +
           (lastLevel ? '' : ' Next trail is harder: longer, rougher and tighter on time.') +
           ' Clear bonus: +' + bonus + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Level', value: (levelIdx + 1) + '/' + LEVELS.length },
        { label: 'Tier', value: (levelIdx + 1) + '/9' }
      ],
      btn: lastLevel ? '▶ Play again' : '▶ Next level',
      action: lastLevel ? start : nextLevel
    });
  }

  function updateHud() {
    hudDirty = false;
    hudSec = Math.ceil(timeLeft);
    var st = levelStats(levelIdx);
    var cue = st.nextHarder ? 'next: harder' : 'final trail';
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Level: (levelIdx + 1) + '/' + LEVELS.length,
        Lives: lives,
        Tier: st.tier + '/9',
        Time: hudSec + 's'
      },
      state === 'paused' ? '⏸ Paused' : '↑ throttle · ←→ lean · L' + (levelIdx + 1) + '/9 · ' + cue
    );
  }

  /* ---------------- swinging log pendulums ---------------- */

  function swingBob(sw) {
    var g = groundAt(sw.x);
    if (g === null) g = 460;
    var base = (sw.pivotBase != null) ? sw.pivotBase : g;
    var a = SWING_AMP * Math.sin(sw.phase + swingClock * sw.omega);
    return {
      x: sw.x + Math.sin(a) * SWING_ROPE,
      y: base - SWING_PIVOT_H + Math.cos(a) * SWING_ROPE,
      a: a,
      ground: g,
      pivotY: base - SWING_PIVOT_H
    };
  }

  function updateSwingers(dt) {
    swingClock += dt;
    for (var i = 0; i < swingers.length; i++) {
      var sw = swingers[i];
      if (Math.abs(sw.x - bike.x) > 260) continue;
      var bob = swingBob(sw);
      if (state !== 'running') return;
      var dx = bob.x - bike.x;
      var dy = bob.y - bike.y;
      var rr = SWING_R + SWING_HIT;
      if (dx * dx + dy * dy < rr * rr) {
        crash('A swinging log knocked you off!');
        return;
      }
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;

    if (state === 'running') {
      /* countdown */
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        crash('Time ran out!');
      }

      /* physics sub-steps for stability */
      if (state === 'running') {
        var steps = clamp(Math.ceil(dt / 0.008), 1, 6);
        var h = dt / steps;
        for (i = 0; i < steps && state === 'running'; i++) stepPhysics(h);
      }

      /* swinging logs sweep the trail */
      if (state === 'running') updateSwingers(dt);

      /* coins */
      if (state === 'running') {
        for (i = 0; i < coins.length; i++) {
          var cn = coins[i];
          if (cn.got) continue;
          var dx = cn.x - bike.x, dy = cn.y - bike.y;
          if (dx * dx + dy * dy < 34 * 34) {
            cn.got = true;
            score += 50;
            pops.push({ x: cn.x, y: cn.y, text: '+50', life: 0.9, life0: 0.9, col: '#2ee6a6' });
            if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('coin');
            hudDirty = true;
          }
        }

        /* finish gate */
        if (bike.x >= cfg.len) win();
      }

      /* camera follows the rider */
      var target = clamp(bike.x - 170, 0, cfg.len + 320 - W);
      cam.x += (target - cam.x) * Math.min(1, 5 * dt);

      /* live countdown in the HUD */
      if (Math.ceil(timeLeft) !== hudSec || hudDirty) updateHud();

    } else if (state === 'crashed') {
      crashT -= dt;
      shake = Math.max(0, shake - dt * 26);
      if (crashT <= 0) {
        if (lives <= 0) gameOver();
        else restartLevel();
      }
    }

    /* floating texts */
    for (i = pops.length - 1; i >= 0; i--) {
      pops[i].life -= dt;
      pops[i].y -= 34 * dt;
      if (pops[i].life <= 0) pops.splice(i, 1);
    }
  }

  /* ---------------- drawing ---------------- */

  function drawHillLayer(par, baseY, amp, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(0, H);
    var off = cam.x * par;
    for (var x = 0; x <= W + 12; x += 12) {
      var wx = x + off;
      var y = baseY
        - Math.sin(wx / 420) * amp
        - Math.sin(wx / 170 + 2.1) * amp * 0.4;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fill();
  }

  function starPath(x, y, r, rot) {
    ctx.beginPath();
    for (var i = 0; i < 10; i++) {
      var rr = i % 2 === 0 ? r : r * 0.45;
      var a = rot + (i / 10) * TAU;
      var px = x + Math.cos(a) * rr;
      var py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawTerrain() {
    var i;
    var i0 = Math.max(0, Math.floor(cam.x / TS) - 2);
    var i1 = Math.min(hs.length - 1, Math.ceil((cam.x + W) / TS) + 2);
    var segOpen = false;

    /* fills: one path per solid segment, skipped over chasms */
    ctx.fillStyle = '#0d2a24';
    ctx.beginPath();
    for (i = i0; i <= i1; i++) {
      var x = i * TS - cam.x;
      var inGap = false, g;
      for (g = 0; g < gaps.length; g++) {
        if (i * TS >= gaps[g][0] && i * TS <= gaps[g][0] + gaps[g][1]) { inGap = true; break; }
      }
      if (inGap) {
        if (segOpen) {
          if (i > 0) ctx.lineTo(x, hs[i - 1]);
          ctx.lineTo(x, H); ctx.closePath(); ctx.fill(); ctx.beginPath(); segOpen = false;
        }
        continue;
      }
      if (!segOpen) { ctx.moveTo(x, H); ctx.lineTo(x, hs[i]); segOpen = true; }
      else ctx.lineTo(x, hs[i]);
    }
    if (segOpen) { ctx.lineTo(W + 12, H); ctx.closePath(); ctx.fill(); }

    /* glowing surface line */
    ctx.strokeStyle = '#2ee6a6';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'rgba(46,230,166,.7)';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    var pen = false;
    for (i = i0; i <= i1; i++) {
      var gx = i * TS - cam.x, bad = false, gg;
      for (gg = 0; gg < gaps.length; gg++) {
        if (i * TS >= gaps[gg][0] && i * TS <= gaps[gg][0] + gaps[gg][1]) { bad = true; break; }
      }
      if (bad) { pen = false; continue; }
      if (!pen) { ctx.moveTo(gx, hs[i]); pen = true; }
      else ctx.lineTo(gx, hs[i]);
    }
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* chasm walls */
    ctx.strokeStyle = 'rgba(147,163,194,.5)';
    ctx.lineWidth = 2;
    for (var g2 = 0; g2 < gaps.length; g2++) {
      var gs = gaps[g2][0] - cam.x, ge = gs + gaps[g2][1];
      if (ge < -20 || gs > W + 20) continue;
      var iL = clamp(Math.floor(gaps[g2][0] / TS), 0, hs.length - 1);
      var iR = clamp(Math.ceil((gaps[g2][0] + gaps[g2][1]) / TS), 0, hs.length - 1);
      ctx.beginPath();
      ctx.moveTo(gs, hs[iL]); ctx.lineTo(gs, H);
      ctx.moveTo(ge, hs[iR]); ctx.lineTo(ge, H);
      ctx.stroke();
    }
  }

  function drawDecor() {
    var i, x;

    /* rocks: filled along the terrain silhouette so wheels match the drawing */
    ctx.fillStyle = '#5b6478';
    ctx.strokeStyle = '#8b94ab';
    ctx.lineWidth = 2;
    for (i = 0; i < rocks.length; i++) {
      x = rocks[i].x - cam.x;
      if (x < -40 || x > W + 40) continue;
      var rL = groundAt(rocks[i].x - rocks[i].w);
      var rC = groundAt(rocks[i].x);
      var rR = groundAt(rocks[i].x + rocks[i].w);
      if (rL === null || rC === null || rR === null) continue;
      ctx.beginPath();
      ctx.moveTo(x - rocks[i].w, rL + 3);
      ctx.quadraticCurveTo(x - rocks[i].w * 0.3, rC - 4, x, rC - 3);
      ctx.quadraticCurveTo(x + rocks[i].w * 0.4, rC - 4, x + rocks[i].w, rR + 3);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
    }

    /* logs: round cylinders resting on the trail */
    ctx.fillStyle = '#7a4d24';
    ctx.strokeStyle = '#a9743d';
    for (i = 0; i < logs.length; i++) {
      x = logs[i].x - cam.x;
      if (x < -40 || x > W + 40) continue;
      var lbL = groundAt(logs[i].x - logs[i].w);
      var lbC = groundAt(logs[i].x);
      if (lbL === null || lbC === null) continue;
      var rh = logs[i].h;
      ctx.beginPath();
      ctx.ellipse(x, lbC + rh - 3, logs[i].w, rh, 0, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d3a1b';
      ctx.beginPath();
      ctx.ellipse(x + logs[i].w * 0.62, lbC + rh - 3, rh * 0.45, rh * 0.8, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#7a4d24';
    }

    /* coins */
    for (i = 0; i < coins.length; i++) {
      if (coins[i].got) continue;
      x = coins[i].x - cam.x;
      if (x < -30 || x > W + 30) continue;
      var pulse = 1 + 0.12 * Math.sin((last || 0) / 180 + i);
      ctx.save();
      ctx.translate(x, coins[i].y);
      ctx.shadowColor = '#f5b12b';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#f5b12b';
      ctx.beginPath();
      ctx.arc(0, 0, 9 * pulse, 0, TAU);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#8a5b06';
      ctx.font = '700 11px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('$', 0, 1);
      ctx.restore();
    }

    /* finish gate */
    var fx = cfg.len - cam.x;
    if (fx > -80 && fx < W + 80) {
      var fg = groundAt(cfg.len);
      if (fg !== null) {
        ctx.strokeStyle = '#e8eefc';
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.moveTo(fx - 34, fg + 4); ctx.lineTo(fx - 34, fg - 84);
        ctx.moveTo(fx + 34, fg + 4); ctx.lineTo(fx + 34, fg - 84);
        ctx.stroke();
        var cw = 12, ch = 12;
        for (var r = 0; r < 2; r++) {
          for (var cix = 0; cix < 6; cix++) {
            ctx.fillStyle = (r + cix) % 2 === 0 ? '#e8eefc' : '#101728';
            ctx.fillRect(fx - 36 + cix * cw, fg - 84 + r * ch, cw, ch);
          }
        }
        ctx.strokeStyle = 'rgba(232,238,252,.8)';
        ctx.lineWidth = 1;
        ctx.strokeRect(fx - 36, fg - 84, cw * 6, ch * 2);
      }
    }
  }

  function drawSwingers() {
    for (var i = 0; i < swingers.length; i++) {
      var sw = swingers[i];
      var x = sw.x - cam.x;
      if (x < -170 || x > W + 170) continue;

      var bob = swingBob(sw);
      var bx = bob.x - cam.x;
      var g = bob.ground;
      var pivotY = bob.pivotY;
      var low = Math.abs(bob.a) < 0.6;
      var gl = groundAt(sw.x - 66), gr = groundAt(sw.x + 66);
      if (gl === null) gl = g;
      if (gr === null) gr = g;

      /* timber gallows: two posts and a crossbeam the rider passes under */
      ctx.strokeStyle = '#3b2a1c';
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(x - 66, gl + 4);
      ctx.lineTo(x - 66, pivotY - 8);
      ctx.moveTo(x + 66, gr + 4);
      ctx.lineTo(x + 66, pivotY - 8);
      ctx.moveTo(x - 72, pivotY - 8);
      ctx.lineTo(x + 72, pivotY - 8);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(169,116,61,.5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 60, gl - 12);
      ctx.lineTo(x - 12, pivotY + 8);
      ctx.moveTo(x + 60, gr - 12);
      ctx.lineTo(x + 12, pivotY + 8);
      ctx.stroke();

      /* marked danger sweep on the ground */
      ctx.strokeStyle = 'rgba(255,92,122,' + (low ? 0.6 : 0.22) + ')';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(x, g + 2, 98, 9, 0, 0, TAU);
      ctx.stroke();

      /* rope and log bob */
      ctx.strokeStyle = '#8b7355';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, pivotY - 2);
      ctx.lineTo(bx, bob.y);
      ctx.stroke();

      ctx.save();
      ctx.translate(bx, bob.y);
      ctx.rotate(bob.a * 0.42);
      ctx.fillStyle = '#7a4d24';
      ctx.strokeStyle = low ? '#ff5c7a' : '#a9743d';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 10, 0, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = 'rgba(93,58,27,.9)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(-10, -5); ctx.lineTo(-6, 5);
      ctx.moveTo(-1, -7); ctx.lineTo(3, 7);
      ctx.moveTo(8, -5); ctx.lineTo(10, 4);
      ctx.stroke();
      ctx.restore();

      ctx.fillStyle = low ? 'rgba(255,92,122,.95)' : 'rgba(245,177,43,.85)';
      ctx.font = '700 10px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('SWING', x, pivotY - 14);
    }
  }

  function drawRider(t) {
    /* stick figure in the bike frame; leans with the rider input */
    var lean = 0;
    if (keys.back) lean = -0.16;
    if (keys.fwd) lean = 0.16;
    var bob = keys.gas ? Math.sin(t / 60) * 0.6 : 0;

    ctx.save();
    ctx.rotate(lean);
    ctx.strokeStyle = '#e8eefc';
    ctx.fillStyle = '#e8eefc';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';

    var hipX = -6, hipY = -11;
    var shX = 1, shY = -24;

    /* torso */
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(shX, shY + bob);
    ctx.stroke();

    /* head (also the crash collider, HEAD offset must match) */
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y + bob, HEAD_R + 0.5, 0, TAU);
    ctx.fillStyle = '#05070e';
    ctx.fill();
    ctx.stroke();
    /* helmet peak */
    ctx.beginPath();
    ctx.arc(HEAD.x, HEAD.y + bob, HEAD_R + 0.5, -2.4, -0.6);
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = '#e8eefc';
    ctx.lineWidth = 3;

    /* arms to the handlebars */
    ctx.beginPath();
    ctx.moveTo(shX, shY + bob);
    ctx.quadraticCurveTo(shX + 10, shY + 8 + bob, 20, -9);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shX, shY + 2 + bob);
    ctx.quadraticCurveTo(shX + 8, shY + 12 + bob, 17, -6);
    ctx.stroke();

    /* legs to the pegs */
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.quadraticCurveTo(hipX - 8, hipY + 8, -3, 6);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.quadraticCurveTo(hipX - 12, hipY + 4, -9, 5);
    ctx.stroke();

    ctx.restore();
  }

  function drawBike(t) {
    var b = bike;
    ctx.save();
    ctx.translate(b.x - cam.x, b.y);
    ctx.rotate(b.ang);

    /* wheels */
    for (var i = 0; i < 2; i++) {
      var ow = WOFF[i];
      ctx.save();
      ctx.translate(ow.x, ow.y);
      ctx.rotate(b.spin);
      ctx.fillStyle = '#05070e';
      ctx.strokeStyle = '#dbe6ff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, WR, 0, TAU);
      ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(190,205,235,.85)';
      ctx.lineWidth = 1.4;
      for (var s2 = 0; s2 < 4; s2++) {
        var a = s2 * (TAU / 8) + (s2 % 2) * 0;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * -WR, Math.sin(a) * -WR);
        ctx.lineTo(Math.cos(a) * WR, Math.sin(a) * WR);
        ctx.stroke();
      }
      ctx.fillStyle = '#7c5cff';
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* frame */
    ctx.strokeStyle = '#9fb4d8';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-24, 10);
    ctx.lineTo(-8, -7);
    ctx.lineTo(18, -8);
    ctx.lineTo(24, 10);
    ctx.moveTo(-8, -7);
    ctx.lineTo(-4, 8);
    ctx.lineTo(-24, 10);
    ctx.stroke();

    /* seat + bars */
    ctx.strokeStyle = '#101728';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-15, -8); ctx.lineTo(-4, -8);
    ctx.stroke();
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(17, -12); ctx.lineTo(23, -6);
    ctx.stroke();

    /* exhaust puff */
    if (keys.gas && state === 'running') {
      ctx.fillStyle = 'rgba(160,180,220,.4)';
      ctx.beginPath();
      ctx.arc(-30, 6, 3 + Math.random() * 2.4, 0, TAU);
      ctx.fill();
    }

    drawRider(t);
    ctx.restore();
  }

  function drawCrashFx() {
    var i;
    var alpha = clamp(crashT / 1.25, 0, 1);
    for (i = 0; i < stars.length; i++) {
      var st = stars[i];
      var a = st.a + (1.25 - crashT) * st.sp;
      var x = crashX - cam.x + Math.cos(a) * st.r;
      var y = crashY + Math.sin(a) * st.r * 0.7;
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#ffd23e';
      starPath(x, y, st.sz, a);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (state === 'crashed') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.font = '700 22px ' + FONT;
      ctx.fillStyle = 'rgba(255,92,122,' + (0.4 + 0.6 * alpha) + ')';
      ctx.fillText('CRASH!', W / 2, 120);
      ctx.font = '600 15px ' + FONT;
      ctx.fillStyle = 'rgba(232,238,252,' + (0.5 + 0.5 * alpha) + ')';
      ctx.fillText(crashMsg + (lives > 0 ? '  Restarting.' : '  Out of lives!'), W / 2, 146);
    }
  }

  function drawPops() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      var a = clamp(p.life / p.life0, 0, 1);
      ctx.globalAlpha = a;
      ctx.font = '800 20px ' + FONT;
      ctx.fillStyle = p.col;
      ctx.fillText(p.text, p.x - cam.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* sky */
    var sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#070b18');
    sky.addColorStop(0.6, '#0b1426');
    sky.addColorStop(1, '#0e1b2c');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    /* stars in the sky */
    ctx.fillStyle = 'rgba(207,227,255,.7)';
    for (var i = 0; i < 26; i++) {
      var sx = ((i * 97) % W + W - cam.x * 0.05) % W;
      var sy = 18 + ((i * 53) % 120);
      ctx.globalAlpha = 0.25 + 0.5 * Math.abs(Math.sin(t / 900 + i));
      ctx.fillRect(sx, sy, 2, 2);
    }
    ctx.globalAlpha = 1;

    drawHillLayer(0.15, 330, 34, '#0c1830');
    drawHillLayer(0.35, 400, 46, '#0f1e38');

    var shx = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    var shy = shake > 0 ? (Math.random() - 0.5) * shake : 0;
    ctx.save();
    ctx.translate(shx, shy);

    drawTerrain();
    drawDecor();
    drawSwingers();
    if (state !== 'ready') drawBike(t);
    drawCrashFx();
    drawPops();

    ctx.restore();

    /* top banners */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 15px ' + FONT;
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText(cfg.name, 14, 26);
    ctx.font = '700 10px ' + FONT;
    ctx.fillStyle = 'rgba(46,230,166,.9)';
    ctx.fillText('LEVEL ' + (levelIdx + 1) + '/' + LEVELS.length +
                 (levelIdx < LEVELS.length - 1 ? ' · NEXT: HARDER' : ' · FINAL'), 14, 42);
    ctx.fillStyle = timeLeft <= 10 && state === 'running' ? '#ff5c7a' : '#f5b12b';
    ctx.textAlign = 'right';
    ctx.font = '700 15px ' + FONT;
    ctx.fillText(Math.ceil(timeLeft) + 's', W - 14, 26);

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 54);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running' || state === 'crashed') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === undefined || k === null) return;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.gas = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.brake = true;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.back = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.fwd = true;
    else if (k === ' ') {
      if (state === 'ready') start();
      else if (state === 'paused') resume();
      else if (state === 'won') nextLevel();
    } else if (k === 'Enter') {
      if (state === 'ready') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.gas = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.brake = false;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.back = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.fwd = false;
  });

  window.addEventListener('blur', releaseKeys);

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready') { start(); return; }
        if (state === 'won') { nextLevel(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'gas') keys.gas = true;
        else if (act === 'brake') keys.brake = true;
        else if (act === 'back') keys.back = true;
        else if (act === 'fwd') keys.fwd = true;
      }
      function off() {
        if (act === 'gas') keys.gas = false;
        else if (act === 'brake') keys.brake = false;
        else if (act === 'back') keys.back = false;
        else if (act === 'fwd') keys.fwd = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__stickmanRider', {
      value: Object.freeze({
        snapshot: function () {
          return {
            state: state,
            level: levelIdx + 1,
            levels: LEVELS.length,
            levelName: cfg ? cfg.name : '',
            score: score,
            lives: lives,
            best: Math.max(best, score),
            timeLeft: Math.ceil(timeLeft),
            x: Math.round(bike.x * 10) / 10,
            y: Math.round(bike.y * 10) / 10,
            vx: Math.round(bike.vx * 10) / 10,
            vy: Math.round(bike.vy * 10) / 10,
            ang: bike.ang,
            grounded: grounded,
            flips: flipTotal,
            coins: coins.filter(function (c) { return c.got; }).length,
            coinsTotal: coins.length,
            courseLen: cfg ? cfg.len : 0,
            progress: cfg ? clamp(bike.x / cfg.len, 0, 1) : 0,
            gaps: gaps.map(function (gp) { return [gp[0], gp[1]]; }),
            obstacles: {
              rocks: rocks.length,
              logs: logs.length,
              coins: coins.length,
              swingers: swingers.length
            },
            swingers: swingers.map(function (sw) {
              var sb = swingBob(sw);
              return {
                x: Math.round(sw.x),
                bx: Math.round(sb.x),
                by: Math.round(sb.y),
                angle: Math.round(sb.a * 100) / 100,
                omega: Math.round(sw.omega * 100) / 100,
                low: Math.abs(sb.a) < 0.6
              };
            }),
            difficulty: cfg ? {
              tier: levelIdx + 1,
              tiers: LEVELS.length,
              difficultyScore: levelStats(levelIdx).score,
              nextHarder: levelIdx < LEVELS.length - 1,
              hazardFactor: cfg.hazard,
              requiredSpeed: levelStats(levelIdx).requiredSpeed,
              timePerPixel: levelStats(levelIdx).timePerPixel,
              amp: cfg.amp,
              rough: cfg.rough,
              gaps: gaps.length,
              maxGap: gaps.reduce(function (m, gp) { return Math.max(m, gp[1]); }, 0),
              gapWidths: gaps.map(function (gp) { return gp[1]; }),
              rocks: cfg.rocks,
              logs: cfg.logs,
              timeLimit: cfg.time,
              rampHeight: RAMP_BASE + levelIdx * RAMP_STEP,
              bowlDepth: BOWL_BASE + levelIdx * BOWL_STEP,
              drive: DRIVE,
              assist: ASSIST_F,
              swingers: cfg.swingers || 0,
              swingSpeed: Math.round((SWING_OMEGA + levelIdx * SWING_STEP) * 100) / 100,
              swingRope: SWING_ROPE,
              swingAmplitude: SWING_AMP,
              swingRadius: SWING_R,
              swingPivotHeight: SWING_PIVOT_H
            } : null,
            slope: Math.round(groundSlope(bike.x) * 100) / 100,
            wheels: (function () {
              var c2 = Math.cos(bike.ang), s2 = Math.sin(bike.ang);
              var out = [];
              for (var i = 0; i < 2; i++) {
                var ow = WOFF[i];
                var wx = bike.x + ow.x * c2 - ow.y * s2;
                var wy = bike.y + ow.x * s2 + ow.y * c2;
                var gg = groundAt(wx);
                out.push({
                  wx: Math.round(wx),
                  pen: gg === null ? null : Math.round(((wy + WR) - gg) * 100) / 100,
                  sl: gg === null ? null : Math.round(groundSlope(wx) * 100) / 100
                });
              }
              return out;
            })(),
            gAhead: (function () {
              var a = groundAt(bike.x + 18);
              var b2 = groundAt(bike.x);
              return (a === null || b2 === null) ? null : Math.round((a - b2) * 10) / 10;
            })(),
            crashMsg: crashMsg
          };
        },
        /* test helper: jump straight into any of the nine levels */
        loadLevel: function (n) {
          n = n | 0;
          if (n < 0) n = 0;
          if (n > LEVELS.length - 1) n = LEVELS.length - 1;
          levelIdx = n;
          buildLevel(n);
          timeLeft = cfg.time;
          pops = []; stars = []; shake = 0; crashT = 0;
          resetBike();
          state = 'running';
          last = now();
          hudDirty = true; hudSec = -1;
          GameShell.overlay.hide();
          updateHud();
          ensureLoop();
          return n + 1;
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  buildLevel(0);
  resetBike();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Stickman Rider',
    msg: 'Hold the throttle with ↑ or W, lean with ← and →, and carry the stickman rider over hills, logs, chasms and swinging log pendulums to the finish gate. Land a full flip for bonus points — but keep his head off the ground.',
    stats: [{ label: 'Best', value: best }, { label: 'Levels', value: LEVELS.length }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
