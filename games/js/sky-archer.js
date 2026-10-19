/* ============================================================
   Sky Archer — original game for PixelPlay
   Canvas precision archery: draw the bow, read the crosswind
   and land bullseyes on targets atop distant floating towers.
   Three rounds, quota-based progression. Keyboard + pointer.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'sky-archer';
  var FONT = '"Segoe UI", system-ui, sans-serif';
  var GRAV = 430;                 /* arrow gravity, px/s² */
  var WIND_K = 7;                 /* wind numeric → px/s² */
  var DRAW_TIME = 0.9;            /* seconds for a full 0→100 draw */
  var ARROWS_PER_ROUND = 8;
  var ARCHER = { x: 70, feet: 546, shX: 76, shY: 494 };

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

  var ROUNDS = [
    { quota: 300, windMax: 4 },
    { quota: 450, windMax: 7 },
    { quota: 600, windMax: 11 }
  ];

  /* floating towers: x / platform top / distance multiplier */
  var TOWERS = [
    { x: 250, top: 396, mult: 1 },
    { x: 340, top: 340, mult: 1.5 },
    { x: 432, top: 292, mult: 1.5 },
    { x: 522, top: 236, mult: 2 },
    { x: 300, top: 254, mult: 1.5 },
    { x: 470, top: 388, mult: 1.5 }
  ];
  var POOLS = [[0, 4, 1], [1, 2, 5, 4], [0, 1, 2, 3, 4, 5]];

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over | won */
  var score = 0, round = 1;
  var arrows = 0, roundScore = 0;
  var shots = 0, hits = 0, bullseyes = 0, streak = 0, bestStreak = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var wind = 0;
  var power = 0, drawing = false;
  var cross = { x: 400, y: 300 };
  var aimA = -0.6;
  var flight = [], targets = [], stars = [], clouds = [];
  var keys = { up: false, down: false, left: false, right: false };
  var banner = null;              /* { title, sub, t, t0 } */
  var pops = [], particles = [];
  var tGlobal = 0, rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function quota() { return ROUNDS[round - 1].quota; }

  function accuracy() { return shots ? Math.round((hits / shots) * 100) : 0; }

  function addScore(n) {
    score += n;
    updateHud();
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Round: round, Arrows: arrows },
      state === 'paused' ? '⏸ Paused · Round ' + round : 'Hold = draw · watch the wind'
    );
  }

  function pop(x, y, txt, col, size) {
    pops.push({ x: x, y: y, txt: txt, col: col, size: size || 15, t: 0, life: 1 });
    if (pops.length > 24) pops.shift();
  }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 40 + Math.random() * 150;
      var life = 0.3 + Math.random() * 0.4;
      particles.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life, size: 2 + Math.random() * 2.5, col: col
      });
    }
    if (particles.length > 240) particles.splice(0, particles.length - 240);
  }

  function makeSky() {
    stars = [];
    for (var i = 0; i < 70; i++) {
      stars.push({
        x: Math.random() * W, y: Math.random() * H * 0.7,
        r: 0.5 + Math.random() * 1.4, p: Math.random() * TAU
      });
    }
    clouds = [];
    for (i = 0; i < 5; i++) {
      clouds.push({
        x: Math.random() * W, y: 380 + Math.random() * 170,
        s: 34 + Math.random() * 44, sp: 3 + Math.random() * 5
      });
    }
  }

  /* segment-to-circle test so fast arrows never tunnel through a target */
  function segCircle(x1, y1, x2, y2, cx, cy, r) {
    var dx = x2 - x1, dy = y2 - y1;
    var fx = x1 - cx, fy = y1 - cy;
    var a = dx * dx + dy * dy;
    if (a === 0) return (fx * fx + fy * fy) <= r * r;
    var t = -((fx * dx + fy * dy) / a);
    t = t < 0 ? 0 : (t > 1 ? 1 : t);
    var px = x1 + dx * t - cx, py = y1 + dy * t - cy;
    return (px * px + py * py) <= r * r;
  }

  /* ---------------- rounds / targets ---------------- */

  function towerRadius(tower) {
    return Math.round(36 - ((tower.x - 250) / 272) * 9);
  }

  function placeTarget(towerIdx, type) {
    var tw = TOWERS[towerIdx];
    var r = towerRadius(tw);
    return {
      tw: towerIdx, x: tw.x, r: r, mult: tw.mult, type: type,
      y: tw.top - r - 14,
      down: false, downT: 0, fall: 0, stuck: []
    };
  }

  function makeTargets() {
    var pool = POOLS[round - 1].slice();
    for (var i = pool.length - 1; i > 0; i--) {
      var j = rand(i + 1);
      var tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }
    var count = round === 1 ? 3 : 4;
    if (count > pool.length) count = pool.length;
    var out = [];
    for (i = 0; i < count; i++) {
      var type = round === 1 ? (rand(2) === 0 ? 0 : 2) : (round === 2 ? 1 : rand(3));
      out.push(placeTarget(pool[i], type));
    }
    return out;
  }

  function respawnTarget(t) {
    var pool = POOLS[round - 1];
    var taken = {};
    for (var i = 0; i < targets.length; i++) {
      if (targets[i] !== t) taken[targets[i].tw] = true;
    }
    var free = [];
    for (i = 0; i < pool.length; i++) if (!taken[pool[i]]) free.push(pool[i]);
    if (!free.length) free = pool.slice();
    var twIdx = free[rand(free.length)];
    var type = round === 1 ? (rand(2) === 0 ? 0 : 2) : (round === 2 ? 1 : rand(3));
    var nt = placeTarget(twIdx, type);
    t.tw = nt.tw; t.x = nt.x; t.r = nt.r; t.mult = nt.mult; t.y = nt.y;
    t.type = nt.type;
    t.down = false; t.downT = 0; t.fall = 0; t.stuck = [];
  }

  function newWind() {
    var maxW = ROUNDS[round - 1].windMax;
    var w = wind;
    for (var i = 0; i < 12 && Math.abs(w - wind) < 1.2; i++) {
      w = Math.round(((Math.random() * 2 - 1) * maxW) * 10) / 10;
    }
    return w;
  }

  function beginRound(n) {
    round = n;
    arrows = ARROWS_PER_ROUND;
    roundScore = 0;
    wind = newWind();
    targets = makeTargets();
    drawing = false;
    power = 0;
    banner = { title: 'ROUND ' + n, sub: 'Quota ' + quota() + ' points · ' + arrows + ' arrows', t: 1.8, t0: 1.8 };
    updateHud();
  }

  function reset() {
    score = 0; shots = 0; hits = 0; bullseyes = 0;
    streak = 0; bestStreak = 0;
    flight = []; pops = []; particles = [];
    cross.x = 400; cross.y = 300;
    keys.up = keys.down = keys.left = keys.right = false;
    beginRound(1);
  }

  /* ---------------- bow / arrows ---------------- */

  function beginDraw() {
    if (state !== 'running' || drawing) return false;
    if (banner || arrows <= 0) return false;
    drawing = true;
    power = 0;
    return true;
  }

  function cancelDraw() {
    drawing = false;
    power = 0;
  }

  function loose() {
    if (!drawing) return false;
    if (state !== 'running') { cancelDraw(); return false; }
    drawing = false;
    var p = power;
    power = 0;
    /* hip-fire spread: big at low draw, tight at full draw */
    var jitter = 0.045 + 0.3 * (1 - p / 100);
    var ang = aimA + (Math.random() - 0.5) * 2 * jitter;
    var speed = 380 + p * 4.2;
    flight.push({
      x: ARCHER.shX + Math.cos(ang) * 34,
      y: ARCHER.shY + Math.sin(ang) * 34,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      ang: ang
    });
    arrows--;
    shots++;
    burst(ARCHER.shX + Math.cos(ang) * 40, ARCHER.shY + Math.sin(ang) * 40, '#e8eefc', 4);
    updateHud();
    return true;
  }

  function scoreHit(t, px, py, ang) {
    var dx = px - t.x, dy = py - t.y;
    var d = Math.sqrt(dx * dx + dy * dy);
    var pts, ring;
    if (d <= t.r * 0.3) { pts = 100; ring = 'BULLSEYE'; }
    else if (d <= t.r * 0.66) { pts = 50; ring = 'BODY'; }
    else { pts = 25; ring = 'OUTER'; }

    var gained = Math.round(pts * t.mult);
    hits++;
    if (ring === 'BULLSEYE') {
      streak++;
      bullseyes++;
      if (streak > bestStreak) bestStreak = streak;
      gained += (streak - 1) * 25;
    } else {
      streak = 0;
    }
    addScore(gained);
    roundScore += gained;

    pop(t.x, t.y - t.r - 14, ring + ' +' + gained,
        ring === 'BULLSEYE' ? '#ffd166' : (ring === 'BODY' ? '#22d3ee' : '#e8eefc'),
        ring === 'BULLSEYE' ? 17 : 14);
    if (ring === 'BULLSEYE' && streak >= 2) {
      pop(t.x, t.y - t.r - 34, 'STREAK ×' + streak, '#f59e0b', 14);
    }
    burst(t.x, t.y, ring === 'BULLSEYE' ? '#ffd166' : '#22d3ee', 14);

    /* stick the arrow into the board */
    var lim = t.r * 0.9;
    var od = Math.sqrt(dx * dx + dy * dy) || 1;
    var k = od > lim ? lim / od : 1;
    t.stuck.push({ dx: dx * k, dy: dy * k, ang: ang });
    t.down = true;
    t.downT = 0;
    t.fall = 0;

    if (roundScore >= quota()) roundClear();
  }

  function missShot(x, y) {
    streak = 0;
    pop(clamp(x, 60, W - 60), clamp(y, 60, H - 60), 'MISS', '#93a3c2', 14);
    burst(clamp(x, 40, W - 40), clamp(y, 40, H - 40), '#93a3c2', 6);
  }

  /* ---------------- rounds / end states ---------------- */

  function roundClear() {
    var bonus = 50 * round;
    addScore(bonus);
    if (round >= ROUNDS.length) { win(); return; }
    pop(W / 2, 150, 'ROUND CLEAR +' + bonus, '#2ee6a6', 18);
    beginRound(round + 1);
  }

  function start() {
    reset();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    releaseKeys();
    cancelDraw();
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The wind will keep. Resume whenever you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Round', value: round },
        { label: 'Arrows', value: arrows }
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

  function saveBest() {
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    return isBest;
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    releaseKeys();
    cancelDraw();
    var isBest = saveBest();
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Round lost',
      msg: 'Round ' + round + ' needed ' + quota() + ' points but your ' +
           ARROWS_PER_ROUND + ' arrows scored ' + roundScore +
           '. Steady full draws beat quick shots.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Round', value: round },
        { label: 'Accuracy', value: accuracy() + '%' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function win() {
    if (state === 'won') return;
    state = 'won';
    releaseKeys();
    cancelDraw();
    var isBest = saveBest();
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'All rounds cleared!',
      msg: 'You beat all three rounds with ' + shots + ' arrows, ' + hits +
           ' hits and a best streak of ' + bestStreak + ' bullseyes.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Rounds', value: ROUNDS.length + '/' + ROUNDS.length },
        { label: 'Accuracy', value: accuracy() + '%' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function releaseKeys() {
    keys.up = keys.down = keys.left = keys.right = false;
  }

  /* ---------------- update ---------------- */

  function updateAim() {
    var ax = cross.x - ARCHER.shX;
    var ay = cross.y - ARCHER.shY;
    var a = Math.atan2(ay, ax);
    aimA = clamp(a, -1.45, 0.35);
  }

  function update(dt) {
    var i, j;
    tGlobal += dt;

    /* keyboard aim */
    var mx = 0, my = 0;
    if (keys.left) mx -= 1;
    if (keys.right) mx += 1;
    if (keys.up) my -= 1;
    if (keys.down) my += 1;
    if (mx || my) {
      var len = Math.sqrt(mx * mx + my * my);
      cross.x = clamp(cross.x + (mx / len) * 330 * dt, 24, W - 24);
      cross.y = clamp(cross.y + (my / len) * 330 * dt, 30, H - 30);
    }
    updateAim();

    /* draw power */
    if (drawing) {
      power = Math.min(100, power + (dt / DRAW_TIME) * 100);
    }

    /* arrows in flight */
    for (i = flight.length - 1; i >= 0; i--) {
      var a = flight[i];
      var px = a.x, py = a.y;
      a.vy += GRAV * dt;
      a.vx += wind * WIND_K * dt;
      var nx = a.x + a.vx * dt;
      var ny = a.y + a.vy * dt;
      var done = false;

      for (j = 0; j < targets.length; j++) {
        var t = targets[j];
        if (t.down) continue;
        if (segCircle(px, py, nx, ny, t.x, t.y, t.r)) {
          flight.splice(i, 1);
          scoreHit(t, nx, ny, Math.atan2(a.vy, a.vx));
          done = true;
          break;
        }
      }
      if (done) {
        if (state !== 'running') return;
        continue;
      }

      a.x = nx; a.y = ny;
      a.ang = Math.atan2(a.vy, a.vx);
      if (!isFinite(a.x) || !isFinite(a.y)) { flight.splice(i, 1); missShot(cross.x, cross.y); continue; }
      if (a.x > W + 30 || a.x < -30 || a.y > H + 30) {
        flight.splice(i, 1);
        missShot(a.x, a.y);
      }
    }

    /* targets: toppled, then respawn elsewhere on the range */
    for (i = 0; i < targets.length; i++) {
      var tg = targets[i];
      if (tg.down) {
        tg.downT += dt;
        tg.fall = Math.min(1.45, tg.downT * 3.4);
        if (tg.downT >= 0.95) respawnTarget(tg);
      }
    }

    /* particles + pops */
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 220 * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) {
      var q = pops[i];
      q.t += dt;
      q.y -= 30 * dt;
      if (q.t >= q.life) pops.splice(i, 1);
    }

    if (banner) {
      banner.t -= dt;
      if (banner.t <= 0) banner = null;
    }

    /* arrows spent and nothing flying → the quota decides */
    if (state === 'running' && arrows === 0 && flight.length === 0 &&
        !banner && roundScore < quota()) {
      gameOver();
    }
  }

  /* ---------------- drawing ---------------- */

  function drawSky() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f26');
    g.addColorStop(0.55, '#141b3d');
    g.addColorStop(1, '#1d1440');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* moon */
    ctx.fillStyle = 'rgba(255,241,200,.16)';
    ctx.beginPath();
    ctx.arc(514, 82, 44, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f7ecc8';
    ctx.beginPath();
    ctx.arc(514, 82, 26, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#0a0f26';
    ctx.beginPath();
    ctx.arc(524, 75, 23, 0, TAU);
    ctx.fill();

    /* stars */
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(tGlobal * 1.4 + s.p));
      ctx.fillStyle = '#dfe8ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    /* drifting clouds */
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      c.x += c.sp * 0.016;
      if (c.x - c.s * 2 > W) c.x = -c.s * 2;
      ctx.fillStyle = 'rgba(148,163,204,.10)';
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.s, c.s * 0.36, 0, 0, TAU);
      ctx.ellipse(c.x + c.s * 0.7, c.y + 6, c.s * 0.7, c.s * 0.28, 0, 0, TAU);
      ctx.ellipse(c.x - c.s * 0.7, c.y + 8, c.s * 0.6, c.s * 0.25, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawTower(tw) {
    var x = tw.x, top = tw.top, half = 34;
    ctx.fillStyle = '#232c4e';
    ctx.strokeStyle = 'rgba(124,92,255,.55)';
    ctx.lineWidth = 2;

    /* floating island body */
    ctx.beginPath();
    ctx.moveTo(x - half, top);
    ctx.lineTo(x + half, top);
    ctx.lineTo(x + half, top + 14);
    ctx.lineTo(x + 18, top + 120);
    ctx.lineTo(x, top + 152);
    ctx.lineTo(x - 18, top + 120);
    ctx.lineTo(x - half, top + 14);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    /* platform slab */
    ctx.fillStyle = '#2e3a66';
    ctx.fillRect(x - half - 8, top - 10, (half + 8) * 2, 12);
    ctx.strokeStyle = 'rgba(34,211,238,.65)';
    ctx.strokeRect(x - half - 8, top - 10, (half + 8) * 2, 12);

    /* masonry lines */
    ctx.strokeStyle = 'rgba(148,163,204,.18)';
    ctx.lineWidth = 1;
    for (var i = 1; i < 4; i++) {
      ctx.beginPath();
      ctx.moveTo(x - half + i * 8, top + 14);
      ctx.lineTo(x + half - i * 6, top + 14 + i * 26);
      ctx.stroke();
    }

    /* cloud under the tip */
    ctx.fillStyle = 'rgba(148,163,204,.16)';
    ctx.beginPath();
    ctx.ellipse(x, top + 172, 46, 13, 0, 0, TAU);
    ctx.fill();
  }

  function drawTarget(t) {
    var baseY = t.y + t.r + 14;        /* pivot: pole foot on the platform */
    ctx.save();
    ctx.translate(t.x, baseY);
    ctx.rotate(t.fall);
    ctx.translate(-t.x, -baseY);

    /* pole */
    ctx.strokeStyle = '#8a6b45';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(t.x, t.y + t.r);
    ctx.lineTo(t.x, baseY);
    ctx.stroke();

    var R = t.r;
    var outer = '#c98a45', mid = '#8a5a2b';
    if (t.type === 1) { outer = '#8fa0b8'; mid = '#5b6b84'; }
    else if (t.type === 2) { outer = '#dbe4f5'; mid = '#b9c6dd'; }

    ctx.fillStyle = outer;
    ctx.beginPath();
    ctx.arc(t.x, t.y, R, 0, TAU);
    ctx.fill();
    ctx.fillStyle = mid;
    ctx.beginPath();
    ctx.arc(t.x, t.y, R * 0.66, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#ffd166';
    ctx.beginPath();
    ctx.arc(t.x, t.y, R * 0.3, 0, TAU);
    ctx.fill();

    ctx.strokeStyle = 'rgba(255,255,255,.65)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(t.x, t.y, R, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(t.x, t.y, R * 0.66, 0, TAU);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(10,15,30,.6)';
    ctx.lineWidth = 2;

    if (t.type === 0) {
      /* training dummy: stubby arms and a grain mark */
      ctx.beginPath();
      ctx.moveTo(t.x - R, t.y - 6);
      ctx.lineTo(t.x - R - 14, t.y + 8);
      ctx.moveTo(t.x + R, t.y - 6);
      ctx.lineTo(t.x + R + 14, t.y + 8);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(t.x, t.y, R * 0.48, 0.6, 2.4);
      ctx.stroke();
    } else if (t.type === 1) {
      /* clockwork stand-in: antenna + eyes */
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - R);
      ctx.lineTo(t.x, t.y - R - 12);
      ctx.stroke();
      ctx.fillStyle = Math.floor(tGlobal * 4) % 2 === 0 ? '#2ee6a6' : '#ff5c7a';
      ctx.beginPath();
      ctx.arc(t.x, t.y - R - 15, 3.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#10182e';
      ctx.beginPath();
      ctx.arc(t.x - 7, t.y - 4, 3, 0, TAU);
      ctx.arc(t.x + 7, t.y - 4, 3, 0, TAU);
      ctx.fill();
    } else {
      /* painted stick-figure silhouette target */
      ctx.strokeStyle = '#39435c';
      ctx.beginPath();
      ctx.arc(t.x, t.y - R * 0.34, R * 0.2, 0, TAU);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(t.x, t.y - R * 0.14);
      ctx.lineTo(t.x, t.y + R * 0.42);
      ctx.moveTo(t.x, t.y - R * 0.02);
      ctx.lineTo(t.x - R * 0.42, t.y + R * 0.2);
      ctx.moveTo(t.x, t.y - R * 0.02);
      ctx.lineTo(t.x + R * 0.42, t.y + R * 0.2);
      ctx.moveTo(t.x, t.y + R * 0.42);
      ctx.lineTo(t.x - R * 0.32, t.y + R * 0.86);
      ctx.moveTo(t.x, t.y + R * 0.42);
      ctx.lineTo(t.x + R * 0.32, t.y + R * 0.86);
      ctx.stroke();
    }

    /* arrows already stuck in the board */
    for (var i = 0; i < t.stuck.length; i++) {
      drawArrow(t.x + t.stuck[i].dx, t.y + t.stuck[i].dy, t.stuck[i].ang, 0.9);
    }
    ctx.restore();
  }

  function drawArrow(x, y, ang, scale) {
    var s = scale || 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(ang);
    ctx.strokeStyle = '#e8d9b8';
    ctx.lineWidth = 2.4 * s;
    ctx.beginPath();
    ctx.moveTo(-17 * s, 0);
    ctx.lineTo(3 * s, 0);
    ctx.stroke();
    /* head */
    ctx.fillStyle = '#cfd8e8';
    ctx.beginPath();
    ctx.moveTo(7 * s, 0);
    ctx.lineTo(1 * s, -3.4 * s);
    ctx.lineTo(1 * s, 3.4 * s);
    ctx.closePath();
    ctx.fill();
    /* fletching */
    ctx.strokeStyle = '#ff5c7a';
    ctx.lineWidth = 2 * s;
    ctx.beginPath();
    ctx.moveTo(-17 * s, 0);
    ctx.lineTo(-13 * s, -3.6 * s);
    ctx.moveTo(-17 * s, 0);
    ctx.lineTo(-13 * s, 3.6 * s);
    ctx.stroke();
    ctx.restore();
  }

  function drawArcher() {
    var shX = ARCHER.shX, shY = ARCHER.shY;
    var hipX = ARCHER.x, hipY = shY + 26;
    var headX = shX + 4, headY = shY - 14;

    /* stance legs */
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#22d3ee';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX + 20, ARCHER.feet);
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(hipX - 14, ARCHER.feet);
    ctx.stroke();

    /* torso + head */
    ctx.lineWidth = 3.9;
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(hipX, hipY);
    ctx.stroke();
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(headX, headY, 8.5, 0, TAU);
    ctx.stroke();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(headX + 4, headY - 1, 1.5, 0, TAU);
    ctx.fill();

    /* bow hand + drawing hand */
    var pull = 4 + (drawing ? power : 0) * 0.16;
    var bx = shX + Math.cos(aimA) * 30;
    var by = shY + Math.sin(aimA) * 30;
    var nx = shX + Math.cos(aimA) * (30 - pull);
    var ny = shY + Math.sin(aimA) * (30 - pull);

    ctx.strokeStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(shX, shY);
    ctx.lineTo(nx, ny);
    ctx.stroke();

    /* the bow itself: arc + string + nocked arrow */
    var R = 30, span = 1.1;
    var t1x = bx + Math.cos(aimA - span) * R, t1y = by + Math.sin(aimA - span) * R;
    var t2x = bx + Math.cos(aimA + span) * R, t2y = by + Math.sin(aimA + span) * R;
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.arc(bx, by, R, aimA - span, aimA + span);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(232,238,252,.85)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(t1x, t1y);
    ctx.lineTo(nx, ny);
    ctx.lineTo(t2x, t2y);
    ctx.stroke();
    if (drawing) {
      drawArrow(nx, ny, aimA, 1);
    }
  }

  function drawCrosshair() {
    var pulse = 1 + Math.sin(tGlobal * 5) * 0.07;
    var col = drawing ? '#f59e0b' : '#22d3ee';
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cross.x, cross.y, 11 * pulse, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(cross.x - 17, cross.y);
    ctx.lineTo(cross.x - 5, cross.y);
    ctx.moveTo(cross.x + 5, cross.y);
    ctx.lineTo(cross.x + 17, cross.y);
    ctx.moveTo(cross.x, cross.y - 17);
    ctx.lineTo(cross.x, cross.y - 5);
    ctx.moveTo(cross.x, cross.y + 5);
    ctx.lineTo(cross.x, cross.y + 17);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(cross.x, cross.y, 2, 0, TAU);
    ctx.fill();
  }

  function drawTrajectory() {
    var speed = 380 + power * 4.2;
    var px = ARCHER.shX + Math.cos(aimA) * 34;
    var py = ARCHER.shY + Math.sin(aimA) * 34;
    var vx = Math.cos(aimA) * speed, vy = Math.sin(aimA) * speed;
    var dt = 0.03;
    ctx.fillStyle = 'rgba(232,238,252,.4)';
    for (var i = 0; i < 26; i++) {
      vy += GRAV * dt;
      vx += wind * WIND_K * dt;
      px += vx * dt;
      py += vy * dt;
      if (px > W || py > H || py < 0) break;
      if (i % 2 === 0) {
        ctx.globalAlpha = Math.max(0.08, 0.5 - i * 0.018);
        ctx.beginPath();
        ctx.arc(px, py, 2.4, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  function drawPanels() {
    /* quota / accuracy panel, top-centre */
    var qw = 230, qx = W / 2 - qw / 2, qy = 12;
    ctx.fillStyle = 'rgba(5,7,14,.72)';
    ctx.fillRect(qx, qy, qw, 46);
    ctx.strokeStyle = 'rgba(124,92,255,.45)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(qx + 0.5, qy + 0.5, qw - 1, 45);
    ctx.fillStyle = '#e8eefc';
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.fillText('ROUND ' + round + '  ' + roundScore + ' / ' + quota(), qx + 10, qy + 18);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#93a3c2';
    ctx.fillText('ACC ' + accuracy() + '%  ·  STREAK ' + streak, qx + qw - 10, qy + 18);
    /* progress bar */
    var frac = Math.min(1, roundScore / quota());
    ctx.fillStyle = '#1c2740';
    ctx.fillRect(qx + 10, qy + 26, qw - 20, 10);
    ctx.fillStyle = frac >= 1 ? '#2ee6a6' : '#22d3ee';
    ctx.fillRect(qx + 10, qy + 26, (qw - 20) * frac, 10);

    /* wind vane, top-right */
    var ww = 124, wx = W - ww - 14, wy = 12;
    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(5,7,14,.72)';
    ctx.fillRect(wx, wy, ww, 46);
    ctx.strokeStyle = 'rgba(34,211,238,.45)';
    ctx.strokeRect(wx + 0.5, wy + 0.5, ww - 1, 45);
    ctx.fillStyle = '#93a3c2';
    ctx.font = '700 11px ' + FONT;
    ctx.fillText('WIND', wx + 10, wy + 16);

    /* vane arrow */
    var maxW = ROUNDS[round - 1].windMax;
    var dir = wind >= 0 ? 1 : -1;
    var len = 16 + (Math.abs(wind) / maxW) * 34;
    var cxm = wx + 44, cym = wy + 34;
    ctx.strokeStyle = '#7c5cff';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(cxm - (dir * len) / 2, cym);
    ctx.lineTo(cxm + (dir * len) / 2, cym);
    ctx.stroke();
    ctx.fillStyle = '#7c5cff';
    var tip = cxm + (dir * len) / 2;
    ctx.beginPath();
    ctx.moveTo(tip, cym);
    ctx.lineTo(tip - dir * 7, cym - 4.5);
    ctx.lineTo(tip - dir * 7, cym + 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8eefc';
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'right';
    ctx.fillText((wind >= 0 ? '+' : '') + wind.toFixed(1), wx + ww - 8, wy + 39);
    ctx.textAlign = 'left';

    /* draw power bar by the archer */
    var px = 20, py = 566, pw = 170, ph = 13;
    ctx.fillStyle = 'rgba(5,7,14,.7)';
    ctx.fillRect(px - 4, py - 18, pw + 8, ph + 24);
    ctx.fillStyle = '#93a3c2';
    ctx.font = '700 11px ' + FONT;
    ctx.fillText(drawing ? 'DRAW ' + Math.round(power) + '%' : 'HOLD TO DRAW', px, py - 6);
    ctx.fillStyle = '#1c2740';
    ctx.fillRect(px, py, pw, ph);
    ctx.fillStyle = power >= 100 ? '#2ee6a6' : '#f59e0b';
    ctx.fillRect(px, py, (pw * power) / 100, ph);
    ctx.strokeStyle = 'rgba(232,238,252,.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(px - 0.5, py - 0.5, pw + 1, ph + 1);
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawSky();

    var i;
    for (i = 0; i < TOWERS.length; i++) drawTower(TOWERS[i]);
    for (i = 0; i < targets.length; i++) drawTarget(targets[i]);

    /* the cliff the archer stands on */
    ctx.fillStyle = '#1a2140';
    ctx.strokeStyle = 'rgba(34,211,238,.55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, ARCHER.feet + 6);
    ctx.lineTo(150, ARCHER.feet + 6);
    ctx.lineTo(132, ARCHER.feet + 34);
    ctx.lineTo(150, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (state === 'ready' || state === 'over' || state === 'won') updateAim();
    drawArcher();

    /* arrows in flight */
    for (i = 0; i < flight.length; i++) {
      drawArrow(flight[i].x, flight[i].y, flight[i].ang, 1);
    }

    if (drawing && state === 'running') drawTrajectory();
    drawCrosshair();
    drawPanels();

    /* particles + floating texts */
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.life0);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (i = 0; i < pops.length; i++) {
      var q = pops[i];
      ctx.globalAlpha = Math.max(0, 1 - q.t / q.life);
      ctx.fillStyle = q.col;
      ctx.font = '800 ' + q.size + 'px ' + FONT;
      ctx.fillText(q.txt, q.x, q.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';

    if (banner) {
      var a2 = Math.min(1, banner.t / 0.4, (banner.t0 - banner.t) / 0.2 + 0.25);
      ctx.globalAlpha = Math.max(0, Math.min(1, a2));
      ctx.fillStyle = 'rgba(5,7,14,.74)';
      ctx.fillRect(0, H * 0.36, W, 92);
      ctx.textAlign = 'center';
      ctx.fillStyle = '#e8eefc';
      ctx.font = '800 36px ' + FONT;
      ctx.fillText(banner.title, W / 2, H * 0.36 + 48);
      ctx.fillStyle = '#22d3ee';
      ctx.font = '600 16px ' + FONT;
      ctx.fillText(banner.sub, W / 2, H * 0.36 + 76);
      ctx.globalAlpha = 1;
      ctx.textAlign = 'left';
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 22px ' + FONT;
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, 34);
      ctx.textAlign = 'left';
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pointerPos(ev) {
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    if (!isFinite(x) || !isFinite(y)) return null;
    return { x: clamp(x, 24, W - 24), y: clamp(y, 30, H - 30) };
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === undefined || k === null) return;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    else if (k === ' ') {
      if (state === 'ready' || state === 'over' || state === 'won') start();
      else if (state === 'paused') resume();
      else if (state === 'running' && !e.repeat) beginDraw();
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over' || state === 'won') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === undefined || k === null) return;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    else if (k === ' ') loose();
  });

  /* pointer aiming + draw/loose */
  canvas.addEventListener('pointermove', function (ev) {
    var p = pointerPos(ev);
    if (p) cross = p;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (state === 'ready' || state === 'over' || state === 'won') { start(); return; }
    if (state !== 'running') return;
    var p = pointerPos(ev);
    if (p) cross = p;
    beginDraw();
  });

  window.addEventListener('pointerup', function () {
    if (drawing) loose();
  });

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over' || state === 'won') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'left') keys.left = true;
        else if (act === 'right') keys.right = true;
        else if (act === 'up') keys.up = true;
        else if (act === 'down') keys.down = true;
        else if (act === 'draw') beginDraw();
      }
      function off() {
        if (act === 'left') keys.left = false;
        else if (act === 'right') keys.right = false;
        else if (act === 'up') keys.up = false;
        else if (act === 'down') keys.down = false;
        else if (act === 'draw') { if (drawing) loose(); }
      }
      btn.addEventListener('pointerdown', function (ev) { if (ev.preventDefault) ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  window.addEventListener('blur', function () {
    releaseKeys();
    cancelDraw();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__skyArcher', {
      value: Object.freeze({
        snapshot: function () {
          var list = [];
          for (var i = 0; i < targets.length; i++) {
            list.push({
              x: targets[i].x, y: targets[i].y, r: targets[i].r,
              mult: targets[i].mult, down: targets[i].down
            });
          }
          return {
            state: state,
            score: score,
            best: Math.max(best, score),
            round: round,
            quota: quota(),
            arrows: arrows,
            roundScore: roundScore,
            shots: shots,
            hits: hits,
            accuracy: accuracy(),
            wind: wind,
            power: power,
            drawing: drawing,
            inFlight: flight.length,
            streak: streak,
            banner: !!banner,
            cross: { x: Math.round(cross.x), y: Math.round(cross.y) },
            targets: list
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  makeSky();
  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Sky Archer',
    msg: 'Aim with the mouse, hold to draw the bow and loose at the targets atop the floating towers. Watch the wind vane — it changes every round. Press Space or Play to begin.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
