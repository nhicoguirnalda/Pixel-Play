/* ============================================================
   Skeet Shot — original game for PixelPlay
   Clay-target arcade range. Aim with the mouse / finger and click
   or tap to fire. Two shells per pair, combo multiplier, accuracy
   tracked, three rounds of ten launches each.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 720, H = 460;
  var BEST_KEY = 'skeet-shot';

  var GROUND = H - 34;          /* top edge of the range floor */
  var LAUNCH_Y = H - 30;
  var GRAVITY = 560;            /* px per second squared */
  var TARGET_R = 19;
  var HIT_PAD = 9;              /* a little forgiveness around the disc */

  var TOTAL_ROUNDS = 3;
  var LAUNCHES_PER_ROUND = 10;
  var SHELLS_PER_PAIR = 2;
  var RELOAD_MS = 720;
  var ROUND_BREAK_MS = 1500;
  var ARC_MAX_VY = 660;         /* keeps the apex on screen */

  var state = 'ready';          /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var newBest = false;

  var targets = [];
  var frags = [];
  var tracers = [];
  var pops = [];

  var roundNo = 1;
  var launchesLeft = LAUNCHES_PER_ROUND;
  var shells = SHELLS_PER_PAIR;
  var reloadMs = 0;
  var roundPauseMs = 0;
  var pendingSpawnMs = 0;
  var pendingSide = 1;
  var pendingScale = 1;
  var shots = 0, hits = 0, score = 0, combo = 0;
  var finished = false;

  var aimX = W / 2, aimY = H / 2;
  var recoil = 0, muzzle = 0, shake = 0;
  var banner = '', bannerMs = 0;

  var rafId = 0, lastT = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function accuracy() { return shots ? hits / shots : 0; }

  function shownBest() { return Math.max(best, score); }

  function updateHud() {
    GameShell.hud(
      {
        Score: score,
        Best: shownBest(),
        Accuracy: shots ? Math.round(accuracy() * 100) + '%' : '—'
      },
      state === 'paused' ? '⏸ Paused' : 'Round ' + roundNo
    );
  }

  /* ---------------- setup ---------------- */

  function reset() {
    targets.length = 0;
    frags.length = 0;
    tracers.length = 0;
    pops.length = 0;

    roundNo = 1;
    launchesLeft = LAUNCHES_PER_ROUND;
    shells = SHELLS_PER_PAIR;
    reloadMs = 0;
    roundPauseMs = 0;
    pendingSpawnMs = 0;
    pendingSide = 1;
    pendingScale = 1;
    shots = 0;
    hits = 0;
    score = 0;
    combo = 0;
    finished = false;
    newBest = false;

    aimX = W / 2;
    aimY = H / 2;
    recoil = 0;
    muzzle = 0;
    shake = 0;
    banner = '';
    bannerMs = 0;
  }

  /* ---------------- targets ---------------- */

  function launchClay(side, scale) {
    var vy = clamp(rnd(512, 620) * scale, 0, ARC_MAX_VY);
    targets.push({
      x: W / 2 + rnd(-26, 26),
      y: LAUNCH_Y,
      vx: side * rnd(74, 168) * scale,
      vy: -vy,
      r: TARGET_R,
      rot: 0
    });
  }

  function spawnPair() {
    var side = Math.random() < 0.5 ? -1 : 1;
    var scale = 1 + (roundNo - 1) * 0.08;
    launchClay(side, scale);
    pendingSpawnMs = 190;
    pendingSide = -side;
    pendingScale = scale;
    shells = SHELLS_PER_PAIR;
    reloadMs = 0;
    launchesLeft -= 2;
  }

  function burst(x, y) {
    for (var i = 0; i < 9; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rnd(50, 210);
      frags.push({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 40,
        life: rnd(320, 640), max: 640
      });
    }
  }

  /* ---------------- firing ---------------- */

  function shoot(px, py) {
    if (state !== 'running') return;
    if (reloadMs > 0 || shells <= 0) return;

    shells--;
    shots++;
    muzzle = 90;
    recoil = 7;

    tracers.push({ x1: W / 2, y1: H - 6, x2: px, y2: py, life: 130, max: 130 });

    /* nearest clay inside the hit circle wins */
    var pick = -1, bestD = Infinity;
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var dx = px - t.x, dy = py - t.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d <= t.r + HIT_PAD && d < bestD) { bestD = d; pick = i; }
    }

    if (pick >= 0) {
      var hitT = targets[pick];
      targets.splice(pick, 1);
      hits++;
      combo++;
      var mult = Math.min(5, combo);
      var gain = 100 * mult;
      score += gain;
      burst(hitT.x, hitT.y);
      shake = 8;
      pops.push({
        x: hitT.x, y: hitT.y - 8,
        text: '+' + gain + (mult > 1 ? ' x' + mult : ''),
        life: 820, max: 820, c: '#fbbf24'
      });
      if (combo > 0 && combo % 5 === 0) {
        banner = 'Combo x' + Math.min(5, combo) + '!';
        bannerMs = 1100;
      }
    } else {
      combo = 0;
      pops.push({ x: px, y: py, text: 'miss', life: 560, max: 560, c: '#94a3b8' });
    }

    if (shells <= 0) reloadMs = RELOAD_MS;
    updateHud();
  }

  /* ---------------- state changes ---------------- */

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
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The range is quiet. Reload and step back up when you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Round', value: roundNo },
        { label: 'Accuracy', value: Math.round(accuracy() * 100) + '%' }
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

  function endRound() {
    if (roundNo >= TOTAL_ROUNDS) { finish(); return; }
    roundNo++;
    launchesLeft = LAUNCHES_PER_ROUND;
    roundPauseMs = ROUND_BREAK_MS;
    combo = 0;
    score += 150;
    banner = 'Round ' + roundNo;
    bannerMs = 1400;
    updateHud();
  }

  function finish() {
    finished = true;
    state = 'over';

    var acc = accuracy();
    var bonus = Math.round(acc * 100) * 20;
    score += bonus;

    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Range complete',
      msg: shots === 0
        ? 'You never fired a shell. Final score: ' + score + '. Step up to the line and break a clay next time.'
        : 'You broke ' + hits + ' of ' + shots + ' shell' + (shots === 1 ? '' : 's') +
          ' fired — ' + Math.round(acc * 100) + '% accuracy — good for a ' + bonus +
          ' point bonus. Final score: ' + score + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Accuracy', value: Math.round(acc * 100) + '%' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    if (state !== 'running') return;

    var s = dt / 1000;

    if (bannerMs > 0) bannerMs -= dt;
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 0.05);
    if (muzzle > 0) muzzle -= dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 0.04);

    if (roundPauseMs > 0) roundPauseMs -= dt;

    if (reloadMs > 0) {
      reloadMs -= dt;
      if (reloadMs <= 0) { reloadMs = 0; shells = SHELLS_PER_PAIR; }
    }

    if (pendingSpawnMs > 0) {
      pendingSpawnMs -= dt;
      if (pendingSpawnMs <= 0) {
        pendingSpawnMs = 0;
        launchClay(pendingSide, pendingScale);
      }
    }

    /* clays */
    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i];
      t.vy += GRAVITY * s;
      t.x += t.vx * s;
      t.y += t.vy * s;
      t.rot += s * 6;
      if (t.y - t.r > GROUND + 30 || t.x < -100 || t.x > W + 100) {
        targets.splice(i, 1);
        combo = 0;                 /* a clay that lands unbroken costs the combo */
      }
    }

    /* debris */
    for (var f = frags.length - 1; f >= 0; f--) {
      var fr = frags[f];
      fr.life -= dt;
      if (fr.life <= 0) { frags.splice(f, 1); continue; }
      fr.vy += 420 * s;
      fr.x += fr.vx * s;
      fr.y += fr.vy * s;
      fr.vx *= 0.985;
    }

    /* floating score popups */
    for (var p = pops.length - 1; p >= 0; p--) {
      var po = pops[p];
      po.life -= dt;
      po.y -= 26 * s;
      if (po.life <= 0) pops.splice(p, 1);
    }

    /* shot tracers */
    for (var tr = tracers.length - 1; tr >= 0; tr--) {
      tracers[tr].life -= dt;
      if (tracers[tr].life <= 0) tracers.splice(tr, 1);
    }

    /* line up the next pair, or close out the round */
    if (targets.length === 0 && pendingSpawnMs <= 0 && roundPauseMs <= 0) {
      if (launchesLeft > 0) {
        if (reloadMs <= 0) spawnPair();
      } else {
        endRound();
      }
    }
  }

  /* ---------------- draw ---------------- */

  function drawSky(t) {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1224');
    g.addColorStop(0.5, '#1a1730');
    g.addColorStop(0.82, '#3a2338');
    g.addColorStop(1, '#0a0e1c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* warm horizon glow */
    var hg = ctx.createRadialGradient(W / 2, GROUND, 10, W / 2, GROUND, 330);
    hg.addColorStop(0, 'rgba(249, 115, 22, .20)');
    hg.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = hg;
    ctx.fillRect(0, 0, W, H);

    /* distant hills */
    ctx.fillStyle = 'rgba(12, 18, 36, .85)';
    ctx.beginPath();
    ctx.moveTo(0, GROUND);
    for (var x = 0; x <= W; x += 40) {
      var y = GROUND - 34 - Math.sin(x * 0.011 + 1.4) * 20 - Math.sin(x * 0.031) * 8;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, GROUND);
    ctx.closePath();
    ctx.fill();

    /* drifting dust motes */
    ctx.fillStyle = 'rgba(251, 191, 36, .18)';
    for (var i = 0; i < 24; i++) {
      var mx = (i * 97 + t * 0.02) % W;
      var my = 60 + ((i * 53) % (GROUND - 90));
      ctx.fillRect(mx, my, 2, 2);
    }
  }

  function drawGround() {
    ctx.fillStyle = '#0d1224';
    ctx.fillRect(0, GROUND, W, H - GROUND);

    ctx.strokeStyle = 'rgba(251, 191, 36, .30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 0.5);
    ctx.lineTo(W, GROUND + 0.5);
    ctx.stroke();

    /* lane markings */
    ctx.strokeStyle = 'rgba(251, 191, 36, .10)';
    ctx.lineWidth = 1;
    for (var x = 40; x < W; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND);
      ctx.lineTo(x, H);
      ctx.stroke();
    }

    /* launcher */
    ctx.save();
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = muzzle > 0 ? 30 : 12;
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.moveTo(W / 2 - 22, GROUND + 4);
    ctx.lineTo(W / 2 + 22, GROUND + 4);
    ctx.lineTo(W / 2 + 14, GROUND + 26);
    ctx.lineTo(W / 2 - 14, GROUND + 26);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    if (muzzle > 0) {
      ctx.save();
      ctx.globalAlpha = muzzle / 90;
      ctx.fillStyle = '#fde68a';
      ctx.beginPath();
      ctx.arc(W / 2, GROUND, 22, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawTarget(t2) {
    ctx.save();
    ctx.translate(t2.x, t2.y);
    ctx.rotate(clamp(t2.vx / 420, -0.5, 0.5));
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.ellipse(0, 0, t2.r, t2.r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(120, 53, 15, .55)';
    ctx.beginPath();
    ctx.ellipse(0, 0, t2.r * 0.64, t2.r * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f97316';
    ctx.beginPath();
    ctx.ellipse(0, 0, t2.r * 0.30, t2.r * 0.13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawFrags() {
    for (var i = 0; i < frags.length; i++) {
      var f = frags[i];
      ctx.globalAlpha = Math.max(0, f.life / f.max);
      ctx.fillStyle = i % 3 === 0 ? '#fde68a' : '#f97316';
      ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
  }

  function drawTracers() {
    for (var i = 0; i < tracers.length; i++) {
      var tr = tracers[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, tr.life / tr.max) * 0.85;
      ctx.strokeStyle = '#fde68a';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(tr.x1, tr.y1);
      ctx.lineTo(tr.x2, tr.y2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPops() {
    ctx.save();
    ctx.font = '700 16px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.c;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.restore();
  }

  function drawCrosshair() {
    var reloading = reloadMs > 0;
    var col = reloading ? 'rgba(148, 163, 184, .85)' : 'rgba(251, 191, 36, .95)';
    var r = 14 + recoil;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(aimX, aimY, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(aimX - r - 7, aimY);
    ctx.lineTo(aimX - r + 2, aimY);
    ctx.moveTo(aimX + r - 2, aimY);
    ctx.lineTo(aimX + r + 7, aimY);
    ctx.moveTo(aimX, aimY - r - 7);
    ctx.lineTo(aimX, aimY - r + 2);
    ctx.moveTo(aimX, aimY + r - 2);
    ctx.lineTo(aimX, aimY + r + 7);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.fillRect(aimX - 1, aimY - 1, 2, 2);
    ctx.restore();
  }

  function drawRangeInfo() {
    /* shells */
    ctx.save();
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < SHELLS_PER_PAIR; i++) {
      var loaded = i < shells;
      ctx.fillStyle = loaded ? '#fbbf24' : 'rgba(148, 163, 184, .30)';
      ctx.fillRect(18 + i * 12, 20, 7, 16);
    }
    if (reloadMs > 0) {
      var frac = 1 - clamp(reloadMs / RELOAD_MS, 0, 1);
      ctx.fillStyle = 'rgba(148, 163, 184, .30)';
      ctx.fillRect(18, 44, 46, 5);
      ctx.fillStyle = '#f97316';
      ctx.fillRect(18, 44, 46 * frac, 5);
    } else {
      ctx.fillStyle = 'rgba(232, 238, 252, .55)';
      ctx.fillText('SHELLS', 18, 30);
    }

    /* combo */
    if (combo > 1) {
      ctx.font = '700 15px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText('COMBO x' + Math.min(5, combo), W - 18, 26);
    }
    ctx.restore();
  }

  function drawBanner() {
    if (bannerMs <= 0 || !banner) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, bannerMs / 400);
    ctx.font = '700 30px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 20;
    ctx.fillText(banner, W / 2, 76);
    ctx.restore();
  }

  function drawHint() {
    if (state === 'running' || state === 'over') return;
    ctx.save();
    ctx.font = '600 15px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232, 238, 252, .55)';
    ctx.fillText('Click or tap to fire', W / 2, GROUND - 70);
    ctx.restore();
  }

  function draw(t) {
    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawSky(t);
    drawGround();
    for (var i = 0; i < targets.length; i++) drawTarget(targets[i]);
    drawFrags();
    drawTracers();
    drawPops();
    drawCrosshair();
    drawRangeInfo();
    drawBanner();
    drawHint();
    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = t - lastT;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 50) dt = 50;
    update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pointerPos(e) {
    var rect = canvas.getBoundingClientRect();
    var sx = rect.width ? W / rect.width : 1;
    var sy = rect.height ? H / rect.height : 1;
    return { x: (e.clientX - rect.left) * sx, y: (e.clientY - rect.top) * sy };
  }

  canvas.addEventListener('pointermove', function (e) {
    var p = pointerPos(e);
    aimX = p.x;
    aimY = p.y;
  });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state === 'paused') { resume(); return; }
    var p = pointerPos(e);
    aimX = p.x;
    aimY = p.y;
    shoot(p.x, p.y);
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === ' ') e.preventDefault();

    if (k === ' ' || k === 'Enter') {
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

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var b = 0; b < actionBtns.length; b++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-action') !== 'pause') return;
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Skeet Shot',
    msg: 'Aim with the mouse or your finger and click or tap to fire. You get two shells per pair of clays — break both, build your combo and finish the round with a clean accuracy.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
