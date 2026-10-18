/* ============================================================
   Space Blaster — original game for PixelPlay
   Canvas arcade shooter: hold the last line, blast alien waves.
   Keyboard, pointer and on-screen touch buttons.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'space-blaster';

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

  var PALETTE = ['#7c5cff', '#22d3ee', '#2ee6a6', '#f59e0b', '#ff5c7a'];

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0, lives = 3, wave = 1;
  var best = GameShell.best.get(BEST_KEY, 0);
  var player, bullets, ebullets, enemies, particles, stars;
  var form = { x: 0, y: 0, dir: 1, speed: 30, drop: 8 };
  var keys = { left: false, right: false, up: false, down: false, fire: false };
  var fireCool = 0, invuln = 0, enemyFire = 0, waveClear = 0, shake = 0;
  var pointerTarget = null;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 40 + Math.random() * 210;
      var life = 0.35 + Math.random() * 0.45;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.4,
        col: col
      });
    }
    if (particles.length > 320) particles.splice(0, particles.length - 320);
  }

  function makeStars() {
    stars = [];
    for (var i = 0; i < 90; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 0.4 + Math.random() * 1.5,
        p: Math.random() * TAU,
        s: 0.6 + Math.random() * 1.6
      });
    }
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Lives: lives },
      state === 'paused' ? '⏸ Paused · Wave ' + wave : 'Wave ' + wave
    );
  }

  /* ---------------- setup ---------------- */

  function spawnWave() {
    enemies = [];
    ebullets = [];
    var rows = Math.min(3 + Math.floor((wave - 1) / 2), 5);
    var cols = 7, gapX = 62, gapY = 44;
    var sx = (W - (cols - 1) * gapX) / 2;
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        enemies.push({
          bx: sx + c * gapX, by: 74 + r * gapY,
          w: 34, h: 26, hp: 1, hit: 0,
          col: PALETTE[r % PALETTE.length]
        });
      }
    }
    form.x = 0; form.y = 0; form.dir = 1;
    form.speed = 28 + wave * 9;
    form.drop = 7 + wave * 2.2;
    enemyFire = 1.4;
  }

  function reset() {
    score = 0; lives = 3; wave = 1;
    bullets = []; ebullets = []; particles = [];
    fireCool = 0; invuln = 1.4; waveClear = 0; shake = 0;
    pointerTarget = null;
    player = { x: W / 2, y: H - 54, speed: 330 };
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
      msg: 'The last line is holding. Take your time.',
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
      msg: 'You held the line for ' + wave + ' wave' + (wave === 1 ? '' : 's') +
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

  function hurt(x, y) {
    if (state !== 'running' || invuln > 0) return;
    lives--;
    invuln = 1.8;
    shake = 16;
    burst(x, y, '#22d3ee', 20);
    if (lives <= 0) {
      lives = 0;
      updateHud();
      gameOver();
    } else {
      updateHud();
    }
  }

  function releaseKeys() {
    keys.left = keys.right = keys.up = keys.down = keys.fire = false;
    pointerTarget = null;
  }

  function shoot() {
    if (bullets.length >= 3) return;
    bullets.push({ x: player.x, y: player.y - 18, vy: -620 });
    fireCool = 0.21;
    burst(player.x, player.y - 20, '#22d3ee', 3);
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i, j;

    /* --- ship --- */
    var vx = 0, vy = 0;
    if (keys.left) vx -= 1;
    if (keys.right) vx += 1;
    if (vx === 0 && pointerTarget !== null) {
      var d = pointerTarget - player.x;
      if (Math.abs(d) > 8) vx = d > 0 ? 1 : -1;
    }
    if (keys.up) vy -= 1;
    if (keys.down) vy += 1;
    player.x = clamp(player.x + vx * player.speed * dt, 22, W - 22);
    player.y = clamp(player.y + vy * player.speed * 0.72 * dt, 34, H - 24);

    if (fireCool > 0) fireCool -= dt;
    if (keys.fire && fireCool <= 0) shoot();
    if (invuln > 0) invuln -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 60);

    /* --- formation --- */
    var minX = 1e9, maxX = -1e9, lowY = -1e9;
    for (i = 0; i < enemies.length; i++) {
      var ex0 = enemies[i].bx + form.x;
      if (ex0 < minX) minX = ex0;
      if (ex0 + enemies[i].w > maxX) maxX = ex0 + enemies[i].w;
      var ey0 = enemies[i].by + form.y + enemies[i].h;
      if (ey0 > lowY) lowY = ey0;
    }

    var mx = form.dir * form.speed * dt;
    if (enemies.length && (minX + mx < 8 || maxX + mx > W - 8)) {
      form.dir *= -1;
      mx = 0;
      form.y += form.drop * 0.6 * dt;
    }
    form.x += mx;
    form.y += form.drop * dt;

    /* enemies that slip past the bottom edge cost a life */
    if (enemies.length && lowY >= H - 8) {
      hurt(player.x, player.y + 20);
      form.y -= (lowY - H * 0.5);
    }

    /* --- enemy fire --- */
    enemyFire -= dt;
    if (enemyFire <= 0 && enemies.length) {
      enemyFire = Math.max(0.42, 1.45 - wave * 0.1);
      var e = enemies[rand(enemies.length)];
      ebullets.push({
        x: e.bx + form.x + e.w / 2,
        y: e.by + form.y + e.h,
        vy: 190 + wave * 14
      });
    }

    /* --- player shots --- */
    for (i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.y += b.vy * dt;
      if (b.y < -14) { bullets.splice(i, 1); continue; }
      var hit = false;
      for (j = enemies.length - 1; j >= 0; j--) {
        var en = enemies[j];
        var ex = en.bx + form.x;
        var ey = en.by + form.y;
        if (b.x + 3 > ex && b.x - 3 < ex + en.w && b.y < ey + en.h && b.y > ey) {
          bullets.splice(i, 1);
          hit = true;
          en.hp--;
          en.hit = 0.1;
          if (en.hp <= 0) {
            enemies.splice(j, 1);
            score += 10;
            burst(ex + en.w / 2, ey + en.h / 2, en.col, 14);
          } else {
            score += 2;
          }
          updateHud();
          break;
        }
      }
      if (hit) continue;
    }

    /* --- enemy shots --- */
    for (i = ebullets.length - 1; i >= 0; i--) {
      var eb = ebullets[i];
      eb.y += eb.vy * dt;
      if (eb.y > H + 14) { ebullets.splice(i, 1); continue; }
      if (invuln <= 0 &&
          eb.x > player.x - 13 && eb.x < player.x + 13 &&
          eb.y > player.y - 13 && eb.y < player.y + 13) {
        ebullets.splice(i, 1);
        hurt(player.x, player.y);
        if (state !== 'running') return;
      }
    }

    /* --- alien vs ship --- */
    if (invuln <= 0) {
      for (i = enemies.length - 1; i >= 0; i--) {
        var en2 = enemies[i];
        var ax = en2.bx + form.x, ay = en2.by + form.y;
        if (ax < player.x + 13 && ax + en2.w > player.x - 13 &&
            ay < player.y + 13 && ay + en2.h > player.y - 13) {
          burst(ax + en2.w / 2, ay + en2.h / 2, en2.col, 16);
          enemies.splice(i, 1);
          hurt(player.x, player.y);
          if (state !== 'running') return;
        }
      }
    }

    /* --- flash timers --- */
    for (i = 0; i < enemies.length; i++) {
      if (enemies[i].hit > 0) enemies[i].hit -= dt;
    }

    /* --- wave progress --- */
    if (!enemies.length) {
      if (waveClear <= 0) waveClear = 1.15;
      waveClear -= dt;
      if (waveClear <= 0) {
        score += 40 * wave;
        wave++;
        spawnWave();
        invuln = Math.max(invuln, 1);
        burst(W / 2, 130, '#7c5cff', 24);
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
    if (invuln > 0 && Math.floor(t / 110) % 2 === 0) return;
    var x = player.x, y = player.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.moveTo(0, -17);
    ctx.lineTo(11, 6);
    ctx.lineTo(0, 14);
    ctx.lineTo(-11, 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.moveTo(0, -10);
    ctx.lineTo(5, 4);
    ctx.lineTo(0, 8);
    ctx.lineTo(-5, 4);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(124,92,255,.9)';
    ctx.beginPath();
    ctx.arc(0, 2, 2.6, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (keys.up || keys.down || keys.left || keys.right) {
      ctx.fillStyle = 'rgba(124,92,255,.55)';
      ctx.beginPath();
      ctx.moveTo(x - 4, y + 14);
      ctx.lineTo(x, y + 22 + Math.random() * 6);
      ctx.lineTo(x + 4, y + 14);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawAlien(e, x, y) {
    var cx = x + e.w / 2, cy = y + e.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.shadowColor = e.col;
    ctx.shadowBlur = 12;
    ctx.fillStyle = e.hit > 0 ? '#ffffff' : e.col;
    ctx.beginPath();
    ctx.moveTo(0, -e.h / 2);
    ctx.lineTo(e.w / 2, -e.h / 6);
    ctx.lineTo(e.w / 2, e.h / 2);
    ctx.lineTo(-e.w / 2, e.h / 2);
    ctx.lineTo(-e.w / 2, -e.h / 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = 'rgba(5,7,14,.85)';
    ctx.beginPath();
    ctx.arc(cx - 6, cy + 3, 3, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + 6, cy + 3, 3, 0, TAU);
    ctx.fill();
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 40, 10, W * 0.5, 40, W * 0.9);
    g.addColorStop(0, 'rgba(124,92,255,.20)');
    g.addColorStop(0.5, 'rgba(34,211,238,.06)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.globalAlpha = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 700 * s.s + s.p));
      ctx.fillStyle = '#cfe3ff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    if (enemies) {
      for (i = 0; i < enemies.length; i++) {
        drawAlien(enemies[i], enemies[i].bx + form.x, enemies[i].by + form.y);
      }
    }

    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#dffbff';
    for (i = 0; i < bullets.length; i++) {
      rr(bullets[i].x - 2.5, bullets[i].y - 9, 5, 16, 2.5);
      ctx.fill();
    }
    ctx.restore();

    ctx.save();
    ctx.shadowColor = '#ff5c7a';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#ff9db4';
    for (i = 0; i < ebullets.length; i++) {
      ctx.beginPath();
      ctx.arc(ebullets[i].x, ebullets[i].y, 4, 0, TAU);
      ctx.fill();
    }
    ctx.restore();

    if (player) drawShip(t);

    ctx.restore();

    /* arena floor */
    ctx.strokeStyle = 'rgba(34,211,238,.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, H - 6.5);
    ctx.lineTo(W, H - 6.5);
    ctx.stroke();

    if (waveClear > 0 && state === 'running') {
      ctx.fillStyle = 'rgba(232,238,252,.95)';
      ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WAVE CLEAR!', W / 2, H * 0.42);
      ctx.font = 'bold 18px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = 'rgba(34,211,238,.95)';
      ctx.fillText('Next wave incoming…', W / 2, H * 0.42 + 30);
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

  function fireKey() {
    if (state === 'running') keys.fire = true;
  }

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
      else fireKey();
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
        else if (act === 'left') keys.left = true;
        else if (act === 'right') keys.right = true;
      }
      function off() {
        if (act === 'fire') keys.fire = false;
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
    pointerTarget = clamp(x, 22, W - 22);
    shoot();
  });

  window.addEventListener('pointerup', function () { pointerTarget = null; });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  makeStars();
  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Space Blaster',
    msg: 'Slide with the arrow keys or WASD, hold Space to fire and stop the alien formation before it reaches the bottom. You have three lives.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
