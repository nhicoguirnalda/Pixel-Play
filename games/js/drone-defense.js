/* ============================================================
   Drone Defense — original game for PixelPlay
   Top-down arena defence: WASD moves the robot, the mouse aims
   an auto-firing blaster. Drones pour in from every edge.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 640, H = 480;
  var BEST_KEY = 'drone-defense';

  var state = 'ready';               /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var rafId = 0, lastT = 0, newBest = false;

  var score = 0, hp = 100, wave = 1;
  var player = { x: W / 2, y: H / 2, r: 14 };
  var aim = { x: W / 2, y: 0 };
  var keys = { left: false, right: false, up: false, down: false };
  var firing = false, autoFire = true;

  var drones = [], bullets = [], sparks = [], spawnQueue = [];
  var spawnCd = 0, invuln = 0, fireCd = 0;
  var between = false, waveGap = 0;

  var PLAYER_SPEED = 3.5;            /* px per 60fps frame */
  var BULLET_SPEED = 10.5;
  var FIRE_MS = 185;
  var CONTACT_PUSH = 30;

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
      var s = rnd(0.5, 3.6) * (power || 1);
      sparks.push({
        x: x, y: y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rnd(240, 600), max: 600, r: rnd(1.4, 3.4), color: color
      });
    }
  }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), HP: Math.max(0, hp) },
      state === 'paused' ? '⏸ Paused' : 'Wave ' + wave
    );
  }

  /* ---------------- waves ---------------- */

  var TYPES = {
    basic: { r: 15, hp: 2, speed: 0.92, cap: 2.1, score: 100, dmg: 10, color: '#a3e635' },
    fast:  { r: 11, hp: 1, speed: 1.62, cap: 2.9, score: 150, dmg: 7,  color: '#22d3ee' },
    tank:  { r: 22, hp: 6, speed: 0.62, cap: 1.35, score: 250, dmg: 15, color: '#f59e0b' }
  };

  function queueWave() {
    spawnQueue = [];
    var n = Math.min(22, 3 + wave * 2);
    for (var i = 0; i < n; i++) {
      var roll = Math.random();
      var type = 'basic';
      if (wave >= 3 && roll < 0.24) type = 'fast';
      if (wave >= 5 && roll > 0.82) type = 'tank';
      spawnQueue.push(type);
    }
    spawnCd = 420;
  }

  function spawnDrone(type) {
    var def = TYPES[type];
    var m = def.r + 10;
    var edge = Math.floor(Math.random() * 4);
    var x, y;
    if (edge === 0) { x = rnd(m, W - m); y = -m; }
    else if (edge === 1) { x = W + m; y = rnd(m, H - m); }
    else if (edge === 2) { x = rnd(m, W - m); y = H + m; }
    else { x = -m; y = rnd(m, H - m); }

    drones.push({
      x: x, y: y, r: def.r,
      hp: def.hp, maxHp: def.hp,
      speed: Math.min(def.cap, def.speed + wave * 0.035),
      score: def.score, dmg: def.dmg, color: def.color,
      hitFlash: 0, wob: Math.random() * Math.PI * 2
    });
  }

  /* ---------------- shooting ---------------- */

  function shoot() {
    var a = Math.atan2(aim.y - player.y, aim.x - player.x);
    bullets.push({
      x: player.x + Math.cos(a) * 18,
      y: player.y + Math.sin(a) * 18,
      vx: Math.cos(a) * BULLET_SPEED,
      vy: Math.sin(a) * BULLET_SPEED,
      r: 4
    });
  }

  function damageDrone(idx) {
    var d = drones[idx];
    d.hp -= 1;
    d.hitFlash = 80;
    if (d.hp > 0) { spark(d.x, d.y, 4, d.color, 0.6); return; }

    score += d.score;
    spark(d.x, d.y, 18, d.color, 1.1);
    drones.splice(idx, 1);
    updateHud();
  }

  function hurtPlayer(d) {
    if (state !== 'running' || invuln > 0) return false;

    hp -= d.dmg;
    invuln = 1500;
    spark(player.x, player.y, 22, '#f87171', 1.2);

    /* shove the robot away from the drone so it isn't trapped */
    var ax = player.x - d.x, ay = player.y - d.y;
    var len = Math.sqrt(ax * ax + ay * ay) || 1;
    player.x = clamp(player.x + (ax / len) * CONTACT_PUSH, player.r, W - player.r);
    player.y = clamp(player.y + (ay / len) * CONTACT_PUSH, player.r, H - player.r);
    /* and knock the drone back too, so a single rammer cannot pin you down */
    d.x -= (ax / len) * CONTACT_PUSH * 0.6;
    d.y -= (ay / len) * CONTACT_PUSH * 0.6;

    updateHud();
    if (hp <= 0) { hp = 0; gameOver(); }
    return true;
  }

  /* ---------------- state changes ---------------- */

  function reset() {
    score = 0; hp = 100; wave = 1; newBest = false;
    player.x = W / 2; player.y = H / 2;
    drones = []; bullets = []; sparks = []; spawnQueue = [];
    keys.left = keys.right = keys.up = keys.down = false;
    firing = false;
    spawnCd = 0; invuln = 1500; fireCd = 0;
    between = false; waveGap = 0;
    aim.x = W / 2; aim.y = 0;
    queueWave();
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
    firing = false;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The arena is on hold. Resume when you are ready to face the swarm again.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'HP', value: Math.max(0, hp) }
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
      title: newBest ? 'New high score!' : 'Robot down',
      msg: 'You survived to wave ' + wave + ' and scored ' + score + ' points. Give the drones another go.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Wave', value: wave },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt, k) {
    if (invuln > 0) invuln -= dt;

    var dx = 0, dy = 0;
    if (keys.left) dx -= 1;
    if (keys.right) dx += 1;
    if (keys.up) dy -= 1;
    if (keys.down) dy += 1;
    if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
    player.x = clamp(player.x + dx * PLAYER_SPEED * k, player.r, W - player.r);
    player.y = clamp(player.y + dy * PLAYER_SPEED * k, player.r, H - player.r);

    /* auto / held fire toward the cursor */
    fireCd -= dt;
    if (fireCd <= 0 && (firing || autoFire)) {
      fireCd = FIRE_MS;
      shoot();
    }

    /* bullets */
    for (var i = bullets.length - 1; i >= 0; i--) {
      var b = bullets[i];
      b.x += b.vx * k;
      b.y += b.vy * k;
      if (b.x < -20 || b.x > W + 20 || b.y < -20 || b.y > H + 20) {
        bullets.splice(i, 1);
        continue;
      }
      for (var j = drones.length - 1; j >= 0; j--) {
        var t = drones[j];
        var ddx = b.x - t.x, ddy = b.y - t.y;
        if (ddx * ddx + ddy * ddy < (t.r + b.r) * (t.r + b.r)) {
          bullets.splice(i, 1);
          damageDrone(j);
          break;
        }
      }
    }

    /* drones chase the robot */
    for (var e = 0; e < drones.length; e++) {
      var d = drones[e];
      if (d.hitFlash > 0) d.hitFlash -= dt;
      d.wob += 0.05 * k;

      var ax = player.x - d.x, ay = player.y - d.y;
      var len = Math.sqrt(ax * ax + ay * ay) || 1;
      d.x += (ax / len) * d.speed * k;
      d.y += (ay / len) * d.speed * k;
    }

    /* gentle separation so the swarm does not stack into one dot */
    for (var a = 0; a < drones.length; a++) {
      for (var c = a + 1; c < drones.length; c++) {
        var da = drones[a], dc = drones[c];
        var sx = dc.x - da.x, sy = dc.y - da.y;
        var dist2 = sx * sx + sy * sy;
        var want = (da.r + dc.r) * (da.r + dc.r);
        if (dist2 > 0.01 && dist2 < want) {
          var dist = Math.sqrt(dist2);
          var push = ((da.r + dc.r) - dist) * 0.16;
          var nx = sx / dist, ny = sy / dist;
          da.x -= nx * push; da.y -= ny * push;
          dc.x += nx * push; dc.y += ny * push;
        }
      }
    }

    /* contact damage */
    for (var q = drones.length - 1; q >= 0; q--) {
      var dr = drones[q];
      var hx = player.x - dr.x, hy = player.y - dr.y;
      if (hx * hx + hy * hy < (player.r + dr.r) * (player.r + dr.r)) {
        hurtPlayer(dr);
        if (state !== 'running') return;
      }
    }

    /* trickle the wave in */
    if (spawnQueue.length) {
      spawnCd -= dt;
      if (spawnCd <= 0) {
        spawnCd = 400;
        spawnDrone(spawnQueue.shift());
      }
    }

    /* sparks */
    for (var s = sparks.length - 1; s >= 0; s--) {
      var sk = sparks[s];
      sk.x += sk.vx * k;
      sk.y += sk.vy * k;
      sk.vx *= 0.96;
      sk.vy *= 0.96;
      sk.life -= dt;
      if (sk.life <= 0) sparks.splice(s, 1);
    }

    /* wave progression */
    if (!spawnQueue.length && !drones.length) {
      if (!between) {
        between = true;
        waveGap = 1600;
        score += 150 + wave * 75;
        updateHud();
      } else {
        waveGap -= dt;
        if (waveGap <= 0) {
          between = false;
          wave++;
          queueWave();
          hp = Math.min(100, hp + 12);      /* a clean wave patches the robot */
          updateHud();
        }
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawArena() {
    var g = ctx.createRadialGradient(W / 2, H / 2, 40, W / 2, H / 2, W * 0.72);
    g.addColorStop(0, '#0d1526');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (var x = 40; x < W; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, H);
      ctx.stroke();
    }
    for (var y = 40; y < H; y += 40) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(W, y + 0.5);
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(34,211,238,.35)';
    ctx.lineWidth = 2;
    ctx.strokeRect(3, 3, W - 6, H - 6);
  }

  function drawRobot(t) {
    var blink = invuln > 0 && Math.floor(t / 90) % 2 === 0;
    var a = Math.atan2(aim.y - player.y, aim.x - player.x);

    /* blaster barrel */
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(a);
    ctx.fillStyle = '#a3e635';
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 10;
    ctx.fillRect(6, -3.5, 18, 7);
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 16;
    ctx.fillStyle = blink ? '#ecfccb' : '#65a30d';
    roundRect(-14, -14, 28, 28, 8);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.fillStyle = '#05070e';
    roundRect(-8, -8, 16, 16, 4);
    ctx.fill();
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(-3.5, -2, 2.6, 0, Math.PI * 2);
    ctx.arc(3.5, -2, 2.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (invuln > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(252,211,77,.75)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, 22 + Math.sin(t / 200) * 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawDrone(d) {
    var hurt = d.hitFlash > 0;

    ctx.save();
    ctx.shadowColor = hurt ? '#ffffff' : d.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = hurt ? '#ffffff' : d.color;
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#05070e';
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r * 0.46, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = hurt ? '#05070e' : d.color;
    ctx.beginPath();
    ctx.arc(d.x + Math.cos(d.wob) * d.r * 0.2,
            d.y + Math.sin(d.wob) * d.r * 0.2, d.r * 0.2, 0, Math.PI * 2);
    ctx.fill();

    /* health pips on the tougher drones */
    if (d.maxHp > 1) {
      var frac = Math.max(0, d.hp / d.maxHp);
      ctx.strokeStyle = 'rgba(232,238,252,.8)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
      ctx.stroke();
    }
  }

  function drawCrosshair(t) {
    var x = clamp(aim.x, 0, W), y = clamp(aim.y, 0, H);
    ctx.save();
    ctx.strokeStyle = 'rgba(163,230,53,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 11 + Math.sin(t / 260) * 1.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 18, y); ctx.lineTo(x - 5, y);
    ctx.moveTo(x + 5, y);  ctx.lineTo(x + 18, y);
    ctx.moveTo(x, y - 18); ctx.lineTo(x, y - 5);
    ctx.moveTo(x, y + 5);  ctx.lineTo(x, y + 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawBanner() {
    if (!between) return;
    ctx.save();
    ctx.font = '800 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232,238,252,.92)';
    ctx.fillText('Wave ' + (wave + 1), W / 2, H / 2 - 12);
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText('Incoming drones…', W / 2, H / 2 + 20);
    ctx.restore();
  }

  function draw(t) {
    drawArena();

    for (var i = 0; i < drones.length; i++) drawDrone(drones[i]);

    ctx.save();
    ctx.shadowColor = '#a3e635';
    ctx.shadowBlur = 10;
    for (var b = 0; b < bullets.length; b++) {
      ctx.fillStyle = '#d9f99d';
      ctx.beginPath();
      ctx.arc(bullets[b].x, bullets[b].y, bullets[b].r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    if (state !== 'over') drawRobot(t);

    for (var q = 0; q < sparks.length; q++) {
      var sk = sparks[q];
      ctx.globalAlpha = Math.max(0, Math.min(1, sk.life / sk.max));
      ctx.fillStyle = sk.color;
      ctx.beginPath();
      ctx.arc(sk.x, sk.y, sk.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (state === 'running') drawCrosshair(t);
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

  function pointerToArena(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  canvas.addEventListener('pointermove', function (e) {
    var p = pointerToArena(e);
    aim.x = p.x; aim.y = p.y;
  });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    var p = pointerToArena(e);
    aim.x = p.x; aim.y = p.y;
    firing = true;
    if (state === 'ready' || state === 'over') start();
  });

  document.addEventListener('pointerup', function () { firing = false; });

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

  reset();
  state = 'ready';
  ensureLoop();
  GameShell.overlay.show({
    title: 'Drone Defense',
    msg: 'Drive the robot with WASD and aim with the mouse — the blaster fires on its own. Drones charge in from every edge, so keep moving and clear each wave.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
