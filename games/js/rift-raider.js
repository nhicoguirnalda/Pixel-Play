/* ============================================================
   Rift Raider — original game for PixelPlay
   Horizontal scrolling shoot-'em-up: fly the scout ship with
   the arrow keys / WASD, dodge drifting rocks, blast raiders
   and collect rapid-fire, spread and shield capsules.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 720, H = 420;
  var BEST_KEY = 'rift-raider';

  var SHIP_MIN_X = 74;
  var SHIP_MAX_X = 300;
  var SHIP_SPEED_X = 215;
  var SHIP_SPEED_Y = 290;
  var SHIP_R = 12;

  var BASE_SCROLL = 232, MAX_SCROLL = 428;

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);

  var ship = { x: 150, y: H / 2, vx: 0, vy: 0 };
  var keys = { up: false, down: false, left: false, right: false };

  var bullets, ebullets, rocks, enemies, powerups, bits, texts;
  var dist, bonus, lives, invuln, scroll, shake, muzzle, clock;
  var fireMs, rockMs, enemyMs, powMs, rapidMs, spreadMs, shield;
  var newBest = false, rafId = 0, lastT = 0;

  var stars = [];
  (function seedStars() {
    for (var i = 0; i < 96; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        z: 0.25 + Math.random() * 0.75
      });
    }
  })();

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function toast(x, y, txt, colour) {
    texts.push({ x: x, y: y, txt: txt, colour: colour || '#e8eefc', life: 900, max: 900 });
    if (texts.length > 20) texts.shift();
  }

  function burst(x, y, n, colour, power) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var sp = (0.35 + Math.random()) * power;
      bits.push({
        x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 300 + Math.random() * 340, max: 640,
        size: 1.5 + Math.random() * 2.5, colour: colour
      });
    }
    if (bits.length > 260) bits.splice(0, bits.length - 260);
  }

  function metres() { return Math.floor(dist); }
  function scoreNow() { return Math.floor(dist) + bonus; }

  /* ---------------- HUD (updates in place, never rebuilt) ---------------- */

  var hudCells = null;

  function paintHud() {
    var hud = document.getElementById('gameHud');
    if (!hud) return;
    if (!hudCells || hudCells.length < 3 || hudCells[0].parentNode !== hud) {
      GameShell.hud({ Score: 0, Best: 0, Lives: 0 }, '');
      hudCells = hud.querySelectorAll('.hud-item b');
    }
    if (hudCells.length >= 3) {
      hudCells[0].textContent = scoreNow();
      hudCells[1].textContent = Math.max(best, scoreNow());
      hudCells[2].textContent = lives;
    }
    var spacer = hud.querySelector('.hud-spacer');
    if (spacer) {
      spacer.textContent = state === 'paused'
        ? '⏸ Paused'
        : 'Distance ' + metres() + ' m';
    }
  }

  /* ---------------- spawning ---------------- */

  function spawnRock() {
    var r = 12 + Math.random() * 14;
    var n = 6 + ((Math.random() * 3) | 0);
    var verts = [], i;
    for (i = 0; i < n; i++) verts.push(0.72 + Math.random() * 0.42);
    var hp = r < 16 ? 1 : (r < 23 ? 2 : 3);
    rocks.push({
      x: W + 30 + Math.random() * 70,
      y: 34 + Math.random() * (H - 68),
      r: r, verts: verts,
      rot: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 1.4,
      vx: -(scroll + 20 + Math.random() * 70),
      vy: (Math.random() - 0.5) * 42,
      hp: hp, maxHp: hp, hurt: 0
    });
  }

  function spawnEnemy() {
    var y = 46 + Math.random() * (H - 92);
    enemies.push({
      x: W + 50, y: y, y0: y,
      r: 16, hp: 3, maxHp: 3,
      vx: -(scroll * 0.72 + 26),
      phase: Math.random() * Math.PI * 2,
      fire: 800 + Math.random() * 1000,
      hurt: 0
    });
  }

  function spawnPowerup() {
    var types = ['rapid', 'spread', 'shield'];
    var t = types[(Math.random() * types.length) | 0];
    powerups.push({
      x: W + 30,
      y: 46 + Math.random() * (H - 92),
      r: 13,
      type: t,
      vx: -(scroll * 0.68),
      hurt: 0
    });
  }

  function enemyShot(e) {
    var d = e.x - ship.x;
    var vy = d > 1 ? clamp((ship.y - e.y) / d * 320, -190, 190) : 0;
    ebullets.push({ x: e.x - 16, y: e.y, vx: -320, vy: vy, life: 3.2 });
    if (ebullets.length > 90) ebullets.shift();
  }

  /* ---------------- combat ---------------- */

  function shoot() {
    var lanes = spreadMs > 0 ? [-165, 0, 165] : [0];
    for (var i = 0; i < lanes.length; i++) {
      var vy = lanes[i];
      bullets.push({
        x: ship.x + 22,
        y: ship.y + vy * 0.02,
        vx: 650, vy: vy, life: 1.3, r: 4
      });
    }
    if (bullets.length > 120) bullets.splice(0, bullets.length - 120);
    muzzle = 60;
  }

  function hurt() {
    if (invuln > 0 || state !== 'running') return;
    if (shield) {
      shield = false;
      invuln = 900;
      shake = Math.max(shake, 7);
      burst(ship.x, ship.y, 18, '#a78bfa', 170);
      toast(ship.x + 30, ship.y - 26, 'Shield absorbed it!', '#c4b5fd');
      paintHud();
      return;
    }
    lives--;
    invuln = 1600;
    shake = Math.max(shake, 14);
    burst(ship.x, ship.y, 24, '#f87171', 210);
    rapidMs = 0;
    spreadMs = 0;
    if (lives <= 0) {
      lives = 0;
      gameOver();
    } else {
      paintHud();
    }
  }

  function destroyRock(r, i) {
    rocks.splice(i, 1);
    bonus += 8;
    burst(r.x, r.y, 12, '#94a3b8', 140);
    toast(r.x, r.y - 12, '+8', '#cbd5e1');
  }

  function destroyEnemy(e, i) {
    enemies.splice(i, 1);
    bonus += 25;
    burst(e.x, e.y, 20, '#fb7185', 200);
    toast(e.x, e.y - 14, '+25', '#fda4af');
    if (Math.random() < 0.22) {
      powerups.push({ x: e.x, y: e.y, r: 13, type: 'shield', vx: -(scroll * 0.68), hurt: 0 });
    }
    paintHud();
  }

  /* ---------------- state changes ---------------- */

  function start() {
    ship.x = 150;
    ship.y = H / 2;
    ship.vx = 0;
    ship.vy = 0;
    keys.up = keys.down = keys.left = keys.right = false;

    bullets = [];
    ebullets = [];
    rocks = [];
    enemies = [];
    powerups = [];
    bits = [];
    texts = [];

    dist = 0;
    bonus = 0;
    lives = 3;
    invuln = 1200;
    scroll = BASE_SCROLL;
    shake = 0;
    muzzle = 0;
    fireMs = 200;
    rockMs = 700;
    enemyMs = 4200;
    powMs = 7000;
    rapidMs = 0;
    spreadMs = 0;
    shield = false;
    newBest = false;

    state = 'running';
    GameShell.overlay.hide();
    paintHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    keys.up = keys.down = keys.left = keys.right = false;
    paintHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Engines idling in the rift. Resume when you are ready to fly on.',
      stats: [
        { label: 'Score', value: scoreNow() },
        { label: 'Distance', value: metres() + ' m' },
        { label: 'Lives', value: lives }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    GameShell.overlay.hide();
    paintHud();
  }

  function gameOver() {
    state = 'over';
    if (scoreNow() > best) {
      best = scoreNow();
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    paintHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Ship destroyed',
      msg: 'You flew ' + metres() + ' metres through the rift and scored ' +
           scoreNow() + ' points. The raiders own this stretch — for now.',
      stats: [
        { label: 'Score', value: scoreNow() },
        { label: 'Distance', value: metres() + ' m' },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function driftStars(dt, speed) {
    var s = dt / 1000;
    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      st.x -= speed * st.z * s;
      if (st.x < -4) {
        st.x = W + 4;
        st.y = Math.random() * H;
      }
    }
  }

  function update(dt) {
    var s = dt / 1000;
    var i, j, b;

    /* difficulty rises with distance */
    var level = 1 + Math.floor(dist / 340);
    scroll = Math.min(MAX_SCROLL, BASE_SCROLL + (level - 1) * 16);

    dist += scroll * s / 10;                 /* 10 px = 1 metre */

    if (shake > 0) shake -= dt;
    if (invuln > 0) invuln -= dt;
    if (muzzle > 0) muzzle -= dt;
    if (rapidMs > 0) rapidMs = Math.max(0, rapidMs - dt);
    if (spreadMs > 0) spreadMs = Math.max(0, spreadMs - dt);

    /* --- ship --- */
    var tx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var ty = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    ship.vx = tx * SHIP_SPEED_X;
    ship.vy = ty * SHIP_SPEED_Y;
    ship.x = clamp(ship.x + ship.vx * s, SHIP_MIN_X, SHIP_MAX_X);
    ship.y = clamp(ship.y + ship.vy * s, 24, H - 24);

    /* --- firing (automatic) --- */
    fireMs -= dt;
    if (fireMs <= 0) {
      shoot();
      fireMs = rapidMs > 0 ? 104 : 184;
    }

    /* --- spawning --- */
    rockMs -= dt;
    if (rockMs <= 0) {
      spawnRock();
      rockMs = Math.max(300, 950 - level * 45) * (0.7 + Math.random() * 0.6);
    }
    enemyMs -= dt;
    if (enemyMs <= 0) {
      spawnEnemy();
      enemyMs = Math.max(900, 2700 - level * 140) * (0.7 + Math.random() * 0.6);
    }
    powMs -= dt;
    if (powMs <= 0) {
      spawnPowerup();
      powMs = 8000 + Math.random() * 7000;
    }

    /* --- rocks --- */
    for (i = rocks.length - 1; i >= 0; i--) {
      var r = rocks[i];
      r.x += r.vx * s;
      r.y += r.vy * s;
      r.rot += r.spin * s;
      if (r.hurt > 0) r.hurt -= dt;
      if (r.x < -70 || r.y < -70 || r.y > H + 70) { rocks.splice(i, 1); continue; }
      if (state === 'running') {
        var ddx = r.x - ship.x, ddy = r.y - ship.y;
        var touch = r.r * 0.82 + SHIP_R;
        if (ddx * ddx + ddy * ddy < touch * touch) {
          burst(r.x, r.y, 14, '#94a3b8', 150);
          rocks.splice(i, 1);
          hurt();
        }
      }
    }

    /* --- enemies --- */
    for (i = enemies.length - 1; i >= 0; i--) {
      var e = enemies[i];
      e.x += e.vx * s;
      e.y = clamp(e.y0 + Math.sin(clock / 640 + e.phase) * 32, 26, H - 26);
      if (e.hurt > 0) e.hurt -= dt;
      if (e.x < -60) { enemies.splice(i, 1); continue; }
      e.fire -= dt;
      if (e.fire <= 0 && e.x < W - 40) {
        enemyShot(e);
        e.fire = Math.max(700, 1500 + Math.random() * 900 - level * 60);
      }
      if (state === 'running') {
        var edx = e.x - ship.x, edy = e.y - ship.y;
        var et = e.r * 0.8 + SHIP_R;
        if (edx * edx + edy * edy < et * et) {
          burst(e.x, e.y, 20, '#fb7185', 200);
          enemies.splice(i, 1);
          hurt();
        }
      }
    }

    /* --- player bullets --- */
    for (i = bullets.length - 1; i >= 0; i--) {
      b = bullets[i];
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= s;
      if (b.life <= 0 || b.x > W + 24 || b.y < -24 || b.y > H + 24) { bullets.splice(i, 1); continue; }

      var hit = false;
      for (j = rocks.length - 1; j >= 0; j--) {
        var rk = rocks[j];
        var rx = rk.x - b.x, ry = rk.y - b.y;
        var rl = rk.r * 0.9 + b.r;
        if (rx * rx + ry * ry < rl * rl) {
          rk.hp--;
          rk.hurt = 80;
          burst(b.x, b.y, 3, '#e2e8f0', 60);
          if (rk.hp <= 0) destroyRock(rk, j);
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (j = enemies.length - 1; j >= 0; j--) {
          var en = enemies[j];
          var ex = en.x - b.x, ey = en.y - b.y;
          var el = en.r * 0.8 + b.r;
          if (ex * ex + ey * ey < el * el) {
            en.hp--;
            en.hurt = 80;
            burst(b.x, b.y, 3, '#fecdd3', 60);
            if (en.hp <= 0) destroyEnemy(en, j);
            hit = true;
            break;
          }
        }
      }
      if (hit) bullets.splice(i, 1);
    }

    /* --- enemy bullets --- */
    for (i = ebullets.length - 1; i >= 0; i--) {
      b = ebullets[i];
      b.x += b.vx * s;
      b.y += b.vy * s;
      b.life -= s;
      if (b.life <= 0 || b.x < -20 || b.y < -20 || b.y > H + 20) { ebullets.splice(i, 1); continue; }
      var bx = b.x - ship.x, by = b.y - ship.y;
      var bl = SHIP_R + 5;
      if (state === 'running' && bx * bx + by * by < bl * bl) {
        ebullets.splice(i, 1);
        hurt();
      }
    }

    /* --- power-ups --- */
    for (i = powerups.length - 1; i >= 0; i--) {
      var p = powerups[i];
      p.x += p.vx * s;
      if (p.x < -40) { powerups.splice(i, 1); continue; }
      if (state === 'running') {
        var px = p.x - ship.x, py = p.y - ship.y;
        var pl = p.r + SHIP_R + 4;
        if (px * px + py * py < pl * pl) {
          powerups.splice(i, 1);
          burst(p.x, p.y, 12, '#a5f3fc', 130);
          if (p.type === 'rapid') {
            rapidMs = 9000;
            toast(ship.x + 46, ship.y - 30, 'Rapid fire!', '#fcd34d');
          } else if (p.type === 'spread') {
            spreadMs = 10000;
            toast(ship.x + 46, ship.y - 30, 'Spread cannon!', '#67e8f9');
          } else {
            shield = true;
            toast(ship.x + 46, ship.y - 30, 'Shield up!', '#c4b5fd');
          }
          paintHud();
        }
      }
    }

    /* --- particles & text --- */
    for (i = bits.length - 1; i >= 0; i--) {
      var bit = bits[i];
      bit.x += bit.vx * s;
      bit.y += bit.vy * s;
      bit.vx *= 0.97;
      bit.vy *= 0.97;
      bit.life -= dt;
      if (bit.life <= 0) bits.splice(i, 1);
    }
    for (i = texts.length - 1; i >= 0; i--) {
      texts[i].y -= 20 * s;
      texts[i].life -= dt;
      if (texts[i].life <= 0) texts.splice(i, 1);
    }

    paintHud();
  }

  /* ---------------- draw ---------------- */

  function nebula(x, y, rad, colour) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, colour);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  function drawSpace() {
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, '#070d1a');
    g.addColorStop(0.55, '#04060d');
    g.addColorStop(1, '#0a0714');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    var drift = -(clock / 45) % (W + 360);
    nebula(drift + 120, 110, 190, 'rgba(6,182,212,.10)');
    nebula(drift + 520, 320, 230, 'rgba(168,85,247,.10)');

    for (var i = 0; i < stars.length; i++) {
      var st = stars[i];
      ctx.globalAlpha = 0.25 + st.z * 0.6;
      ctx.fillStyle = st.z > 0.75 ? '#bae6fd' : '#e2e8f0';
      var sz = 1 + st.z * 1.6;
      ctx.fillRect(st.x, st.y, sz, sz);
    }
    ctx.globalAlpha = 1;

    /* launch corridor the ship may not leave */
    var lg = ctx.createLinearGradient(SHIP_MIN_X - 46, 0, SHIP_MIN_X + 4, 0);
    lg.addColorStop(0, 'rgba(6,182,212,.16)');
    lg.addColorStop(1, 'rgba(6,182,212,0)');
    ctx.fillStyle = lg;
    ctx.fillRect(SHIP_MIN_X - 46, 0, 50, H);
    ctx.strokeStyle = 'rgba(34,211,238,.30)';
    ctx.setLineDash([8, 12]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(SHIP_MIN_X - 44, 0);
    ctx.lineTo(SHIP_MIN_X - 44, H);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawRock(r) {
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(r.rot);
    var n = r.verts.length, i, a, rad;
    ctx.fillStyle = r.hurt > 0 ? '#f1f5f9' : '#46536b';
    ctx.strokeStyle = 'rgba(148,163,184,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (i = 0; i < n; i++) {
      a = (i / n) * Math.PI * 2;
      rad = r.r * r.verts[i];
      if (i === 0) ctx.moveTo(Math.cos(a) * rad, Math.sin(a) * rad);
      else ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(13,19,33,.55)';
    ctx.beginPath();
    ctx.arc(r.r * 0.26, -r.r * 0.18, r.r * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-r.r * 0.3, r.r * 0.26, r.r * 0.15, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = 12;
    ctx.fillStyle = e.hurt > 0 ? '#ffffff' : '#be185d';
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(6, -14);
    ctx.lineTo(15, 0);
    ctx.lineTo(6, 14);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#fda4af';
    ctx.beginPath();
    ctx.arc(-6, 0, 4, 0, Math.PI * 2);
    ctx.fill();
    if (e.hp < e.maxHp) {
      var w = 30, f = Math.max(0, e.hp / e.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(-w / 2, -e.r - 12, w, 4);
      ctx.fillStyle = '#22c55e';
      ctx.fillRect(-w / 2, -e.r - 12, w * f, 4);
    }
    ctx.restore();
  }

  function drawPowerup(p) {
    var col = p.type === 'rapid' ? '#fbbf24' : (p.type === 'spread' ? '#22d3ee' : '#a78bfa');
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.shadowColor = col;
    ctx.shadowBlur = 14;
    ctx.fillStyle = 'rgba(8,12,22,.85)';
    ctx.beginPath();
    ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    if (p.type === 'rapid') {
      ctx.beginPath();
      ctx.moveTo(3, -8);
      ctx.lineTo(-4, 1);
      ctx.lineTo(0, 1);
      ctx.lineTo(-3, 8);
      ctx.lineTo(5, -1);
      ctx.lineTo(1, -1);
      ctx.closePath();
      ctx.fill();
    } else if (p.type === 'spread') {
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(-5, 0); ctx.lineTo(5, -6);
      ctx.moveTo(-5, 0); ctx.lineTo(5, 0);
      ctx.moveTo(-5, 0); ctx.lineTo(5, 6);
      ctx.stroke();
    } else {
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.arc(0, 0, 6, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawShip() {
    if (state === 'over') return;
    if (invuln > 0 && (Math.floor(clock / 90) % 2 === 0)) return;

    var tilt = clamp(ship.vy / SHIP_SPEED_Y, -1, 1) * 0.24;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    ctx.rotate(tilt);

    var flame = 7 + Math.sin(clock / 38) * 3;
    ctx.fillStyle = 'rgba(168,85,247,.85)';
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-10 - flame, 0);
    ctx.lineTo(-10, 4);
    ctx.closePath();
    ctx.fill();

    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#e0f2fe';
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-11, -11);
    ctx.lineTo(-5, 0);
    ctx.lineTo(-11, 11);
    ctx.closePath();
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#06b6d4';
    ctx.beginPath();
    ctx.moveTo(7, 0);
    ctx.lineTo(-7, -7);
    ctx.lineTo(-7, 7);
    ctx.closePath();
    ctx.fill();

    if (muzzle > 0) {
      ctx.globalAlpha = Math.min(1, muzzle / 60);
      ctx.fillStyle = '#cffafe';
      ctx.beginPath();
      ctx.arc(23, 0, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    if (shield) {
      ctx.strokeStyle = 'rgba(167,139,250,.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 24, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(167,139,250,.35)';
      ctx.beginPath();
      ctx.arc(0, 0, 29, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawStatus() {
    var x = 14, y = 14, i;
    var rows = [];
    if (rapidMs > 0) rows.push({ t: 'RAPID', f: rapidMs / 9000, c: '#fbbf24' });
    if (spreadMs > 0) rows.push({ t: 'SPREAD', f: spreadMs / 10000, c: '#22d3ee' });
    if (shield) rows.push({ t: 'SHIELD', f: 1, c: '#a78bfa' });

    ctx.save();
    ctx.font = '700 11px "Segoe UI", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    for (i = 0; i < rows.length; i++) {
      var r = rows[i];
      var yy = y + i * 20;
      ctx.fillStyle = 'rgba(255,255,255,.10)';
      ctx.fillRect(x, yy, 92, 8);
      ctx.fillStyle = r.c;
      ctx.fillRect(x, yy, 92 * clamp(r.f, 0, 1), 8);
      ctx.fillStyle = 'rgba(232,238,252,.85)';
      ctx.fillText(r.t, x, yy + 18);
      if (r.t !== 'SHIELD') {
        ctx.fillStyle = r.c;
        ctx.fillText(Math.ceil((r.t === 'RAPID' ? rapidMs : spreadMs) / 1000) + 's', x + 62, yy + 18);
      }
    }
    ctx.restore();
  }

  function draw() {
    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawSpace();

    var i;
    for (i = 0; i < rocks.length; i++) drawRock(rocks[i]);
    for (i = 0; i < powerups.length; i++) drawPowerup(powerups[i]);
    for (i = 0; i < enemies.length; i++) drawEnemy(enemies[i]);

    /* enemy plasma */
    ctx.save();
    for (i = 0; i < ebullets.length; i++) {
      var eb = ebullets[i];
      ctx.shadowColor = '#fb923c';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#fdba74';
      ctx.beginPath();
      ctx.arc(eb.x, eb.y, 4, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    /* player cannon bolts */
    ctx.save();
    ctx.shadowColor = '#a5f3fc';
    ctx.shadowBlur = 10;
    ctx.strokeStyle = '#ecfeff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    for (i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      ctx.beginPath();
      ctx.moveTo(b.x, b.y);
      ctx.lineTo(b.x - 12, b.y - b.vy * 0.012);
      ctx.stroke();
    }
    ctx.restore();

    drawShip();

    for (i = 0; i < bits.length; i++) {
      var bit = bits[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, bit.life / bit.max));
      ctx.fillStyle = bit.colour;
      ctx.fillRect(bit.x - bit.size / 2, bit.y - bit.size / 2, bit.size, bit.size);
    }
    ctx.globalAlpha = 1;

    ctx.save();
    ctx.font = '700 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (i = 0; i < texts.length; i++) {
      var t = texts[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, t.life / t.max));
      ctx.fillStyle = t.colour;
      ctx.fillText(t.txt, t.x, t.y);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    drawStatus();
    ctx.restore();

    /* re-entry flash after a hit */
    if (invuln > 0 && state === 'running') {
      ctx.save();
      ctx.globalAlpha = Math.min(0.22, invuln / 7000);
      ctx.fillStyle = '#f87171';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);
    lastT = t;
    clock += dt;
    if (state === 'running') update(dt);
    driftStars(dt, state === 'running' ? scroll : 90);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;
    if (k === ' ' || k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = true;
    else if (k === ' ' || k === 'Enter') {
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
    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = false;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = false;
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') keys.left = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keys.right = false;
  });

  window.addEventListener('blur', function () {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  var padBtns = document.querySelectorAll('[data-dir]');
  for (var pb = 0; pb < padBtns.length; pb++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over') return;
        keys[dir] = true;
      });
      btn.addEventListener('pointerup', function () { keys[dir] = false; });
      btn.addEventListener('pointerleave', function () { keys[dir] = false; });
      btn.addEventListener('pointercancel', function () { keys[dir] = false; });
    })(padBtns[pb]);
  }

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var ab = 0; ab < actionBtns.length; ab++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[ab]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      keys.up = keys.down = keys.left = keys.right = false;
      if (state === 'running') pause();
    }
  });

  /* ---------------- boot ---------------- */

  dist = 0;
  bonus = 0;
  lives = 3;
  invuln = 0;
  scroll = BASE_SCROLL;
  shake = 0;
  muzzle = 0;
  clock = 0;
  fireMs = 200;
  rockMs = 700;
  enemyMs = 4200;
  powMs = 7000;
  rapidMs = 0;
  spreadMs = 0;
  shield = false;
  bullets = [];
  ebullets = [];
  rocks = [];
  enemies = [];
  powerups = [];
  bits = [];
  texts = [];
  paintHud();
  ensureLoop();

  GameShell.overlay.show({
    title: 'Rift Raider',
    msg: 'Fly with the arrow keys or WASD — your cannon fires on its own. Dodge the rocks, blast the raiders and grab every power-up you can.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
