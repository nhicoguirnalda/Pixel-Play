/* ============================================================
   Hook Hero — original game for PixelPlay
   Canvas grapple-swing platformer: hold to hook the glowing
   anchor rings, swing like a pendulum and release over the
   bottomless neon chasm. Twelve hand-built stages, real pendulum
   physics, spark sentries and crosswinds, keyboard first with
   pointer + touch support.
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

  var GRAV = 1150;        /* px/s² (scaled per stage)               */
  var MAX_REACH = 540;    /* base hook range                        */
  var PULL = 118;         /* gentle forward pull while swinging     */
  var FALL_Y = 900;       /* below this is the chasm                */
  var VX_MAX = 720, VY_MAX = 950;
  var UNLOCK_KEY = 'pixelplay.hookhero.unlocked';

  /* ---------------- hand-designed levels ----------------
     anchors + coins in world coords (y grows downwards);
     each stage ends at a glowing finish gate. Later stages add
     crosswinds, shorter hook reach, stronger gravity and spark
     sentries that sweep across the flight line.              */

  var LEVELS = [
    {
      name: 'First Swing',
      start: { x: 110, y: 300 },
      anchors: [[340, 200], [760, 250], [1180, 180], [1600, 240], [2020, 190]],
      coins: [[550, 330], [960, 310], [1390, 290], [1810, 320], [2230, 280]],
      gate: 2280, par: 26,
      wind: 0, reach: 1, gravity: 1, hazards: []
    },
    {
      name: 'Wide Awake',
      start: { x: 110, y: 270 },
      anchors: [[330, 160], [740, 300], [1160, 180], [1560, 320], [1980, 200], [2380, 300]],
      coins: [[540, 330], [950, 360], [1360, 330], [1770, 360], [2180, 320]],
      gate: 2620, par: 30,
      wind: 0, reach: 1, gravity: 1, hazards: []
    },
    {
      name: 'High and Low',
      start: { x: 110, y: 300 },
      anchors: [[340, 260], [790, 150], [1220, 330], [1650, 160], [2080, 330], [2500, 190]],
      coins: [[560, 340], [1000, 320], [1430, 350], [1860, 320], [2290, 350]],
      gate: 2740, par: 32,
      wind: 14, reach: 1, gravity: 1,
      hazards: [{ x: 1880, y: 370, range: 70, speed: 0.55, phase: 0.7, r: 16 }]
    },
    {
      name: 'The Long Reach',
      start: { x: 110, y: 280 },
      anchors: [[350, 190], [820, 250], [1330, 170], [1830, 260], [2340, 180], [2790, 270]],
      coins: [[580, 320], [1070, 330], [1580, 320], [2080, 330], [2560, 330]],
      gate: 3060, par: 34,
      wind: 24, reach: 0.97, gravity: 1.02,
      hazards: [{ x: 1580, y: 380, range: 80, speed: 0.6, phase: 0.2, r: 16 }]
    },
    {
      name: 'Zig-zag Zephyr',
      start: { x: 110, y: 310 },
      anchors: [[330, 300], [720, 140], [1150, 330], [1580, 150], [2010, 330], [2440, 170]],
      coins: [[520, 360], [930, 330], [1360, 360], [1790, 330], [2220, 360]],
      gate: 2680, par: 32,
      wind: 36, reach: 0.95, gravity: 1.03,
      hazards: [{ x: 960, y: 360, range: 75, speed: 0.65, phase: 1.1, r: 16 },
                { x: 1820, y: 400, range: 85, speed: 0.7, phase: 0.4, r: 16 }]
    },
    {
      name: 'Final Flight',
      start: { x: 110, y: 290 },
      anchors: [[340, 200], [780, 320], [1240, 150], [1700, 320], [2160, 160], [2620, 320], [3080, 190]],
      coins: [[560, 340], [1010, 330], [1470, 330], [1930, 330], [2390, 330], [2850, 330]],
      gate: 3340, par: 38,
      wind: 48, reach: 0.94, gravity: 1.04,
      hazards: [{ x: 1000, y: 375, range: 85, speed: 0.7, phase: 0.9, r: 17 },
                { x: 1940, y: 350, range: 90, speed: 0.75, phase: 0.3, r: 17 }]
    },
    {
      name: 'Crosswind Alley',
      start: { x: 110, y: 300 },
      anchors: [[340, 230], [720, 150], [1100, 290], [1480, 170], [1860, 300], [2240, 180], [2580, 290]],
      coins: [[530, 330], [900, 320], [1290, 340], [1670, 320], [2050, 340], [2420, 320]],
      gate: 2800, par: 40,
      wind: 58, reach: 0.92, gravity: 1.05,
      hazards: [{ x: 1150, y: 380, range: 90, speed: 0.75, phase: 0.6, r: 17 },
                { x: 2380, y: 350, range: 90, speed: 0.8, phase: 1.5, r: 17 }]
    },
    {
      name: 'Gate Runner',
      start: { x: 110, y: 280 },
      anchors: [[330, 200], [690, 310], [1050, 160], [1410, 320], [1770, 170], [2130, 300], [2490, 160], [2850, 300]],
      coins: [[510, 330], [870, 340], [1230, 330], [1590, 340], [1950, 330], [2310, 340], [2670, 330]],
      gate: 3060, par: 42,
      wind: 64, reach: 0.91, gravity: 1.06,
      hazards: [{ x: 870, y: 365, range: 90, speed: 0.8, phase: 1.4, r: 17 },
                { x: 1950, y: 390, range: 95, speed: 0.85, phase: 0.5, r: 17 },
                { x: 2800, y: 350, range: 95, speed: 0.9, phase: 2.1, r: 17 }]
    },
    {
      name: 'Thin Air',
      start: { x: 110, y: 300 },
      anchors: [[340, 170], [700, 300], [1060, 140], [1420, 300], [1780, 150], [2140, 310], [2500, 160], [2860, 300]],
      coins: [[520, 330], [880, 340], [1240, 320], [1600, 340], [1960, 320], [2320, 340], [2680, 320]],
      gate: 3080, par: 44,
      wind: 70, reach: 0.90, gravity: 1.07,
      hazards: [{ x: 810, y: 355, range: 95, speed: 0.85, phase: 0.2, r: 18 },
                { x: 1600, y: 385, range: 100, speed: 0.9, phase: 1.0, r: 18 },
                { x: 2320, y: 345, range: 100, speed: 0.95, phase: 1.8, r: 18 }]
    },
    {
      name: 'Slipstream',
      start: { x: 110, y: 290 },
      anchors: [[330, 280], [650, 150], [980, 300], [1310, 150], [1640, 300], [1970, 150], [2300, 300], [2630, 150], [2960, 300]],
      coins: [[490, 340], [815, 330], [1145, 340], [1475, 330], [1805, 340], [2135, 330], [2465, 340], [2795, 330]],
      gate: 3180, par: 46,
      wind: 76, reach: 0.89, gravity: 1.08,
      hazards: [{ x: 800, y: 380, range: 100, speed: 0.9, phase: 0.9, r: 18 },
                { x: 1460, y: 350, range: 105, speed: 0.95, phase: 1.7, r: 18 },
                { x: 2450, y: 390, range: 105, speed: 1.0, phase: 0.3, r: 18 }]
    },
    {
      name: 'Storm Ladder',
      start: { x: 110, y: 280 },
      anchors: [[340, 160], [660, 300], [990, 150], [1320, 300], [1650, 140], [1980, 300], [2310, 150], [2640, 300], [2970, 160]],
      coins: [[500, 330], [825, 340], [1155, 320], [1485, 340], [1815, 320], [2145, 340], [2475, 320], [2805, 340]],
      gate: 3190, par: 48,
      wind: 80, reach: 0.88, gravity: 1.09,
      hazards: [{ x: 820, y: 350, range: 105, speed: 0.95, phase: 0.4, r: 18 },
                { x: 1490, y: 385, range: 105, speed: 1.0, phase: 1.3, r: 18 },
                { x: 2160, y: 340, range: 110, speed: 1.05, phase: 2.1, r: 19 },
                { x: 2800, y: 395, range: 110, speed: 1.1, phase: 0.8, r: 19 }]
    },
    {
      name: 'Last Light',
      start: { x: 110, y: 300 },
      anchors: [[330, 290], [640, 140], [950, 290], [1260, 140], [1570, 290], [1880, 140], [2190, 290], [2500, 140], [2810, 290], [3120, 150]],
      coins: [[485, 340], [795, 330], [1105, 340], [1415, 330], [1725, 340], [2035, 330], [2345, 340], [2655, 330], [2965, 340]],
      gate: 3340, par: 52,
      wind: 85, reach: 0.87, gravity: 1.10,
      hazards: [{ x: 780, y: 355, range: 110, speed: 1.0, phase: 1.1, r: 19 },
                { x: 1420, y: 330, range: 110, speed: 1.05, phase: 0.2, r: 19 },
                { x: 2060, y: 375, range: 115, speed: 1.1, phase: 1.7, r: 19 },
                { x: 2700, y: 345, range: 115, speed: 1.15, phase: 0.6, r: 19 },
                { x: 3000, y: 395, range: 120, speed: 1.2, phase: 2.2, r: 19 }]
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
  var flash = 0;              /* red pulse after a spark-gate hit */
  var windNow = 0;            /* current lateral gust, px/s²       */
  var unlocked = loadUnlocked();

  /* ---------------- unlock progress ---------------- */

  function loadUnlocked() {
    try {
      var v = parseInt(localStorage.getItem(UNLOCK_KEY), 10);
      if (!isFinite(v) || v < 0) v = 0;
      return clamp(v, 0, LEVELS.length - 1);
    } catch (e) { return 0; }
  }

  function saveUnlocked() {
    try { localStorage.setItem(UNLOCK_KEY, String(unlocked)); } catch (e) {}
  }

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function levelWidth() { return level.gate + 170; }

  /* ---------------- HUD / stages / states ---------------- */

  function updateHud(force) {
    var windKey = Math.round(windNow / 10);
    var key = state + '|' + score + '|' + coins + '|' + levelIdx + '|' +
              Math.max(best, score) + '|' + unlocked + '|' + windKey;
    if (!force && key === hudKey) return;
    hudKey = key;
    var windTxt = '';
    if (Math.abs(windNow) >= 5) {
      windTxt = ' · gust ' + (windNow > 0 ? '→ ' : '← ') + Math.round(Math.abs(windNow));
    }
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Level: (levelIdx + 1) + '/' + LEVELS.length,
        Coins: coins
      },
      state === 'paused' ? '⏸ Paused'
        : 'Hold Space = hook · release = fly' + windTxt
    );
  }

  function refreshPicker() {
    var box = document.getElementById('stagePicker');
    if (!box) return;
    var html = '<span class="stage-label">Stages</span>';
    for (var i = 0; i < LEVELS.length; i++) {
      var open = i <= unlocked;
      html += '<button type="button" class="stage-btn' + (open ? '' : ' is-locked') +
              '" data-stage="' + i + '"' + (open ? '' : ' disabled') +
              ' title="' + (open ? LEVELS[i].name : 'Clear stage ' + i + ' to unlock') + '">' +
              (i + 1) + '</button>';
    }
    box.innerHTML = html;
    var btns = box.querySelectorAll ? box.querySelectorAll('[data-stage]') : [];
    for (var b = 0; b < btns.length; b++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          var idx = parseInt(btn.getAttribute('data-stage'), 10);
          if (isFinite(idx)) startStage(idx);
        });
      })(btns[b]);
    }
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
    flash = 0;
    windNow = 0;
    if (!coinTaken[idx]) {
      coinTaken[idx] = [];
      for (var i = 0; i < level.coins.length; i++) coinTaken[idx].push(false);
    }
    updateHud(true);
  }

  function start(which) {
    score = 0; coins = 0;
    coinTaken = [];
    attempts = 0;
    loadLevel(typeof which === 'number' ? which : 0);
    state = 'countdown';
    ct = 0.9;
    hookHeld = false;
    last = now();
    GameShell.overlay.hide();
    updateHud(true);
    ensureLoop();
  }

  function startStage(idx) {
    if (idx < 0 || idx >= LEVELS.length || idx > unlocked) return;
    start(idx);
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
      msg: 'All twelve stages cleared — a true hero of the hook. Your best score is saved in this browser.',
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
    if (levelIdx + 1 < LEVELS.length && levelIdx + 1 > unlocked) {
      unlocked = levelIdx + 1;
      saveUnlocked();
      refreshPicker();
    }
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

  function hookReach() {
    return MAX_REACH * (level.reach || 1);
  }

  function nextAnchorAhead() {
    if (!level) return null;
    var best = null;
    for (var i = 0; i < level.anchors.length; i++) {
      var a = level.anchors[i];
      if (a[0] > player.x + 20 && (!best || a[0] < best[0])) best = a;
    }
    return best;
  }

  function tryAttach() {
    if (attached || !level) return false;
    var reach = hookReach();
    var pick = null, pickScore = 1e9, pickD = 0;
    for (var i = 0; i < level.anchors.length; i++) {
      var ax = level.anchors[i][0], ay = level.anchors[i][1];
      var dx = ax - player.x, dy = ay - player.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > reach || ay >= player.y + 60) continue;
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
      ropeLen = clamp(pickD, 50, reach);
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

  /* ---------------- spark sentries / wind ---------------- */

  function hazardX(h) {
    return h.x + Math.sin(levelTime * h.speed + (h.phase || 0)) * h.range;
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
    if (flash > 0) flash = Math.max(0, flash - dt * 1.5);
    windNow = (level.wind || 0) * Math.sin(levelTime * 1.15 + levelIdx * 1.7);

    if (hookHeld && !attached) tryAttach();

    player.vy += GRAV * (level.gravity || 1) * dt;
    player.vx += windNow * dt;                 /* crosswind pushes the swing */
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

    /* spark sentries: touch one and the run restarts at this stage */
    for (var g = 0; g < level.hazards.length; g++) {
      var hz = level.hazards[g];
      var hdx = hazardX(hz) - player.x, hdy = hz.y - player.y;
      var hr = hz.r + 12;
      if (hdx * hdx + hdy * hdy < hr * hr) {
        respawn();
        flash = 0.8;
        return;
      }
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

  function drawSentry(h, t) {
    var hx = hazardX(h);
    var pulse = 0.5 + 0.5 * Math.sin(t / 160 + h.phase);
    var r = h.r;

    ctx.save();
    /* faint patrol line so the sweep is readable */
    ctx.strokeStyle = 'rgba(255,92,122,.12)';
    ctx.lineWidth = 1;
    if (ctx.setLineDash) ctx.setLineDash([4, 8]);
    ctx.beginPath();
    ctx.moveTo(h.x - h.range, h.y);
    ctx.lineTo(h.x + h.range, h.y);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);

    /* glowing core */
    ctx.shadowColor = '#ff5c7a';
    ctx.shadowBlur = 18;
    ctx.fillStyle = 'rgba(255,92,122,.35)';
    ctx.beginPath();
    ctx.arc(hx, h.y, r + 4 + pulse * 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ff5c7a';
    ctx.beginPath();
    ctx.arc(hx, h.y, r, 0, TAU);
    ctx.fill();

    /* spinning spark blades */
    ctx.shadowBlur = 8;
    ctx.strokeStyle = 'rgba(255,225,232,.95)';
    ctx.lineWidth = 2;
    for (var s = 0; s < 3; s++) {
      var a = t / 180 + s * (TAU / 3) + h.phase;
      ctx.beginPath();
      ctx.moveTo(hx + Math.cos(a) * (r + 2), h.y + Math.sin(a) * (r + 2));
      ctx.lineTo(hx + Math.cos(a) * (r + 12), h.y + Math.sin(a) * (r + 12));
      ctx.stroke();
    }
    ctx.fillStyle = '#fff2f5';
    ctx.beginPath();
    ctx.arc(hx, h.y, 3.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  var windMotes = [];
  (function () {
    for (var i = 0; i < 30; i++) {
      windMotes.push({
        x: Math.random() * W,
        y: 30 + Math.random() * (H - 60),
        len: 12 + Math.random() * 30,
        sp: 30 + Math.random() * 60
      });
    }
  })();

  function drawWind(t) {
    var str = Math.abs(windNow);
    if (str < 4) return;
    var dir = windNow > 0 ? 1 : -1;
    ctx.save();
    ctx.strokeStyle = 'rgba(147,197,253,.9)';
    ctx.lineWidth = 1.2;
    for (var i = 0; i < windMotes.length; i++) {
      var m = windMotes[i];
      var x = ((m.x + dir * t * 0.001 * m.sp * (str / 40)) % W + W) % W;
      ctx.globalAlpha = 0.06 + Math.min(0.22, str / 420);
      ctx.beginPath();
      ctx.moveTo(x, m.y);
      ctx.lineTo(x + dir * (m.len + str * 0.25), m.y);
      ctx.stroke();
    }
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

    /* spark sentries: they sweep across the flight line */
    for (i = 0; i < level.hazards.length; i++) {
      drawSentry(level.hazards[i], t);
    }

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

    /* crosswind streaks + spark-gate hit flash */
    drawWind(t);
    if (flash > 0) {
      var fg = ctx.createRadialGradient(W / 2, H / 2, 80, W / 2, H / 2, H * 0.75);
      fg.addColorStop(0, 'rgba(255,92,122,0)');
      fg.addColorStop(1, 'rgba(255,92,122,' + (0.42 * flash) + ')');
      ctx.fillStyle = fg;
      ctx.fillRect(0, 0, W, H);
    }

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
          var hzs = level ? level.hazards : [];
          var nextA = nextAnchorAhead();
          var maxSpeed = 0, maxR = 0;
          for (var gi = 0; gi < hzs.length; gi++) {
            if (hzs[gi].speed > maxSpeed) maxSpeed = hzs[gi].speed;
            if (hzs[gi].r > maxR) maxR = hzs[gi].r;
          }
          return {
            state: state,
            level: levelIdx,
            levels: LEVELS.length,
            levelName: level ? level.name : '',
            progress: level ? clamp(player.x / level.gate, 0, 1) : 0,
            unlocked: unlocked + 1,
            score: score,
            coins: coins,
            best: Math.max(best, score),
            x: player.x,
            y: player.y,
            vx: player.vx,
            vy: player.vy,
            attached: attached,
            anchorX: anchor ? anchor.x : null,
            anchorY: anchor ? anchor.y : null,
            ropeLen: ropeLen,
            hookHeld: hookHeld,
            attempts: attempts,
            levelTime: levelTime,
            gateX: level ? level.gate : 0,
            nextAnchorX: nextA ? nextA[0] : null,
            nextAnchorY: nextA ? nextA[1] : null,
            nextAnchorDist: nextA
              ? Math.round(Math.sqrt(Math.pow(nextA[0] - player.x, 2) +
                                     Math.pow(nextA[1] - player.y, 2)))
              : null,
            hazardPositions: hzs.map(function (h) {
              return { x: Math.round(hazardX(h) * 10) / 10, y: h.y, r: h.r };
            }),
            difficulty: {
              hookReach: Math.round(MAX_REACH * (level ? (level.reach || 1) : 1)),
              reachFactor: level ? level.reach : 1,
              gravity: GRAV * (level ? (level.gravity || 1) : 1),
              wind: level ? (level.wind || 0) : 0,
              windNow: Math.round(windNow * 10) / 10,
              hazards: hzs.length,
              maxHazardSpeed: maxSpeed,
              maxHazardRadius: maxR,
              par: level ? level.par : 0
            }
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
  refreshPicker();
  updateHud(true);
  ensureLoop();
  GameShell.overlay.show({
    title: 'Hook Hero',
    msg: 'Hold Space to fire your hook at the glowing rings, swing like a pendulum, then release to fly. Twelve stages of crosswinds and sweeping spark sentries await — clear one to unlock the next.',
    stats: [{ label: 'Best', value: best }, { label: 'Stages', value: LEVELS.length }],
    btn: '▶ Play',
    action: start
  });
})();
