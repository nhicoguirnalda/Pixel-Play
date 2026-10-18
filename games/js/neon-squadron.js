/* ============================================================
   Neon Squadron — original game for PixelPlay
   Vertical scrolling shoot-'em-up: formation waves, a boss
   every fifth wave, timed power-ups. Keyboard + on-screen pad.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 560, H = 680;
  var BEST_KEY = 'neon-squadron';

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var rafId = 0, lastT = 0, newBest = false;

  var score = 0, lives = 3, wave = 1;
  var ship = { x: W / 2, y: H - 96 };
  var keys = { left: false, right: false, up: false, down: false };
  var firing = false, autoFire = true;

  var bullets = [], eBullets = [], enemies = [], powers = [], sparks = [], stars = [];

  var fireCd = 0, invuln = 0, shield = 0;
  var rapidMs = 0, spreadMs = 0;
  var between = false, waveGap = 0;

  var SHIP_SPEED = 5.4;              /* px per 60fps frame */
  var BULLET_SPEED = 11;
  var EBULLET = 4.0;
  var FIRE_MS = 190, RAPID_FIRE_MS = 85;

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rnd(a, b) { return a + Math.random() * (b - a); }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function spark(x, y, n, color, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rnd(0.5, 3.4) * (power || 1);
      sparks.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rnd(260, 620), max: 620, r: rnd(1.4, 3.4), color: color
      });
    }
  }

  function initStars() {
    stars = [];
    for (var i = 0; i < 90; i++) {
      stars.push({ x: Math.random() * W, y: Math.random() * H,
                   s: rnd(0.5, 1.7), v: rnd(0.4, 2.2) });
    }
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Lives: lives },
      state === 'paused' ? '⏸ Paused' : 'Wave ' + wave
    );
  }

  /* ---------------- waves ---------------- */

  function spawnBoss() {
    var lvl = Math.floor(wave / 5);
    var hp = 26 + lvl * 20;
    enemies.push({
      x: W / 2, y: -120, baseX: W / 2, dir: 1,
      w: 152, h: 78, r: 74,
      hp: hp, maxHp: hp, vy: 1.1, amp: 0, phase: 0,
      fireCd: 1100, boss: true, hitFlash: 0
    });
  }

  function spawnWave() {
    enemies = [];
    eBullets = [];
    if (wave % 5 === 0) { spawnBoss(); return; }

    var cols = 6;
    var rows = Math.min(4, 1 + Math.floor((wave + 1) / 2));
    var hp = 1 + Math.floor(wave / 4);
    var gapX = W / (cols + 1);

    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        var bx = gapX * (c + 1);
        enemies.push({
          x: bx, y: -70 - r * 58, baseX: bx,
          w: 30, h: 26, r: 16,
          hp: hp, maxHp: hp,
          vy: Math.min(1.35, 0.42 + wave * 0.035),
          amp: 14 + (r % 2) * 16,
          phase: c * 0.8 + r * 0.5,
          fireCd: rnd(900, 2600), boss: false, hitFlash: 0
        });
      }
    }
  }

  /* ---------------- bullets ---------------- */

  function shoot() {
    var y = ship.y - 22;
    var sp = spreadMs > 0;
    bullets.push({ x: ship.x, y: y, vx: 0, vy: -BULLET_SPEED, r: 4.5, dmg: 1 });
    if (sp) {
      bullets.push({ x: ship.x - 11, y: y + 8, vx: -2.6, vy: -BULLET_SPEED * 0.94, r: 4, dmg: 1 });
      bullets.push({ x: ship.x + 11, y: y + 8, vx: 2.6, vy: -BULLET_SPEED * 0.94, r: 4, dmg: 1 });
    }
  }

  function bossFire(e) {
    var n = 5;
    for (var i = 0; i < n; i++) {
      var spread = -0.55 + (i / (n - 1)) * 1.1;
      eBullets.push({
        x: e.x, y: e.y + e.h / 2, r: 6,
        vx: Math.sin(spread) * EBULLET * 1.15,
        vy: Math.cos(spread) * EBULLET * 1.15
      });
    }
  }

  function dropPower(x, y) {
    var kinds = ['rapid', 'spread', 'shield'];
    var kind = kinds[Math.floor(Math.random() * kinds.length)];
    powers.push({ x: x, y: y, vy: 1.5, r: 13, kind: kind, ttl: 9000, spin: 0 });
  }

  function applyPower(kind) {
    if (kind === 'rapid') rapidMs = 9000;
    else if (kind === 'spread') spreadMs = 9000;
    else shield = 1;
    spark(ship.x, ship.y - 10, 18, kind === 'shield' ? '#a3e635' : '#22d3ee', 0.9);
  }

  /* ---------------- state changes ---------------- */

  function reset() {
    score = 0; lives = 3; wave = 1; newBest = false;
    ship.x = W / 2; ship.y = H - 96;
    bullets = []; eBullets = []; enemies = []; powers = []; sparks = [];
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    fireCd = 0; invuln = 1800; shield = 0; rapidMs = 0; spreadMs = 0;
    between = false; waveGap = 0;
    spawnWave();
    updateHud();
  }

  function start() {
    reset();
    state = 'running';
    lastT = 0;
    GameShell.overlay.hide();
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    keys.left = keys.right = keys.up = keys.down = false;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The squadron is holding formation. Jump back in when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Lives', value: lives }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    lastT = 0;
    GameShell.overlay.hide();
    updateHud();
  }

  function gameOver() {
    state = 'over';
    if (score > best) { best = score; newBest = true; GameShell.best.set(BEST_KEY, best); }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Squadron down',
      msg: 'You reached wave ' + wave + ' with ' + score + ' points. Ready for another run?',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function hitsShip(x, y, hw, hh) {
    return Math.abs(x - ship.x) < hw + 12 && Math.abs(y - ship.y) < hh + 13;
  }

  /* returns true when the hit actually cost something */
  function damagePlayer() {
    if (state !== 'running' || invuln > 0) return false;
    if (shield > 0) {
      shield = 0;
      invuln = 900;
      spark(ship.x, ship.y, 20, '#a3e635', 1.1);
      return true;
    }
    lives--;
    invuln = 1700;
    spark(ship.x, ship.y, 32, '#ec4899', 1.4);
    updateHud();
    if (lives <= 0) gameOver();
    return true;
  }

  function damageEnemy(idx, dmg) {
    var e = enemies[idx];
    e.hp -= dmg;
    e.hitFlash = 90;
    if (e.hp > 0) return;

    var worth = e.boss ? 1200 + Math.floor(wave / 5) * 300 : 100;
    score += worth;
    spark(e.x, e.y, e.boss ? 60 : 14, e.boss ? '#f472b6' : '#67e8f9', e.boss ? 1.7 : 1);
    if (e.boss) { dropPower(e.x - 34, e.y); dropPower(e.x + 34, e.y); }
    else if (Math.random() < 0.15) dropPower(e.x, e.y);
    enemies.splice(idx, 1);
    updateHud();
  }

  /* ---------------- update ---------------- */

  function update(dt, k) {
    if (invuln > 0) invuln -= dt;
    if (rapidMs > 0) rapidMs -= dt;
    if (spreadMs > 0) spreadMs -= dt;

    /* drift the starfield */
    for (var s = 0; s < stars.length; s++) {
      var st = stars[s];
      st.y += st.v * (0.7 + st.s * 0.5) * k;
      if (st.y > H + 2) { st.y = -2; st.x = Math.random() * W; }
    }

    /* ship movement */
    var dx = 0, dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    ship.x = clamp(ship.x + dx * SHIP_SPEED * k, 22, W - 22);
    ship.y = clamp(ship.y + dy * SHIP_SPEED * k, H * 0.42, H - 30);

    /* auto / held fire */
    fireCd -= dt;
    if (fireCd <= 0 && (firing || autoFire)) {
      fireCd = rapidMs > 0 ? RAPID_FIRE_MS : FIRE_MS;
      shoot();
    }

    /* player bullets */
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x += b.vx * k;
      b.y += b.vy * k;
      if (b.y < -20 || b.x < -20 || b.x > W + 20) { bullets.splice(i, 1); continue; }
      for (var j = enemies.length - 1; j >= 0; j--) {
        var tgt = enemies[j];
        if (Math.abs(b.x - tgt.x) < tgt.w / 2 + b.r &&
            Math.abs(b.y - tgt.y) < tgt.h / 2 + b.r) {
          bullets.splice(i, 1);
          damageEnemy(j, b.dmg);
          break;
        }
      }
    }

    /* enemies */
    for (var e = enemies.length - 1; e >= 0; e--) {
      var en = enemies[e];
      if (en.hitFlash > 0) en.hitFlash -= dt;

      if (en.boss) {
        if (en.y < 132) {
          en.y += en.vy * k;
        } else {
          en.x += (1.5 + Math.floor(wave / 5) * 0.25) * k * en.dir;
          if (en.x < 112) { en.x = 112; en.dir = 1; }
          if (en.x > W - 112) { en.x = W - 112; en.dir = -1; }
        }
        en.fireCd -= dt;
        if (en.fireCd <= 0 && en.y > 0) {
          en.fireCd = Math.max(680, 1300 - Math.floor(wave / 5) * 120);
          bossFire(en);
        }
      } else {
        en.y += en.vy * k;
        en.phase += 0.022 * k;
        en.x = en.baseX + Math.sin(en.phase) * en.amp;
        en.fireCd -= dt;
        if (en.fireCd <= 0 && en.y > 10 && en.y < H * 0.78) {
          en.fireCd = rnd(1500, 3400);
          eBullets.push({ x: en.x, y: en.y + en.h / 2, vx: 0, vy: EBULLET, r: 5 });
        }
      }

      if (en.y > H + 74) { enemies.splice(e, 1); continue; }

      if (hitsShip(en.x, en.y, en.w / 2, en.h / 2) && damagePlayer()) {
        spark(en.x, en.y, 14, '#f9a8d4', 1);
        if (!en.boss) enemies.splice(e, 1);
        if (state !== 'running') return;
      }
    }

    /* enemy bullets */
    for (var m = eBullets.length - 1; m >= 0; m--) {
      var eb = eBullets[m];
      eb.x += eb.vx * k;
      eb.y += eb.vy * k;
      if (eb.y > H + 24 || eb.y < -24 || eb.x < -24 || eb.x > W + 24) {
        eBullets.splice(m, 1);
        continue;
      }
      if (hitsShip(eb.x, eb.y, eb.r, eb.r)) {
        eBullets.splice(m, 1);
        damagePlayer();
        if (state !== 'running') return;
      }
    }

    /* power-ups */
    for (var p = powers.length - 1; p >= 0; p--) {
      var pw = powers[p];
      pw.y += pw.vy * k;
      pw.spin += 0.05 * k;
      pw.ttl -= dt;
      if (pw.y > H + 30 || pw.ttl <= 0) { powers.splice(p, 1); continue; }
      if (Math.abs(pw.x - ship.x) < 24 && Math.abs(pw.y - ship.y) < 26) {
        powers.splice(p, 1);
        applyPower(pw.kind);
      }
    }

    /* sparks */
    for (var q = sparks.length - 1; q >= 0; q--) {
      var sk = sparks[q];
      sk.x += sk.vx * k;
      sk.y += sk.vy * k;
      sk.vx *= 0.97;
      sk.vy *= 0.97;
      sk.life -= dt;
      if (sk.life <= 0) sparks.splice(q, 1);
    }

    /* wave progression */
    if (enemies.length === 0) {
      if (!between) {
        between = true;
        waveGap = 1400;
        score += 200 + wave * 60;
        updateHud();
      } else {
        waveGap -= dt;
        if (waveGap <= 0) {
          between = false;
          wave++;
          spawnWave();
          updateHud();
        }
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawStars() {
    for (var i = 0; i < stars.length; i++) {
      var s = stars[i];
      ctx.fillStyle = 'rgba(200,222,255,' + (0.18 + s.s * 0.28).toFixed(2) + ')';
      ctx.fillRect(s.x, s.y, s.s, s.s * 2.4);
    }
  }

  function drawShip(t) {
    if (invuln > 0 && Math.floor(t / 90) % 2 === 0 && state === 'running') return;
    var x = ship.x, y = ship.y;

    ctx.save();
    ctx.shadowColor = '#ec4899';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#f9a8d4';
    ctx.beginPath();
    ctx.moveTo(x, y - 20);
    ctx.lineTo(x + 15, y + 12);
    ctx.lineTo(x, y + 5);
    ctx.lineTo(x - 15, y + 12);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.arc(x, y - 4, 4, 0, Math.PI * 2);
    ctx.fill();

    /* engine flare */
    var fl = 8 + Math.sin(t / 70) * 3;
    ctx.fillStyle = 'rgba(34,211,238,.85)';
    ctx.beginPath();
    ctx.moveTo(x - 5, y + 11);
    ctx.lineTo(x + 5, y + 11);
    ctx.lineTo(x, y + 11 + fl);
    ctx.closePath();
    ctx.fill();

    if (shield > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(163,230,53,.85)';
      ctx.lineWidth = 2;
      ctx.shadowColor = '#a3e635';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      ctx.arc(x, y, 24 + Math.sin(t / 240) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawEnemy(e) {
    var hurt = e.hitFlash > 0;
    if (e.boss) {
      ctx.save();
      ctx.shadowColor = hurt ? '#ffffff' : '#f472b6';
      ctx.shadowBlur = 24;
      ctx.fillStyle = hurt ? '#fbcfe8' : '#6d2148';
      roundRect(e.x - e.w / 2, e.y - e.h / 2, e.w, e.h, 16);
      ctx.fill();
      ctx.fillStyle = hurt ? '#ffffff' : '#f472b6';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 24, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b1224';
      ctx.beginPath();
      ctx.arc(e.x, e.y, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = hurt ? '#ffffff' : 'rgba(249,168,212,.9)';
      ctx.fillRect(e.x - 62, e.y + 20, 26, 8);
      ctx.fillRect(e.x + 36, e.y + 20, 26, 8);
      ctx.restore();

      /* health bar */
      var frac = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(255,255,255,.12)';
      roundRect(e.x - 76, e.y - e.h / 2 - 18, 152, 9, 4);
      ctx.fill();
      ctx.fillStyle = frac > 0.4 ? '#f472b6' : '#fbbf24';
      roundRect(e.x - 76, e.y - e.h / 2 - 18, 152 * frac, 9, 4);
      ctx.fill();
      return;
    }

    ctx.save();
    ctx.shadowColor = hurt ? '#ffffff' : '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillStyle = hurt ? '#ffffff' : (e.hp > 1 ? '#155e75' : '#0e7490');
    ctx.beginPath();
    ctx.moveTo(e.x, e.y - e.h / 2);
    ctx.lineTo(e.x + e.w / 2, e.y);
    ctx.lineTo(e.x, e.y + e.h / 2);
    ctx.lineTo(e.x - e.w / 2, e.y);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = hurt ? '#0b1224' : '#a5f3fc';
    ctx.beginPath();
    ctx.arc(e.x, e.y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPower(pw) {
    var col = pw.kind === 'rapid' ? '#ec4899' : (pw.kind === 'spread' ? '#22d3ee' : '#a3e635');
    var letter = pw.kind === 'rapid' ? 'R' : (pw.kind === 'spread' ? 'S' : 'D');
    var blink = pw.ttl < 2400 && Math.floor(pw.ttl / 180) % 2 === 0;

    ctx.save();
    ctx.translate(pw.x, pw.y);
    ctx.rotate(pw.spin);
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.shadowColor = col;
    ctx.shadowBlur = 16;
    ctx.strokeStyle = col;
    ctx.lineWidth = 3;
    ctx.strokeRect(-pw.r * 0.8, -pw.r * 0.8, pw.r * 1.6, pw.r * 1.6);
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = blink ? 0.35 : 1;
    ctx.fillStyle = col;
    ctx.font = '700 14px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, pw.x, pw.y + 1);
    ctx.restore();
  }

  function drawBanner() {
    if (!between) return;
    ctx.save();
    ctx.font = '800 40px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.9)';
    ctx.fillText('Wave ' + (wave + 1), W / 2, H * 0.42);
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText(wave + 1 === 6 || (wave + 1) % 5 === 0 ? 'Boss incoming…' : 'Get ready…', W / 2, H * 0.42 + 34);
    ctx.restore();
  }

  function draw(t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0a0f22');
    g.addColorStop(0.55, '#080d1a');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    drawStars();

    for (var p = 0; p < powers.length; p++) drawPower(powers[p]);

    for (var e = 0; e < enemies.length; e++) drawEnemy(enemies[e]);

    /* player bullets */
    ctx.save();
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 10;
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      ctx.fillStyle = '#a5f3fc';
      ctx.fillRect(b.x - 2, b.y - 9, 4, 14);
    }
    ctx.restore();

    /* enemy bullets */
    ctx.save();
    ctx.shadowColor = '#fb7185';
    ctx.shadowBlur = 10;
    for (var m = 0; m < eBullets.length; m++) {
      var eb = eBullets[m];
      ctx.fillStyle = '#fecdd3';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, eb.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (state !== 'over') drawShip(t);

    /* sparks */
    for (var q = 0; q < sparks.length; q++) {
      var sk = sparks[q];
      ctx.globalAlpha = Math.max(0, Math.min(1, sk.life / sk.max));
      ctx.fillStyle = sk.color;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    drawBanner();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);      /* cap so tab jumps never teleport */
    lastT = t;
    var k = dt / 16.67;
    if (state === 'running') update(dt, k);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var key = e.key;
    if (key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' ||
        key === 'ArrowRight' || key === ' ') {
      e.preventDefault();
    }

    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = true;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = true;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') keys.up = true;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') keys.down = true;
    else if (key === ' ') {
      firing = true;
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
    } else if (key === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else if (state === 'running') pause();
    } else if (key === 'p' || key === 'P' || key === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (key === 'r' || key === 'R') {
      start();
    }
  });

  document.addEventListener('keyup', function (e) {
    var key = e.key;
    if (key === 'ArrowLeft' || key === 'a' || key === 'A') keys.left = false;
    else if (key === 'ArrowRight' || key === 'd' || key === 'D') keys.right = false;
    else if (key === 'ArrowUp' || key === 'w' || key === 'W') keys.up = false;
    else if (key === 'ArrowDown' || key === 's' || key === 'S') keys.down = false;
    else if (key === ' ') firing = false;
  });

  window.addEventListener('blur', function () {
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
  });

  /* on-screen direction pad */
  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        keys[dir] = true;
        if (state === 'ready' || state === 'over') start();
      });
      btn.addEventListener('pointerup', function (ev) {
        if (ev) ev.preventDefault();
        keys[dir] = false;
      });
      btn.addEventListener('pointerleave', function () { keys[dir] = false; });
      btn.addEventListener('pointercancel', function () { keys[dir] = false; });
    })(padBtns[b]);
  }

  canvas.addEventListener('pointerdown', function () {
    if (state === 'ready' || state === 'over') start();
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var a = 0; a < actionBtns.length; a++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-action') !== 'pause') return;
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[a]);
  }

  /* auto-pause when the tab is hidden */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  initStars();
  reset();
  state = 'ready';
  ensureLoop();
  GameShell.overlay.show({
    title: 'Neon Squadron',
    msg: 'Fly with the arrow keys or WASD and shoot with Space — auto-fire is already on. Clear every alien wave, grab the power-ups and watch out for the boss every fifth wave.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
