/* ============================================================
   Bullet Ballet — original game for PixelPlay
   Single-arena boss bullet-hell. You move a glowing orb with the
   arrow keys / WASD / d-pad while it auto-fires at a boss in the
   centre that cycles ring, spiral and aimed bullet patterns.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var CX = W / 2, CY = H / 2;
  var BEST_KEY = 'bullet-ballet';

  var PAD = 16;                 /* arena wall padding */
  var PLAYER_R = 9;
  var PLAYER_SPEED = 258;       /* px per second */
  var MAX_HP = 100;
  var HIT_DAMAGE = 10;
  var INVULN_MS = 1300;
  var KNOCKBACK = 195;          /* px per second of push */
  var FIRE_MS = 170;            /* auto-fire interval */
  var SHOT_SPEED = 560;
  var SHOT_DMG = 7;
  var SHOT_R = 5;
  var SHOT_SCORE = 10;

  var PHASES = 4;
  var PHASE_HP = 380;
  var BOSS_R = 46;
  var MAX_BULLETS = 460;
  var PATTERN_MS = 6200;        /* how long the boss holds one pattern */

  /* ---------------- mutable game state ---------------- */

  var state = 'ready';          /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var newBest = false;

  var player = { x: CX, y: H - 120, hp: MAX_HP, inv: 0, kx: 0, ky: 0, fireT: 0 };
  var boss = { hp: PHASE_HP, phase: 1, spin: 0, hurt: 0 };
  var bullets = [];             /* enemy bullets */
  var shots = [];               /* our auto-fire bullets */
  var sparks = [];              /* cosmetic debris */

  var pattern = 0;              /* 0 ring | 1 spiral | 2 aimed */
  var PATTERN_SEQ = [0, 2, 1, 2];   /* aimed volleys are the anti-camping beat */
  var patStep = 0;
  var patternT = PATTERN_MS;
  var emitT = 500;
  var spiralA = 0;
  var calmMs = 0;               /* breather after a phase is cleared */
  var score = 0;
  var banner = '', bannerMs = 0;
  var shake = 0;

  var keys = { up: false, down: false, left: false, right: false };
  var rafId = 0, lastT = 0;

  /* ---------------- small helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function rnd(a, b) { return a + Math.random() * (b - a); }

  function shownBest() { return Math.max(best, score); }

  function updateHud() {
    GameShell.hud(
      { Score: score, Best: shownBest(), HP: Math.max(0, Math.round(player.hp)) },
      state === 'paused' ? '⏸ Paused' : 'Boss ' + boss.phase
    );
  }

  function say(msg) { banner = msg; bannerMs = 1500; }

  /* ---------------- setup ---------------- */

  function reset() {
    player.x = CX;
    player.y = H - 120;
    player.hp = MAX_HP;
    player.inv = 0;
    player.kx = 0;
    player.ky = 0;
    player.fireT = 0;
    boss.hp = PHASE_HP;
    boss.phase = 1;
    boss.spin = 0;
    boss.hurt = 0;
    bullets.length = 0;
    shots.length = 0;
    sparks.length = 0;
    pattern = 0;
    patternT = PATTERN_MS;
    emitT = 600;
    spiralA = 0;
    patStep = 0;
    calmMs = 0;
    score = 0;
    banner = '';
    bannerMs = 0;
    shake = 0;
    newBest = false;
    keys.up = keys.down = keys.left = keys.right = false;
  }

  function setPattern(p) {
    pattern = p;
    patternT = PATTERN_MS;
    emitT = 420;
    if (p === 1) spiralA = Math.random() * Math.PI * 2;
  }

  /* ---------------- bullets ---------------- */

  function addBullet(x, y, ang, speed, r, col) {
    if (bullets.length >= MAX_BULLETS) return;
    bullets.push({
      x: x, y: y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed,
      r: r, c: col
    });
  }

  function emit() {
    var ph = boss.phase;
    var col = ph >= 3 ? '#8b5cf6' : '#f472b6';

    if (pattern === 0) {
      /* expanding ring of evenly spaced bullets */
      var n = 10 + ph * 3;
      var off = Math.random() * Math.PI * 2;
      var sp = 124 + ph * 16;
      for (var i = 0; i < n; i++) {
        addBullet(CX, CY, off + (i / n) * Math.PI * 2, sp, 6, col);
      }
      emitT = Math.max(880, 1540 - ph * 140);
    } else if (pattern === 1) {
      /* rotating spiral */
      var step = 0.34 + ph * 0.03;
      addBullet(CX, CY, spiralA, 140 + ph * 14, 6, col);
      if (ph >= 3) addBullet(CX, CY, spiralA + Math.PI, 140 + ph * 12, 6, col);
      spiralA += step;
      emitT = Math.max(58, 108 - ph * 10);
    } else {
      /* spread of aim-assisted shots — tighter so dodging actually matters */
      var base = Math.atan2(player.y - CY, player.x - CX);
      var count = Math.min(6, 2 + ph);
      var spread = 0.22;
      var asp = 185 + ph * 18;
      for (var j = 0; j < count; j++) {
        var t = count === 1 ? 0.5 : j / (count - 1);
        addBullet(CX, CY, base + (t - 0.5) * spread, asp, 6, '#f472b6');
      }
      emitT = Math.max(800, 1270 - ph * 90);
    }
  }

  function spark(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var s = rnd(40, 190);
      sparks.push({
        x: x, y: y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: rnd(240, 520), max: 520, c: col
      });
    }
  }

  function hurtPlayer() {
    player.hp -= HIT_DAMAGE;
    player.inv = INVULN_MS;
    shake = 12;
    spark(player.x, player.y, '#f472b6', 14);
    updateHud();
    if (player.hp <= 0) {
      player.hp = 0;
      gameOver(false);
    }
  }

  function damageBoss(amount) {
    boss.hp -= amount;
    boss.hurt = 90;
    if (boss.hp > 0) return;

    if (boss.phase < PHASES) {
      boss.phase++;
      boss.hp = PHASE_HP;
      bullets.length = 0;         /* clear the floor for the next phase */
      calmMs = 1000;
      score += 250;
      shake = 16;
      say('Phase ' + boss.phase);
      /* open each new phase with an aimed volley, then resume the beat */
      setPattern(2);
      patStep = 1;
      updateHud();
    } else {
      boss.hp = 0;
      gameOver(true);
    }
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
      msg: 'The ballet is frozen mid-step. Resume when you are ready to dance again.',
      stats: [
        { label: 'Score', value: score },
        { label: 'HP', value: Math.max(0, Math.round(player.hp)) },
        { label: 'Boss', value: boss.phase }
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

  function gameOver(won) {
    if (state === 'over') return;
    state = 'over';

    if (won) {
      var bonus = 2000 + Math.round(player.hp) * 5;
      score += bonus;
      say('Victory!');
    }
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: won ? (newBest ? 'Boss defeated — new best!' : 'Boss defeated!')
                 : (newBest ? 'New high score!' : 'Overwhelmed'),
      msg: won
        ? 'You cleared all ' + PHASES + ' phases and finished with ' + Math.max(0, Math.round(player.hp)) +
          ' HP left. Score: ' + score + '.'
        : 'The bullets caught up with you in phase ' + boss.phase + '. Score: ' + score +
          '. Try again — circling beats sprinting.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Boss phase', value: boss.phase }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var s = dt / 1000;

    if (shake > 0) shake = Math.max(0, shake - dt * 0.05);
    if (boss.hurt > 0) boss.hurt -= dt;
    if (bannerMs > 0) bannerMs -= dt;
    boss.spin += s * (0.6 + boss.phase * 0.22);

    /* ---- player movement ---- */
    var dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    var dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
    if (dx && dy) { var norm = 0.7071; dx *= norm; dy *= norm; }

    player.x += dx * PLAYER_SPEED * s + player.kx * s;
    player.y += dy * PLAYER_SPEED * s + player.ky * s;

    /* knockback bleeds off quickly */
    var decay = Math.exp(-s * 6);
    player.kx *= decay;
    player.ky *= decay;

    var lo = PAD + PLAYER_R, hiX = W - PAD - PLAYER_R, hiY = H - PAD - PLAYER_R;
    if (player.x < lo) { player.x = lo; player.kx = 0; }
    if (player.x > hiX) { player.x = hiX; player.kx = 0; }
    if (player.y < lo) { player.y = lo; player.ky = 0; }
    if (player.y > hiY) { player.y = hiY; player.ky = 0; }

    /* keep the orb out of the boss body */
    var bdx = player.x - CX, bdy = player.y - CY;
    var bd = Math.sqrt(bdx * bdx + bdy * bdy);
    var minD = BOSS_R + PLAYER_R + 8;
    if (bd < minD) {
      var ba = bd > 0.001 ? Math.atan2(bdy, bdx) : Math.random() * Math.PI * 2;
      player.x = CX + Math.cos(ba) * minD;
      player.y = CY + Math.sin(ba) * minD;
    }

    if (player.inv > 0) player.inv -= dt;

    /* ---- auto-fire ---- */
    player.fireT -= dt;
    if (player.fireT <= 0) {
      player.fireT = FIRE_MS;
      var a = Math.atan2(CY - player.y, CX - player.x);
      var mx = player.x + Math.cos(a) * (PLAYER_R + 4);
      var my = player.y + Math.sin(a) * (PLAYER_R + 4);
      shots.push({ x: mx, y: my, vx: Math.cos(a) * SHOT_SPEED, vy: Math.sin(a) * SHOT_SPEED, r: SHOT_R });
    }

    /* ---- boss patterns ---- */
    if (calmMs > 0) {
      calmMs -= dt;
    } else {
      patternT -= dt;
      if (patternT <= 0) {
        patStep = (patStep + 1) % PATTERN_SEQ.length;
        setPattern(PATTERN_SEQ[patStep]);
      }
      emitT -= dt;
      if (emitT <= 0) emit();
    }

    /* ---- our shots ---- */
    for (var i = shots.length - 1; i >= 0; i--) {
      var sh = shots[i];
      sh.x += sh.vx * s;
      sh.y += sh.vy * s;
      var bx = sh.x - CX, by = sh.y - CY;
      if (bx * bx + by * by <= (BOSS_R + sh.r) * (BOSS_R + sh.r)) {
        shots.splice(i, 1);
        spark(sh.x, sh.y, '#fde68a', 5);
        score += SHOT_SCORE;
        damageBoss(SHOT_DMG);
        updateHud();
        if (state !== 'running') return;
        continue;
      }
      if (sh.x < -20 || sh.x > W + 20 || sh.y < -20 || sh.y > H + 20) shots.splice(i, 1);
    }

    /* ---- enemy bullets ---- */
    for (var j = bullets.length - 1; j >= 0; j--) {
      var b = bullets[j];
      b.x += b.vx * s;
      b.y += b.vy * s;

      if (player.inv <= 0) {
        var px = b.x - player.x, py = b.y - player.y;
        var rr = PLAYER_R + b.r;
        if (px * px + py * py <= rr * rr) {
          bullets.splice(j, 1);
          /* knock the player away along the bullet's own path */
          var len = Math.sqrt(b.vx * b.vx + b.vy * b.vy) || 1;
          player.kx = (b.vx / len) * KNOCKBACK;
          player.ky = (b.vy / len) * KNOCKBACK;
          hurtPlayer();
          if (state !== 'running') return;
          continue;
        }
      }
      if (b.x < -30 || b.x > W + 30 || b.y < -30 || b.y > H + 30) bullets.splice(j, 1);
    }

    /* ---- sparks ---- */
    for (var k = sparks.length - 1; k >= 0; k--) {
      var sp = sparks[k];
      sp.life -= dt;
      if (sp.life <= 0) { sparks.splice(k, 1); continue; }
      sp.x += sp.vx * s;
      sp.y += sp.vy * s;
      sp.vx *= 0.97;
      sp.vy *= 0.97;
    }
  }

  /* ---------------- draw ---------------- */

  function drawArena(t) {
    var g = ctx.createRadialGradient(CX, CY, 40, CX, CY, W * 0.72);
    g.addColorStop(0, '#141031');
    g.addColorStop(0.55, '#0a0e21');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* concentric guide rings */
    ctx.strokeStyle = 'rgba(139, 92, 246, .10)';
    ctx.lineWidth = 1;
    for (var r = 90; r < W * 0.72; r += 62) {
      ctx.beginPath();
      ctx.arc(CX, CY, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* slow drifting starfield */
    ctx.fillStyle = 'rgba(232, 238, 252, .16)';
    for (var i = 0; i < 46; i++) {
      var a = i * 2.399963;
      var rad = ((i * 37) % 280) + 30;
      var x = CX + Math.cos(a + t / 9000) * rad;
      var y = CY + Math.sin(a + t / 9000) * rad;
      var sz = (i % 3) * 0.5 + 0.7;
      ctx.fillRect(x, y, sz, sz);
    }

    /* arena frame */
    ctx.strokeStyle = 'rgba(244, 114, 182, .16)';
    ctx.lineWidth = 2;
    ctx.strokeRect(PAD - 4.5, PAD - 4.5, W - (PAD - 4.5) * 2, H - (PAD - 4.5) * 2);
  }

  function drawBoss(t) {
    var pulse = 1 + Math.sin(t / 260) * 0.03;
    ctx.save();
    ctx.translate(CX, CY);
    ctx.rotate(boss.spin);

    /* outer petals */
    ctx.strokeStyle = boss.hurt > 0 ? 'rgba(255,255,255,.9)' : 'rgba(139, 92, 246, .75)';
    ctx.lineWidth = 3;
    for (var i = 0; i < 6; i++) {
      var a = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.ellipse(Math.cos(a) * 34, Math.sin(a) * 34, 20, 9, a, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.translate(CX, CY);
    ctx.shadowColor = boss.hurt > 0 ? '#ffffff' : '#8b5cf6';
    ctx.shadowBlur = 34;
    var bg = ctx.createRadialGradient(-12, -14, 4, 0, 0, BOSS_R * pulse);
    bg.addColorStop(0, '#ffffff');
    bg.addColorStop(0.4, boss.hurt > 0 ? '#fbcfe8' : '#f472b6');
    bg.addColorStop(1, '#6d28d9');
    ctx.fillStyle = bg;
    ctx.beginPath();
    ctx.arc(0, 0, BOSS_R * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* health bar */
    var bw = W - 96, bx = 48, by = 16, bh = 12;
    var frac = clamp(boss.hp / PHASE_HP, 0, 1);
    ctx.fillStyle = 'rgba(232,238,252,.10)';
    ctx.fillRect(bx, by, bw, bh);
    var hg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    hg.addColorStop(0, '#f472b6');
    hg.addColorStop(1, '#8b5cf6');
    ctx.fillStyle = hg;
    ctx.fillRect(bx, by, bw * frac, bh);
    ctx.strokeStyle = 'rgba(232,238,252,.22)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);

    ctx.save();
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(232,238,252,.68)';
    ctx.fillText('BOSS · PHASE ' + boss.phase + ' OF ' + PHASES, CX, by + bh + 6);
    ctx.restore();
  }

  function drawPlayer(t) {
    if (state === 'over' && player.hp <= 0) return;
    var blink = player.inv > 0 && Math.floor(t / 90) % 2 === 0;
    ctx.save();
    ctx.globalAlpha = blink ? 0.4 : 1;
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 30;
    var pg = ctx.createRadialGradient(player.x - 3, player.y - 3, 1, player.x, player.y, PLAYER_R + 3);
    pg.addColorStop(0, '#ffffff');
    pg.addColorStop(0.5, '#67e8f9');
    pg.addColorStop(1, '#0891b2');
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(player.x, player.y, PLAYER_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    /* invulnerability halo */
    if (player.inv > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(103, 232, 249, .5)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(player.x, player.y, PLAYER_R + 7, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    /* player HP strip along the bottom */
    var frac = clamp(player.hp / MAX_HP, 0, 1);
    var bx = 48, bw = W - 96, by = H - 26, bh = 8;
    ctx.fillStyle = 'rgba(232,238,252,.10)';
    ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = frac > 0.5 ? '#22d3ee' : (frac > 0.25 ? '#fbbf24' : '#f43f5e');
    ctx.fillRect(bx, by, bw * frac, bh);
  }

  function drawShots() {
    ctx.save();
    ctx.shadowColor = '#fde68a';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#fef3c7';
    for (var i = 0; i < shots.length; i++) {
      var s2 = shots[i];
      ctx.beginPath();
      ctx.arc(s2.x, s2.y, s2.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawBullets() {
    for (var i = 0; i < bullets.length; i++) {
      var b = bullets[i];
      ctx.save();
      ctx.shadowColor = b.c;
      ctx.shadowBlur = 12;
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.8)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.32, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSparks() {
    for (var i = 0; i < sparks.length; i++) {
      var s2 = sparks[i];
      ctx.globalAlpha = Math.max(0, s2.life / s2.max);
      ctx.fillStyle = s2.c;
      ctx.fillRect(s2.x - 1.5, s2.y - 1.5, 3, 3);
    }
    ctx.globalAlpha = 1;
  }

  function drawBanner() {
    if (bannerMs <= 0 || !banner) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, bannerMs / 400);
    ctx.font = '700 34px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fde68a';
    ctx.shadowColor = '#f472b6';
    ctx.shadowBlur = 22;
    ctx.fillText(banner, CX, CY - 96);
    ctx.restore();
  }

  function draw(t) {
    ctx.save();
    if (shake > 0.5) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    drawArena(t);
    drawBoss(t);
    drawShots();
    drawBullets();
    drawSparks();
    drawPlayer(t);
    drawBanner();
    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = t - lastT;
    lastT = t;
    if (dt < 0) dt = 0;
    if (dt > 50) dt = 50;              /* cap so tab jumps never teleport */
    if (state === 'running') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function setDir(name, on) {
    if (name === 'up') keys.up = on;
    else if (name === 'down') keys.down = on;
    else if (name === 'left') keys.left = on;
    else if (name === 'right') keys.right = on;
  }

  function steer(name) {
    if (state === 'ready' || state === 'over') start();
    setDir(name, true);
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
      e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') steer('up');
    else if (k === 'ArrowDown' || k === 's' || k === 'S') steer('down');
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') steer('left');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') steer('right');
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

  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over') { start(); return; }
        setDir(dir, true);
      });
      btn.addEventListener('pointerup', function () { setDir(dir, false); });
      btn.addEventListener('pointercancel', function () { setDir(dir, false); });
      btn.addEventListener('pointerleave', function () { setDir(dir, false); });
    })(padBtns[b]);
  }

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'ready' || state === 'over') start();
    else if (state === 'running') pause();
    else if (state === 'paused') resume();
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var c = 0; c < actionBtns.length; c++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        if (btn.getAttribute('data-action') !== 'pause') return;
        if (state === 'running') pause();
        else if (state === 'paused') resume();
      });
    })(actionBtns[c]);
  }

  window.addEventListener('blur', function () {
    keys.up = keys.down = keys.left = keys.right = false;
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    keys.up = keys.down = keys.left = keys.right = false;
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Bullet Ballet',
    msg: 'Move with the arrow keys, WASD or the pad below — your orb fires by itself. Dodge the rings, spirals and aimed volleys while you wear the boss down through four phases.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
