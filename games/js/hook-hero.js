/* ============================================================
   Hook Hero — original game for PixelPlay
   Canvas grapple-swing platformer: hold to hook the glowing
   anchor rings, swing like a pendulum and release over the
   bottomless neon chasm. Six hand-built stages, real pendulum
   physics, keyboard first with pointer + touch support.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'hook-hero';
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

  /* ---------------- physics constants ---------------- */

  var GRAV = 1150;        /* px/s²                                  */
  var MAX_REACH = 540;    /* hook range                             */
  var PULL = 118;         /* gentle forward pull while swinging     */
  var FALL_Y = 900;       /* below this is the chasm                */
  var VX_MAX = 720, VY_MAX = 950;

  /* ---------------- hand-designed levels ----------------
     anchors + coins in world coords (y grows downwards);
     each stage ends at a glowing finish gate.               */

  var LEVELS = [
    {
      name: 'First Swing',
      start: { x: 110, y: 300 },
      anchors: [[340, 200], [760, 250], [1180, 180], [1600, 240], [2020, 190]],
      coins: [[550, 330], [960, 310], [1390, 290], [1810, 320], [2230, 280]],
      gate: 2280, par: 26
    },
    {
      name: 'Wide Awake',
      start: { x: 110, y: 270 },
      anchors: [[330, 160], [740, 300], [1160, 180], [1560, 320], [1980, 200], [2380, 300]],
      coins: [[540, 330], [950, 360], [1360, 330], [1770, 360], [2180, 320]],
      gate: 2620, par: 30
    },
    {
      name: 'High and Low',
      start: { x: 110, y: 300 },
      anchors: [[340, 260], [790, 150], [1220, 330], [1650, 160], [2080, 330], [2500, 190]],
      coins: [[560, 340], [1000, 320], [1430, 350], [1860, 320], [2290, 350]],
      gate: 2740, par: 32
    },
    {
      name: 'The Long Reach',
      start: { x: 110, y: 280 },
      anchors: [[350, 190], [820, 250], [1330, 170], [1830, 260], [2340, 180], [2790, 270]],
      coins: [[580, 320], [1070, 330], [1580, 320], [2080, 330], [2560, 330]],
      gate: 3060, par: 34
    },
    {
      name: 'Zig-zag Zephyr',
      start: { x: 110, y: 310 },
      anchors: [[330, 300], [720, 140], [1150, 330], [1580, 150], [2010, 330], [2440, 170]],
      coins: [[520, 360], [930, 330], [1360, 360], [1790, 330], [2220, 360]],
      gate: 2680, par: 32
    },
    {
      name: 'Final Flight',
      start: { x: 110, y: 290 },
      anchors: [[340, 200], [780, 320], [1240, 150], [1700, 320], [2160, 160], [2620, 320], [3080, 190]],
      coins: [[560, 340], [1010, 330], [1470, 330], [1930, 330], [2390, 330], [2850, 330]],
      gate: 3340, par: 38
    }
  ];

  /* ---------------- state ---------------- */

  var state = 'ready';        /* ready | countdown | running | paused | cleared | over */
  var levelIdx = 0, level = null;
  var player = { x: 0, y: 0, vx: 0, vy: 0 };
  var attached = false, anchor = null, ropeLen = 0;
  var hookHeld = false;
  var score = 0, coins = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var coinTaken = [];         /* per-level flags — stay taken across retries */
  var levelTime = 0, attempts = 0, clearT = 0, ct = 0, lastBonus = 0;
  var trail = [], trailT = 0;
  var camX = 0, camY = 0;
  var hudKey = '';
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function levelWidth() { return level.gate + 170; }

  /* ---------------- HUD / states ---------------- */

  function updateHud(force) {
    var key = state + '|' + score + '|' + coins + '|' + levelIdx + '|' + Math.max(best, score);
    if (!force && key === hudKey) return;
    hudKey = key;
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Level: (levelIdx + 1) + '/' + LEVELS.length,
        Coins: coins
      },
      state === 'paused' ? '⏸ Paused' : 'Hold Space = hook · release = fly'
    );
  }

  function persistBest() {
    if (score > best) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
  }

  function loadLevel(idx) {
    levelIdx = idx;
    level = LEVELS[idx];
    player.x = level.start.x;
    player.y = level.start.y;
    player.vx = 0;
    player.vy = 0;
    attached = false;
    anchor = null;
    ropeLen = 0;
    levelTime = 0;
    trail = [];
    if (!coinTaken[idx]) {
      coinTaken[idx] = [];
      for (var i = 0; i < level.coins.length; i++) coinTaken[idx].push(false);
    }
    updateHud(true);
  }

  function start() {
    score = 0; coins = 0;
    coinTaken = [];
    attempts = 0;
    loadLevel(0);
    state = 'countdown';
    ct = 0.9;
    hookHeld = false;
    last = now();
    GameShell.overlay.hide();
    updateHud(true);
    ensureLoop();
  }

  function pause() {
    if (state !== 'running' && state !== 'countdown') return;
    state = 'paused';
    releaseHook();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The chasm will still be there. Resume when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Level', value: (levelIdx + 1) + '/' + LEVELS.length },
        { label: 'Coins', value: coins }
      ],
      btn: '▶ Resume',
      action: resume
    });
    updateHud(true);
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'countdown';
    ct = 0.5;
    last = now();
    GameShell.overlay.hide();
    ensureLoop();
  }

  function win() {
    state = 'over';
    persistBest();
    updateHud(true);
    GameShell.overlay.show({
      title: 'Chasm conquered!',
      msg: 'All six stages cleared in one run — a true hero of the hook. Your best score is saved in this browser.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Level', value: LEVELS.length + '/' + LEVELS.length },
        { label: 'Coins', value: coins }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function clearLevel() {
    var timeBonus = Math.max(0, Math.round((level.par - levelTime) * 12));
    lastBonus = 250 + timeBonus;
    score += lastBonus;
    persistBest();
    updateHud(true);
    if (levelIdx >= LEVELS.length - 1) { win(); return; }
    state = 'cleared';
    clearT = 1.25;
  }

  function respawn() {
    attempts++;
    persistBest();
    loadLevel(levelIdx);          /* coins already taken stay taken */
    state = 'countdown';
    ct = 0.7;
  }

  function releaseHook() {
    hookHeld = false;
    attached = false;
    anchor = null;
    ropeLen = 0;
  }

  /* ---------------- hook / rope ---------------- */

  function tryAttach() {
    if (attached || !level) return false;
    var pick = null, pickScore = 1e9, pickD = 0;
    for (var i = 0; i < level.anchors.length; i++) {
      var ax = level.anchors[i][0], ay = level.anchors[i][1];
      var dx = ax - player.x, dy = ay - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > MAX_REACH || ay >= player.y + 60) continue;
      /* prefer anchors ahead — grabbing the ring you just passed wastes swing */
      var s = d + (ax < player.x - 20 ? 160 : 0);
      if (s < pickScore) {
        pick = level.anchors[i];
        pickScore = s;
        pickD = d;
      }
    }
    if (pick) {
      attached = true;
      anchor = { x: pick[0], y: pick[1] };
      ropeLen = clamp(pickD, 50, MAX_REACH);
      return true;
    }
    return false;
  }

  function constrain() {
    var dx = player.x - anchor.x, dy = player.y - anchor.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 1e-6) return;
    if (d > ropeLen) {
      var nx = dx / d, ny = dy / d;
      player.x = anchor.x + nx * ropeLen;
      player.y = anchor.y + ny * ropeLen;
      var vr = player.vx * nx + player.vy * ny;
      if (vr > 0) {                 /* rope only pulls inwards */
        player.vx -= vr * nx;
        player.vy -= vr * ny;
      }
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    if (state === 'countdown') {
      ct -= dt;
      if (ct <= 0) { state = 'running'; updateHud(true); }
      return;
    }
    if (state === 'cleared') {
      clearT -= dt;
      if (clearT <= 0) {
        loadLevel(levelIdx + 1);
        state = 'countdown';
        ct = 0.9;
      }
      return;
    }
    if (state !== 'running') return;

    levelTime += dt;

    if (hookHeld && !attached) tryAttach();

    player.vy += GRAV * dt;
    if (attached) player.vx += PULL * dt;      /* gentle forward pull */
    player.vx *= 0.9995;
    player.x += player.vx * dt;
    player.y += player.vy * dt;
    if (attached) constrain();
    player.vx = clamp(player.vx, -VX_MAX, VX_MAX);
    player.vy = clamp(player.vy, -VY_MAX, VY_MAX);

    /* dotted flight trail */
    trailT += dt;
    if (trailT >= 0.035) {
      trailT = 0;
      trail.push({ x: player.x, y: player.y });
      if (trail.length > 70) trail.shift();
    }

    /* coins */
    var taken = coinTaken[levelIdx];
    for (var i = 0; i < level.coins.length; i++) {
      if (taken[i]) continue;
      var cx = level.coins[i][0] - player.x, cy = level.coins[i][1] - player.y;
      if (cx * cx + cy * cy < 30 * 30) {
        taken[i] = true;
        coins++;
        score += 25;
        updateHud(true);
      }
    }

    /* fell into the chasm */
    if (player.y > FALL_Y) { respawn(); return; }

    /* reached the finish gate */
    if (player.x > level.gate) { clearLevel(); return; }

    updateHud(false);
  }

  /* ---------------- stickman drawing ----------------
     Skeleton of head circle + line limbs; pose fields are
     interpolated where motion needs blending.              */

  function drawStick(hipX, hipY, pose, col) {
    ctx.save();
    ctx.translate(hipX, hipY);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 9;

    var lean = pose.lean;
    var sx = Math.sin(lean) * 26, sy = -Math.cos(lean) * 26;   /* shoulder */

    /* legs */
    var kx = Math.sin(pose.legF) * 15, ky = Math.cos(pose.legF) * 15;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(kx, ky);
    ctx.lineTo(kx + Math.sin(pose.legF + pose.kneeF) * 14,
               ky + Math.cos(pose.legF + pose.kneeF) * 14);
    ctx.stroke();
    kx = Math.sin(pose.legB) * 15; ky = Math.cos(pose.legB) * 15;
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(kx, ky);
    ctx.lineTo(kx + Math.sin(pose.legB + pose.kneeB) * 14,
               ky + Math.cos(pose.legB + pose.kneeB) * 14);
    ctx.stroke();

    /* arms */
    var ax = sx + Math.sin(pose.armF) * 13, ay = sy + Math.cos(pose.armF) * 13;
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ax, ay);
    ctx.lineTo(ax + Math.sin(pose.armF + pose.elbowF) * 12,
               ay + Math.cos(pose.armF + pose.elbowF) * 12);
    ctx.stroke();
    ax = sx + Math.sin(pose.armB) * 13; ay = sy + Math.cos(pose.armB) * 13;
    ctx.beginPath();
    ctx.moveTo(sx, sy); ctx.lineTo(ax, ay);
    ctx.lineTo(ax + Math.sin(pose.armB + pose.elbowB) * 12,
               ay + Math.cos(pose.armB + pose.elbowB) * 12);
    ctx.stroke();

    /* torso + head */
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(sx, sy);
    ctx.stroke();
    var hx = sx + Math.sin(lean) * 13, hy = sy - Math.cos(lean) * 13;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  function heroPose(t) {
    if (attached && anchor) {
      /* hang from the rope: arms reach toward the anchor */
      var shX = player.x - camX, shY = player.y - camY - 42;
      var aX = anchor.x - camX, aY = anchor.y - camY;
      var ang = Math.atan2(aX - shX, aY - shY);   /* from straight down */
      var sway = Math.sin(t / 300) * 0.16;
      return {
        lean: clamp((anchor.x - player.x) * 0.0016, -0.35, 0.35),
        armF: ang, armB: ang, elbowF: -0.22, elbowB: -0.22,
        legF: 0.30 + sway, legB: -0.34 - sway,
        kneeF: -0.35, kneeB: -0.30
      };
    }
    /* airborne */
    var up = player.vy < 0;
    return {
      lean: up ? 0.10 : 0.30,
      armF: up ? -2.45 : -1.90, armB: up ? -2.05 : -1.50,
      elbowF: -0.35, elbowB: -0.35,
      legF: up ? 0.55 : 0.35, legB: up ? -0.75 : -0.55,
      kneeF: -0.65, kneeB: -0.45
    };
  }

  /* ---------------- drawing ---------------- */

  var stars = [];
  (function () {
    for (var i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * 1600,
        y: Math.random() * 560,
        r: 0.4 + Math.random() * 1.4,
        p: Math.random() * TAU
      });
    }
  })();

  function drawAnchor(ax, ay, active, t) {
    var pulse = 2 + Math.sin(t / 240 + ax * 0.01) * 1.5;
    ctx.save();
    ctx.shadowColor = active ? '#2ee6a6' : '#7c5cff';
    ctx.shadowBlur = active ? 22 : 14;
    ctx.strokeStyle = active ? '#2ee6a6' : '#a78bfa';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(ax, ay, 12 + pulse, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = active ? '#2ee6a6' : '#c4b5fd';
    ctx.beginPath();
    ctx.arc(ax, ay, 4, 0, TAU);
    ctx.fill();
    /* little mast upward so rings read as anchors */
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = 'rgba(167,139,250,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(ax, ay - 14 - pulse);
    ctx.lineTo(ax, ay - 40 - pulse);
    ctx.stroke();
    ctx.restore();
  }

  function drawCoin(cx, cy, t, ph) {
    var spin = 0.3 + 0.7 * Math.abs(Math.sin(t / 240 + ph));
    ctx.save();
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 8 * spin, 9.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 4.2 * spin, 6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawGate(gx, t) {
    var top = 90, bot = 520;
    var pulse = 0.5 + 0.5 * Math.sin(t / 200);
    ctx.save();
    var g = ctx.createLinearGradient(gx - 18, 0, gx + 18, 0);
    g.addColorStop(0, 'rgba(46,230,166,0)');
    g.addColorStop(0.5, 'rgba(46,230,166,' + (0.30 + pulse * 0.2) + ')');
    g.addColorStop(1, 'rgba(46,230,166,0)');
    ctx.fillStyle = g;
    ctx.fillRect(gx - 18, top, 36, bot - top);
    ctx.shadowColor = '#2ee6a6';
    ctx.shadowBlur = 16;
    ctx.strokeStyle = '#2ee6a6';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(gx - 14, bot); ctx.lineTo(gx - 14, top + 22);
    ctx.quadraticCurveTo(gx, top - 8, gx + 14, top + 22);
    ctx.lineTo(gx + 14, bot);
    ctx.stroke();
    ctx.fillStyle = 'rgba(216,255,240,.9)';
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('GOAL', gx, top - 18);
    ctx.restore();
  }

  function draw(t) {
    /* camera */
    camX = clamp(player.x - 210, 0, Math.max(0, levelWidth() - W));
    camY = clamp(player.y - 330, 0, 340);

    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* sky over the chasm */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070e');
    g.addColorStop(0.55, '#0b1026');
    g.addColorStop(0.85, '#160b30');
    g.addColorStop(1, '#2b0f4a');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* stars (slow parallax) */
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      var sx = ((s.x - camX * 0.12) % 1600 + 1600) % 1600;
      if (sx > W + 4) continue;
      ctx.globalAlpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t / 900 + s.p));
      ctx.fillStyle = '#cfe3ff';
      ctx.beginPath();
      ctx.arc(sx, s.y - camY * 0.1, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* distant skyline sinking into the chasm */
    var so = (camX * 0.35) % 320;
    ctx.fillStyle = 'rgba(20,27,54,.9)';
    for (i = -1; i < W / 320 + 2; i++) {
      var bx = i * 320 - so;
      for (var b = 0; b < 4; b++) {
        var bw = 40 + ((b * 37) % 46);
        var bh = 90 + ((b * 61) % 130);
        ctx.fillRect(bx + b * 76, 660 - camY * 0.4 - bh, bw, bh + 80);
      }
    }

    /* chasm glow */
    var cg = ctx.createLinearGradient(0, 560 - camY * 0.7, 0, H);
    cg.addColorStop(0, 'rgba(168,85,247,0)');
    cg.addColorStop(1, 'rgba(168,85,247,.35)');
    ctx.fillStyle = cg;
    ctx.fillRect(0, 560 - camY * 0.7, W, H);

    ctx.save();
    ctx.translate(-camX, -camY);

    /* start ledge */
    ctx.fillStyle = '#101733';
    ctx.fillRect(level.start.x - 44, level.start.y + 52, 88, 16);
    ctx.strokeStyle = 'rgba(124,92,255,.8)';
    ctx.lineWidth = 2;
    ctx.strokeRect(level.start.x - 44, level.start.y + 52, 88, 16);

    /* flight trail */
    ctx.fillStyle = 'rgba(34,211,238,.5)';
    for (i = 0; i < trail.length; i++) {
      ctx.globalAlpha = 0.55 * (i / trail.length);
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 2.4, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* finish gate */
    drawGate(level.gate, t);

    /* anchors */
    for (i = 0; i < level.anchors.length; i++) {
      var a = level.anchors[i];
      drawAnchor(a[0], a[1],
        !!(attached && anchor && anchor.x === a[0] && anchor.y === a[1]), t);
    }

    /* coins */
    var taken = coinTaken[levelIdx] || [];
    for (i = 0; i < level.coins.length; i++) {
      if (taken[i]) continue;
      drawCoin(level.coins[i][0], level.coins[i][1] + Math.sin(t / 400 + i) * 5, t, i);
    }

    /* rope */
    if (attached && anchor) {
      ctx.strokeStyle = 'rgba(216,255,240,.95)';
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(player.x, player.y - 22);
      ctx.lineTo(anchor.x, anchor.y);
      ctx.stroke();
    }

    /* hero */
    drawStick(player.x, player.y - 16, heroPose(t), '#22d3ee');

    ctx.restore();

    /* on-canvas banners */
    ctx.textAlign = 'center';
    if (state === 'countdown') {
      ctx.fillStyle = 'rgba(232,238,252,.95)';
      ctx.font = 'bold 30px ' + FONT;
      ctx.fillText('LEVEL ' + (levelIdx + 1), W / 2, H * 0.36);
      ctx.fillStyle = 'rgba(34,211,238,.95)';
      ctx.font = 'bold 17px ' + FONT;
      ctx.fillText(level.name, W / 2, H * 0.36 + 30);
    } else if (state === 'cleared') {
      ctx.fillStyle = 'rgba(46,230,166,.95)';
      ctx.font = 'bold 30px ' + FONT;
      ctx.fillText('LEVEL CLEAR!', W / 2, H * 0.36);
      ctx.fillStyle = 'rgba(232,238,252,.9)';
      ctx.font = 'bold 17px ' + FONT;
      ctx.fillText('+' + lastBonus + ' points', W / 2, H * 0.36 + 30);
    } else if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px ' + FONT;
      ctx.fillText('PAUSED', W / 2, 40);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pressHook() {
    if (state === 'ready' || state === 'over') { start(); hookHeld = true; return; }
    if (state === 'paused') { resume(); hookHeld = true; return; }
    if (state === 'running' || state === 'countdown') hookHeld = true;
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === undefined || k === null) return;

    if (k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === ' ') {
      if (!hookHeld) pressHook();
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running' || state === 'countdown') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running' || state === 'countdown') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    }
  });

  document.addEventListener('keyup', function (e) {
    if (e.key === ' ') releaseHook();
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (!hookHeld) pressHook();
  });

  window.addEventListener('pointerup', releaseHook);
  window.addEventListener('pointercancel', releaseHook);

  /* on-screen touch button */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        pressHook();
      });
      btn.addEventListener('pointerup', releaseHook);
      btn.addEventListener('pointerleave', releaseHook);
      btn.addEventListener('pointercancel', releaseHook);
    })(padBtns[b]);
  }

  window.addEventListener('blur', releaseHook);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && (state === 'running' || state === 'countdown')) pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__hookHero', {
      value: Object.freeze({
        snapshot: function () {
          return {
            state: state,
            level: levelIdx,
            score: score,
            coins: coins,
            best: Math.max(best, score),
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            attached: attached,
            ropeLen: ropeLen,
            hookHeld: hookHeld,
            attempts: attempts,
            levelTime: levelTime
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  loadLevel(0);
  state = 'ready';
  updateHud(true);
  ensureLoop();
  GameShell.overlay.show({
    title: 'Hook Hero',
    msg: 'Hold Space to fire your hook at the glowing rings, swing like a pendulum, then release to fly. Cross all six stages of the neon chasm.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
