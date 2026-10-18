/* ============================================================
   Asteroid Storm — original game for PixelPlay
   Canvas arcade shooter: momentum flight, splitting asteroids,
   endless waves. Keyboard, pointer and touch buttons.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 640, H = 480;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'asteroid-storm';

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

  /* size 0 = big, 1 = medium, 2 = small (smallest breaks apart) */
  var SIZES = [
    { r: 42, pts: 20 },
    { r: 24, pts: 50 },
    { r: 12, pts: 100 }
  ];
  var COLS = ['#ef4444', '#f59e0b', '#fbbf24'];

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0, lives = 3, wave = 1;
  var best = GameShell.best.get(BEST_KEY, 0);
  var ship, roids, bullets, particles, stars;
  var keys = { left: false, right: false, up: false, down: false, fire: false };
  var waveClear = 0, shake = 0, pointerAngle = null;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function normAngle(a) {
    while (a > Math.PI) a -= TAU;
    while (a < -Math.PI) a += TAU;
    return a;
  }

  function len(x, y) { return Math.sqrt(x * x + y * y); }

  function gap(a, b) {
    var dx = a.x - b.x, dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 30 + Math.random() * 190;
      var life = 0.35 + Math.random() * 0.5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.6,
        col: col
      });
    }
    if (particles.length > 320) particles.splice(0, particles.length - 320);
  }

  function makeStars() {
    stars = [];
    for (var i = 0; i < 110; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.4 + Math.random() * 1.5,
        p: Math.random() * TAU,
        s: 0.6 + Math.random() * 1.6
      });
    }
  }

  function wrap(o, m) {
    if (o.x < -m) o.x += W + 2 * m;
    else if (o.x > W + m) o.x -= W + 2 * m;
    if (o.y < -m) o.y += H + 2 * m;
    else if (o.y > H + m) o.y -= H + 2 * m;
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Lives: lives },
      state === 'paused' ? '⏸ Paused · Wave ' + wave : 'Wave ' + wave
    );
  }

  /* ---------------- setup ---------------- */

  function makeRoid(x, y, size, speed, angle) {
    var a = (typeof angle === 'number') ? angle : Math.random() * TAU;
    var r = SIZES[size].r;
    var verts = [];
    var n = 10;
    for (var i = 0; i < n; i++) verts.push(0.74 + Math.random() * 0.4);
    var v = speed * (0.65 + Math.random() * 0.55);
    return {
      x: x, y: y, size: size, r: r,
      vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      ang: Math.random() * TAU,
      spin: (Math.random() - 0.5) * 1.8,
      verts: verts
    };
  }

  function spawnWave() {
    roids = [];
    bullets = [];
    var n = Math.min(2 + wave, 8);
    var base = 20 + wave * 6;
    for (var i = 0; i < n; i++) {
      var x, y, angle;
      if (wave === 1) {
        /* a gentle, readable opening wave: rocks drift in from above */
        var spots = [[W * 0.5, 72], [W * 0.2, 132], [W * 0.8, 152]];
        x = spots[i % 3][0];
        y = spots[i % 3][1];
        angle = Math.PI / 2 + (Math.random() - 0.5) * 1.2;
      } else {
        var side = rand(4);
        var pad = 70;
        if (side === 0) { x = pad + Math.random() * (W - pad * 2); y = -40; }
        else if (side === 1) { x = pad + Math.random() * (W - pad * 2); y = H + 40; }
        else if (side === 2) { x = -40; y = pad + Math.random() * (H - pad * 2); }
        else { x = W + 40; y = pad + Math.random() * (H - pad * 2); }
        angle = undefined;
      }
      roids.push(makeRoid(x, y, 0, base, angle));
    }
  }

  function placeShip(safe) {
    ship.x = W / 2;
    ship.y = H / 2;
    ship.vx = 0;
    ship.vy = 0;
    ship.a = -Math.PI / 2;
    ship.cool = 0;
    ship.invuln = safe ? 2.2 : 1.2;
    if (safe && roids) {
      for (var i = 0; i < roids.length; i++) {
        var tries = 0;
        while (tries < 40 && gap(ship, roids[i]) < roids[i].r + 110) {
          ship.x = 70 + Math.random() * (W - 140);
          ship.y = 70 + Math.random() * (H - 140);
          tries++;
        }
      }
    }
  }

  function reset() {
    score = 0; lives = 3; wave = 1;
    bullets = []; particles = [];
    waveClear = 0; shake = 0; pointerAngle = null;
    ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, a: -Math.PI / 2, r: 13, cool: 0, invuln: 1.6 };
    spawnWave();
  }

  /* ---------------- states ---------------- */

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
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The asteroids are on hold. Resume when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Lives', value: lives },
        { label: 'Wave', value: wave }
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

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    releaseKeys();
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Game over',
      msg: 'You cleared ' + (wave - 1) + ' wave' + (wave - 1 === 1 ? '' : 's') +
           ' and scored ' + score + ' point' + (score === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Wave', value: wave }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function releaseKeys() {
    keys.left = keys.right = keys.up = keys.down = keys.fire = false;
    pointerAngle = null;
  }

  function shoot() {
    if (bullets.length >= 5) return;
    var sp = 430;
    bullets.push({
      x: ship.x + Math.cos(ship.a) * 16,
      y: ship.y + Math.sin(ship.a) * 16,
      vx: Math.cos(ship.a) * sp + ship.vx * 0.4,
      vy: Math.sin(ship.a) * sp + ship.vy * 0.4,
      life: 1.05
    });
    ship.cool = 0.18;
  }

  function crash() {
    var isLast = lives <= 1;
    burst(ship.x, ship.y, '#fbbf24', 26);
    burst(ship.x, ship.y, '#ef4444', 18);
    shake = 20;
    lives--;
    if (isLast || lives <= 0) {
      lives = 0;
      updateHud();
      gameOver();
      return;
    }
    placeShip(true);
    updateHud();
  }

  /* ---------------- update ---------------- */

  function hitRoid(b) {
    for (var i = roids.length - 1; i >= 0; i--) {
      var r = roids[i];
      if (gap(b, r) < r.r + 4) {
        breakRoid(i);
        return true;
      }
    }
    return false;
  }

  function breakRoid(i) {
    var r = roids[i];
    score += SIZES[r.size].pts;
    burst(r.x, r.y, COLS[r.size], 12 + (2 - r.size) * 7);
    shake = Math.max(shake, 6 + r.size * 2);
    roids.splice(i, 1);
    if (r.size < 2) {
      var sp = len(r.vx, r.vy) * (1.3 + Math.random() * 0.4) + 26;
      var base = Math.atan2(r.vy, r.vx);
      for (var k = 0; k < 2; k++) {
        var a = base + (k === 0 ? 0.75 : -0.75) + (Math.random() - 0.5) * 0.5;
        roids.push(makeRoid(
          r.x + Math.cos(a) * (r.r * 0.4),
          r.y + Math.sin(a) * (r.r * 0.4),
          r.size + 1, sp, a
        ));
      }
    }
    updateHud();
  }

  function update(dt) {
    var i;

    /* --- rotation --- */
    var rot = 3.5;
    if (keys.left) ship.a -= rot * dt;
    if (keys.right) ship.a += rot * dt;
    if (pointerAngle !== null && !keys.left && !keys.right) {
      var d = normAngle(pointerAngle - ship.a);
      var stepAngle = rot * dt;
      if (Math.abs(d) <= stepAngle) ship.a = pointerAngle;
      else ship.a += d > 0 ? stepAngle : -stepAngle;
    }
    ship.a = normAngle(ship.a);

    /* --- thrust and drag --- */
    if (keys.up) {
      ship.vx += Math.cos(ship.a) * 250 * dt;
      ship.vy += Math.sin(ship.a) * 250 * dt;
    }
    var drag = Math.pow(keys.down ? 0.2 : 0.5, dt);
    ship.vx *= drag;
    ship.vy *= drag;
    var sp = len(ship.vx, ship.vy);
    if (sp > 300) { ship.vx *= 300 / sp; ship.vy *= 300 / sp; }

    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    wrap(ship, 4);

    if (ship.cool > 0) ship.cool -= dt;
    if (ship.invuln > 0) ship.invuln -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 60);
    if (keys.fire && ship.cool <= 0) shoot();

    /* --- asteroids --- */
    for (i = 0; i < roids.length; i++) {
      var r = roids[i];
      r.x += r.vx * dt;
      r.y += r.vy * dt;
      r.ang += r.spin * dt;
      wrap(r, r.r + 6);
    }

    /* --- shots (sub-stepped so nothing tunnels through a rock) --- */
    for (i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      var steps = Math.max(1, Math.ceil(len(b.vx, b.vy) * dt / 8));
      var alive = true;
      for (var s = 0; s < steps && alive; s++) {
        b.x += b.vx * dt / steps;
        b.y += b.vy * dt / steps;
        b.life -= dt / steps;
        if (hitRoid(b)) alive = false;
      }
      if (!alive || b.life <= 0 || b.x < -40 || b.x > W + 40 || b.y < -40 || b.y > H + 40) {
        bullets.splice(i, 1);
      }
    }

    /* --- ship vs asteroids --- */
    if (ship.invuln <= 0) {
      for (i = 0; i < roids.length; i++) {
        if (gap(ship, roids[i]) < roids[i].r + ship.r) {
          crash();
          if (state !== 'running') return;
          break;
        }
      }
    }

    /* --- wave progress --- */
    if (!roids.length) {
      if (waveClear <= 0) waveClear = 1.2;
      waveClear -= dt;
      if (waveClear <= 0) {
        score += 50 * wave;
        wave++;
        spawnWave();
        waveClear = 0;
        updateHud();
      }
    } else if (waveClear > 0) {
      waveClear = 0;
    }

    /* --- particles --- */
    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.965;
      p.vy *= 0.965;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function drawShip(t) {
    if (ship.invuln > 0 && Math.floor(t / 110) % 2 === 0) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(ship.a);

    if (keys.up) {
      var fl = 9 + Math.random() * 9;
      ctx.fillStyle = 'rgba(251,191,36,.85)';
      ctx.beginPath();
      ctx.moveTo(-5, 10);
      ctx.lineTo(0, 10 + fl);
      ctx.lineTo(5, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.beginPath();
      ctx.moveTo(-2.5, 10);
      ctx.lineTo(0, 15 + fl * 0.5);
      ctx.lineTo(2.5, 10);
      ctx.closePath();
      ctx.fill();
    }

    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.moveTo(15, 0);
    ctx.lineTo(-9, -9);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-9, 9);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#7c5cff';
    ctx.beginPath();
    ctx.arc(1, 0, 3.2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawRoid(r) {
    var col = COLS[r.size];
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.ang);
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = col;
    ctx.beginPath();
    var n = r.verts.length;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * TAU;
      var rad = r.r * r.verts[i];
      var px = Math.cos(a) * rad;
      var py = Math.sin(a) * rad;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.globalAlpha = 0.3;
    ctx.fillStyle = '#05070e';
    ctx.beginPath();
    ctx.arc(r.x + r.r * 0.22, r.y - r.r * 0.18, r.r * 0.3, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.35, H * 0.3, 20, W * 0.35, H * 0.3, W * 0.85);
    g.addColorStop(0, 'rgba(245,158,11,.14)');
    g.addColorStop(0.55, 'rgba(124,92,255,.07)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t / 700 * st.s + st.p));
      ctx.fillStyle = '#cfe3ff';
      ctx.beginPath();
      ctx.arc(st.x, st.y, st.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    for (i = 0; i < roids.length; i++) drawRoid(roids[i]);

    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#dffbff';
    for (i = 0; i < bullets.length; i++) {
      ctx.beginPath();
      ctx.arc(bullets[i].x, bullets[i].y, 2.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (ship) drawShip(t);

    ctx.restore();

    if (waveClear > 0 && state === 'running') {
      ctx.fillStyle = 'rgba(232,238,252,.95)';
      ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WAVE CLEAR!', W / 2, H * 0.4);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(245,158,11,.95)';
      ctx.fillText('Bigger wave incoming…', W / 2, H * 0.4 + 30);
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
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
    if (state === 'running') update(dt);
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

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' || k === 'ArrowDown' || k === ' ') {
      e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.fire = true;
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
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
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
    else if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    else if (k === ' ') keys.fire = false;
  });

  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'fire') keys.fire = true;
        else if (act === 'up') keys.up = true;
        else if (act === 'left') keys.left = true;
        else if (act === 'right') keys.right = true;
      }
      function off() {
        if (act === 'fire') keys.fire = false;
        else if (act === 'up') keys.up = false;
        else if (act === 'left') keys.left = false;
        else if (act === 'right') keys.right = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return;
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    pointerAngle = Math.atan2(y - ship.y, x - ship.x);
    shoot();
  });

  window.addEventListener('pointerup', function () { pointerAngle = null; });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  makeStars();
  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Asteroid Storm',
    msg: 'Spin with left and right, thrust with up and shoot with Space. Big rocks split in two — clear the whole field to reach the next, busier wave.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
