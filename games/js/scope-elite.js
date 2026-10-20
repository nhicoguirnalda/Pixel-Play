/* ============================================================
   Scope Elite — original game for PixelPlay
   Canvas first-person long-range precision missions: steady the
   scope, time your breath and pick off roaming robots before
   they cross the valley or the mission clock runs out.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';

  var W = 720, H = 420;
  var HORIZON = 196;              /* where sky meets ground */
  var MAG = 5;                    /* rounds per magazine */
  var RELOAD_TIME = 1.5;          /* seconds */
  var MISSION_TIME = 60;          /* seconds per mission */
  var MISSION_QUOTA = [6, 9, 12]; /* bots to down per mission */
  var MAX_ALIVE = [3, 4, 5];
  var INTEGRITY = 3;              /* escapes the watchtower can absorb */
  var ZOOM = 2.4;                 /* scope magnification */
  var BEST_KEY = 'scope-elite';
  var TAU = Math.PI * 2;

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

  /* day, dusk and night colour schemes, one per mission */
  var PALS = [
    { skyTop: '#3f7fbe', skyBot: '#b7dcf2', sun: '#fff3c4', sunGlow: 'rgba(255,243,196,.5)',
      ridgeFar: '#6f93b4', ridgeNear: '#4d6f8e', groundA: '#4c7a44', groundB: '#25401f',
      fog: 'rgba(183,220,242,.28)', bot: '#aebdd0' },
    { skyTop: '#5b3f96', skyBot: '#f0a45f', sun: '#ffd9a0', sunGlow: 'rgba(255,217,160,.45)',
      ridgeFar: '#7a5f92', ridgeNear: '#55406b', groundA: '#6b5a36', groundB: '#33281a',
      fog: 'rgba(240,164,95,.24)', bot: '#b8b0c8' },
    { skyTop: '#0b1a33', skyBot: '#274b73', sun: '#dfe9f8', sunGlow: 'rgba(223,233,248,.35)',
      ridgeFar: '#2c4361', ridgeNear: '#1d3049', groundA: '#22364a', groundB: '#101c2a',
      fog: 'rgba(39,75,115,.3)', bot: '#93a7c4' }
  ];

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over */
  var score = 0, best = GameShell.best.get(BEST_KEY, 0);
  var mission = 1, kills = 0, quota = MISSION_QUOTA[0];
  var timeLeft = MISSION_TIME;
  var integrity = INTEGRITY;
  var ammo = MAG, reloadT = 0;
  var shots = 0, hits = 0, streak = 0;
  var crossX = W / 2, crossY = H * 0.55;   /* aim point before sway/spread */
  var shiftHeld = false, rmBtn = false, scopeLock = false;
  var breath = 100, gasp = 0;
  var camX = 0;                  /* parallax offset driven by the crosshair */
  var kick = 0, muzzle = 0, shake = 0, hurtFlash = 0;
  var banner = 0, bannerText = '';
  var intermission = 0;          /* pause between missions */
  var fireCool = 0;
  var spawnTimer = 0;
  var targets = [], particles = [], pops = [];
  var ridge = [], mids = [], clouds = [], rocks = [];
  var keys = { fire: false, jump: false };
  var rafId = 0, last = 0;
  var touchFire = false, tapStart = null;

  /* Jump / gravity: a vertical hop of the watchtower viewpoint */
  var JUMP_VEL = 2.6, GRAVITY = 11.5;
  var playerZ = 0, playerVz = 0, onGround = true;
  var VIEW_LIFT = 150;            /* screen px per world unit of hop */

  /* ---------------- helpers ---------------- */

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

  function accuracy() {
    return shots ? Math.round((hits / shots) * 100) : 0;
  }

  function shownBest() { return Math.max(best, score || 0); }

  function aimSway(t) {
    if (!scopedNow()) return { x: 0, y: 0 };
    var amp = 2.6 + (1 - breath / 100) * 17;
    if (!onGround) amp *= 1.9;                 /* jumping spoils the shot */
    return {
      x: (Math.sin(t * 1.6) + 0.55 * Math.sin(t * 3.1 + 1.3)) * amp,
      y: (Math.cos(t * 1.25) + 0.5 * Math.sin(t * 2.4)) * amp * 0.7
    };
  }

  function scopedNow() {
    return (shiftHeld || rmBtn || scopeLock) && breath > 0 && gasp <= 0 &&
           (state === 'running' || state === 'paused');
  }

  function burst(x, y, col, n, spd) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = (spd || 60) + Math.random() * 190;
      var life = 0.35 + Math.random() * 0.45;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s - 40,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.6,
        col: col
      });
    }
    if (particles.length > 300) particles.splice(0, particles.length - 300);
  }

  function pop(x, y, text, col) {
    pops.push({ x: x, y: y, text: text, col: col, t: 1 });
    if (pops.length > 24) pops.splice(0, pops.length - 24);
  }

  /* ---------------- scene seed ---------------- */

  function seedScene() {
    var i, x;
    ridge = [];
    x = -160;
    while (x < W * 2 + 160) {
      var w = 70 + Math.random() * 130;
      ridge.push({ x: x, y: HORIZON - 26 - Math.random() * 66, w: w });
      x += w * 0.72;
    }
    mids = [];
    x = -60;
    while (x < W * 1.5 + 60) {
      var kind = Math.random() < 0.55 ? 'tower' : 'wall';
      mids.push({
        x: x, w: 26 + Math.random() * 44,
        h: 30 + Math.random() * 54, kind: kind
      });
      x += 90 + Math.random() * 150;
    }
    clouds = [];
    for (i = 0; i < 5; i++) {
      clouds.push({
        x: Math.random() * W, y: 30 + Math.random() * 90,
        w: 90 + Math.random() * 110, s: 4 + Math.random() * 8,
        p: Math.random() * TAU
      });
    }
    rocks = [];
    for (i = 0; i < 7; i++) {
      rocks.push({
        x: Math.random() * W, w: 30 + Math.random() * 46,
        h: 12 + Math.random() * 12, d: 0.55 + Math.random() * 0.25
      });
    }
  }

  /* ---------------- projection ---------------- */

  function projScale(depth) { return 1.06 - depth * 0.73; }

  function projBaseY(depth) { return HORIZON + 196 * projScale(depth); }

  function projShift(depth) { return camX * (1 - depth * 0.82); }

  /* fill in screen-space geometry for one target */
  function project(tg) {
    tg.s = projScale(tg.depth);
    tg.cx = tg.planeX + projShift(tg.depth);
    tg.baseY = projBaseY(tg.depth);
    tg.sw = 44 * tg.s;
    tg.sh = 86 * tg.s;
    tg.sx = tg.cx - tg.sw / 2;
    tg.sy = tg.baseY - tg.sh;
  }

  /* ---------------- targets ---------------- */

  function spawnTarget() {
    var depth = 0.14 + Math.random() * 0.8;
    var hiderChance = mission === 1 ? 0.25 : 0.42;
    var kind = Math.random() < hiderChance ? 'hider' : 'walker';
    var dir = Math.random() < 0.5 ? -1 : 1;
    var speed = (175 - depth * 112) * (1 + (mission - 1) * 0.2);
    var planeX = dir > 0 ? -130 : W + 130;
    var tg = {
      kind: kind, depth: depth, dir: dir, speed: speed,
      planeX: planeX, walk: Math.random() * TAU,
      coverX: 90 + Math.random() * (W - 180),
      behindCover: false, coverT: 0, wob: Math.random() * TAU
    };
    project(tg);
    targets.push(tg);
  }

  function liveCount() {
    var n = 0;
    for (var i = 0; i < targets.length; i++) if (!targets[i].dead) n++;
    return n;
  }

  /* ---------------- HUD + states ---------------- */

  function updateHud() {
    var hint = (streak > 1 ? '🔥 ' + streak + ' streak · ' : '') + accuracy() + '% acc';
    GameShell.hud(
      {
        Score: score || 0,
        Best: shownBest(),
        Time: Math.max(0, Math.ceil(timeLeft)) + 's',
        Ammo: reloadT > 0 ? '…' : ammo + '/' + MAG
      },
      state === 'paused' ? '⏸ Paused · Mission ' + mission
        : (document.pointerLockElement !== canvas ? '🖱 Move to aim · click or F to fire · Space jump' : hint + ' · Space = Jump')
    );
  }

  function reset() {
    score = 0; mission = 1; kills = 0; quota = MISSION_QUOTA[0];
    timeLeft = MISSION_TIME; integrity = INTEGRITY;
    ammo = MAG; reloadT = 0;
    shots = 0; hits = 0; streak = 0;
    crossX = W / 2; crossY = H * 0.55;
    shiftHeld = false; rmBtn = false; breath = 100; gasp = 0;
    kick = 0; muzzle = 0; shake = 0; hurtFlash = 0;
    fireCool = 0;
    playerZ = 0; playerVz = 0; onGround = true;
    banner = 0; bannerText = ''; intermission = 0;
    spawnTimer = 0.4;
    targets = []; particles = []; pops = [];
    keys.fire = false; keys.jump = false;
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
    keys.fire = false;
    try {
      if (document.exitPointerLock && document.pointerLockElement === canvas) document.exitPointerLock();
    } catch (e) { /* ignore */ }
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Take a breath. The valley will wait for you.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Mission', value: mission },
        { label: 'Time', value: Math.max(0, Math.ceil(timeLeft)) + 's' },
        { label: 'Integrity', value: integrity }
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

  function finish(win, reason) {
    if (state === 'over') return;
    state = 'over';
    keys.fire = false;
    shiftHeld = rmBtn = scopeLock = false;
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: win ? 'Range cleared!' : (isBest ? 'New high score!' : reason),
      msg: win
        ? 'All three missions complete with ' + score + ' points and ' +
          accuracy() + '% accuracy. The valley is quiet again.'
        : reason === 'Time up'
          ? 'The mission clock hit zero on mission ' + mission + '. You scored ' +
            score + ' point' + (score === 1 ? '' : 's') + '.'
          : 'Too many bots crossed the valley — the watchtower fell on mission ' +
            mission + '. You scored ' + score + ' point' + (score === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Mission', value: mission },
        { label: 'Accuracy', value: accuracy() + '%' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function nextMission() {
    mission++;
    kills = 0;
    quota = MISSION_QUOTA[mission - 1];
    timeLeft = MISSION_TIME;
    targets = [];
    spawnTimer = 0.6;
    bannerText = 'MISSION ' + mission;
    banner = 2;
    updateHud();
  }

  function missionClear() {
    var bonus = Math.floor(Math.max(0, timeLeft)) * 5;
    score += bonus;
    if (mission >= 3) {
      updateHud();
      finish(true, 'win');
      return;
    }
    bannerText = 'MISSION CLEAR  +' + bonus;
    banner = 2.2;
    intermission = 2.2;
    targets = [];
    updateHud();
  }

  function escapeBot() {
    integrity--;
    streak = 0;
    hurtFlash = 1;
    shake = 12;
    pop(W / 2, 96, 'BOT ESCAPED  −1 INTEGRITY', '#ff8d9f');
    if (integrity <= 0) {
      integrity = 0;
      updateHud();
      finish(false, 'Watchtower overrun');
      return;
    }
    updateHud();
  }

  /* ---------------- firing ---------------- */

  function fire() {
    if (state !== 'running' || reloadT > 0 || ammo <= 0 || intermission > 0) return;
    if (fireCool > 0) return;

    var t = now() / 1000;
    var sw = aimSway(t);
    ammo--;
    shots++;
    fireCool = 0.24;
    muzzle = 1;
    kick = 1;
    shake = Math.max(shake, 3);

    var ax, ay;
    var lift = playerZ * VIEW_LIFT;         /* scene is shifted down while airborne */
    if (scopedNow()) {
      ax = crossX + sw.x;
      ay = crossY + sw.y;
    } else {
      ax = crossX + (Math.random() - 0.5) * 92;
      ay = crossY + (Math.random() - 0.5) * 64 - 6;
    }
    ax = clamp(ax, 4, W - 4);
    ay = clamp(ay, 4, H - 4);

    var bestHit = null, bestDepth = 2, antenna = false;
    for (var i = 0; i < targets.length; i++) {
      var tg = targets[i];
      if (tg.dead || tg.behindCover) continue;
      var drop = tg.depth * 30;             /* distant shots need uphold */
      if (ax < tg.sx || ax > tg.sx + tg.sw) continue;
      if (ay < tg.sy + lift - drop || ay > tg.baseY + lift) continue;
      if (tg.depth < bestDepth) {
        bestDepth = tg.depth;
        bestHit = tg;
        antenna = ay <= tg.sy + tg.sh * 0.2;
      }
    }

    if (bestHit) {
      hits++;
      streak++;
      kills++;
      var pts = 60 + Math.round(bestHit.depth * 60);
      if (antenna) pts *= 2;
      var bonus = Math.min(streak - 1, 5) * 10;
      score += pts + bonus;
      bestHit.dead = true;
      var hx = bestHit.cx;
      var hy = bestHit.sy + bestHit.sh * 0.5;
      burst(hx, hy, antenna ? '#fcd34d' : '#93c5fd', 18, 70);
      pop(hx, hy - 10, '+' + (pts + bonus) + (antenna ? ' ANTENNA!' : '') +
          (bonus ? ' ×' + streak : ''), antenna ? '#fcd34d' : '#dffbff');
      updateHud();
    } else {
      if (streak > 0) streak = 0;
      burst(ax, ay, 'rgba(207,227,255,.8)', 4, 30);
      updateHud();
    }

    if (ammo <= 0) reloadT = RELOAD_TIME;
  }

  /* ---------------- update ---------------- */

  function update(dt, t) {
    var i;

    /* jump / gravity: a hop of the watchtower viewpoint */
    if (keys.jump && onGround) {
      playerVz = JUMP_VEL;
      onGround = false;
      keys.jump = false;
    }
    playerZ += playerVz * dt;
    playerVz -= GRAVITY * dt;
    if (playerZ < 0) {
      playerZ = 0;
      playerVz = 0;
      onGround = true;
      updateHud();
    }

    /* breath + scope */
    if (gasp > 0) gasp -= dt;
    if (scopedNow()) {
      breath -= 30 * dt;
      if (breath <= 0) {
        breath = 0;
        gasp = 1.1;
        pop(crossX, crossY - 30, 'GASP!', '#fca5a5');
      }
    } else {
      breath = Math.min(100, breath + 22 * dt);
    }

    /* reload */
    if (reloadT > 0) {
      reloadT -= dt;
      if (reloadT <= 0) {
        reloadT = 0;
        ammo = MAG;
        updateHud();
      }
    }

    /* fire cooldown via held Space / touch button */
    if (fireCool > 0) fireCool -= dt;
    if ((keys.fire || touchFire) && reloadT <= 0 && ammo > 0) fire();

    /* camera parallax follows the crosshair */
    camX = (crossX / W - 0.5) * 70;

    /* intermission between missions */
    if (intermission > 0) {
      intermission -= dt;
      if (intermission <= 0) nextMission();
      stepParticles(dt);
      return;
    }

    /* mission clock */
    timeLeft -= dt;
    if (timeLeft <= 0) {
      timeLeft = 0;
      updateHud();
      finish(false, 'Time up');
      return;
    }

    /* spawning */
    spawnTimer -= dt;
    if (spawnTimer <= 0 && liveCount() < MAX_ALIVE[mission - 1]) {
      spawnTarget();
      spawnTimer = (mission === 1 ? 1.7 : mission === 2 ? 1.3 : 1.0) *
                   (0.7 + Math.random() * 0.7);
    }

    /* targets */
    for (i = targets.length - 1; i >= 0; i--) {
      var tg = targets[i];
      if (tg.dead) { targets.splice(i, 1); continue; }

      if (tg.kind === 'hider') {
        if (tg.behindCover) {
          tg.coverT -= dt;
          if (tg.coverT <= 0) {
            tg.behindCover = false;
            tg.dir = Math.random() < 0.3 ? -tg.dir : tg.dir;
          }
        } else if (Math.abs(tg.planeX - tg.coverX) < 8 &&
                   Math.random() < 1.6 * dt + 0.02) {
          tg.behindCover = true;
          tg.coverT = 1.1 + Math.random() * 1.1;
        }
      }

      if (!tg.behindCover) {
        tg.wob += dt * 2;
        tg.planeX += tg.dir * tg.speed * (0.9 + 0.1 * Math.sin(tg.wob)) * dt;
        tg.walk += dt * 7;
      }

      project(tg);

      if (tg.planeX < -170 || tg.planeX > W + 170) {
        targets.splice(i, 1);
        escapeBot();
        if (state !== 'running') return;
      }
    }

    /* mission quota */
    if (kills >= quota) {
      missionClear();
      if (state !== 'running') return;
    }

    stepParticles(dt);
    if (kick > 0) kick = Math.max(0, kick - dt * 4);
    if (muzzle > 0) muzzle = Math.max(0, muzzle - dt * 7);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (hurtFlash > 0) hurtFlash = Math.max(0, hurtFlash - dt * 1.6);
    if (banner > 0) banner -= dt;
  }

  function stepParticles(dt) {
    var i, p;
    for (i = particles.length - 1; i >= 0; i--) {
      p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 200 * dt;
      p.vx *= 0.965;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
    for (i = pops.length - 1; i >= 0; i--) {
      pops[i].y -= 26 * dt;
      pops[i].t -= dt * 0.9;
      if (pops[i].t <= 0) pops.splice(i, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function drawBot(tg, pal) {
    var s = tg.s;
    var crouch = tg.behindCover ? 0.62 : 1;
    var swing = tg.behindCover ? 0 : Math.sin(tg.walk) * 4;

    ctx.save();
    ctx.translate(tg.cx, tg.baseY);

    /* shadow */
    ctx.fillStyle = 'rgba(0,0,0,.28)';
    ctx.beginPath();
    ctx.ellipse(0, 0, 20 * s, 5 * s, 0, 0, TAU);
    ctx.fill();

    ctx.save();
    ctx.scale(s, s * crouch);

    /* legs */
    ctx.fillStyle = '#5d6b80';
    rr(-11, -30 + Math.max(0, swing), 8, 30 - Math.max(0, swing), 3);
    ctx.fill();
    rr(3, -30 + Math.max(0, -swing), 8, 30 - Math.max(0, -swing), 3);
    ctx.fill();

    /* body */
    ctx.fillStyle = pal.bot;
    rr(-15, -60, 30, 32, 6);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.16)';
    rr(-15, -60, 30, 8, 6);
    ctx.fill();

    /* chest core */
    ctx.fillStyle = '#22d3ee';
    ctx.beginPath();
    ctx.arc(0, -44, 4, 0, TAU);
    ctx.fill();

    /* arms */
    ctx.fillStyle = '#77869c';
    rr(-21, -56, 6, 22, 3);
    ctx.fill();
    rr(15, -56, 6, 22, 3);
    ctx.fill();

    /* head */
    ctx.fillStyle = pal.bot;
    rr(-10, -76, 20, 16, 5);
    ctx.fill();
    ctx.fillStyle = 'rgba(34,211,238,.95)';
    rr(-7, -71, 14, 6, 3);
    ctx.fill();

    /* antenna sensor (the bonus hit zone) */
    ctx.strokeStyle = '#8fa0b8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -76);
    ctx.lineTo(0, -86);
    ctx.stroke();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(0, -88, 3.4, 0, TAU);
    ctx.fill();

    ctx.restore();
    ctx.restore();
  }

  function drawCover(tg) {
    ctx.save();
    ctx.translate(tg.cx, tg.baseY);
    ctx.scale(tg.s, tg.s);
    ctx.fillStyle = '#4a4436';
    ctx.beginPath();
    ctx.moveTo(-26, 0);
    ctx.lineTo(-20, -16);
    ctx.lineTo(-6, -24);
    ctx.lineTo(12, -20);
    ctx.lineTo(24, -8);
    ctx.lineTo(26, 0);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,.1)';
    ctx.beginPath();
    ctx.moveTo(-20, -16);
    ctx.lineTo(-6, -24);
    ctx.lineTo(12, -20);
    ctx.lineTo(6, -14);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawScene(t, pal) {
    var i;

    /* sky */
    var g = ctx.createLinearGradient(0, -260, 0, HORIZON);
    g.addColorStop(0, pal.skyTop);
    g.addColorStop(1, pal.skyBot);
    ctx.fillStyle = g;
    ctx.fillRect(-40, -260, W + 80, HORIZON + 260);

    /* sun / moon */
    var sunX = W * 0.72 - camX * 0.04;
    var sg = ctx.createRadialGradient(sunX, 70, 6, sunX, 70, 110);
    sg.addColorStop(0, pal.sunGlow);
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(sunX - 120, -30, 240, 220);
    ctx.fillStyle = pal.sun;
    ctx.beginPath();
    ctx.arc(sunX, 70, mission === 3 ? 17 : 24, 0, TAU);
    ctx.fill();

    /* clouds */
    ctx.fillStyle = mission === 3 ? 'rgba(148,163,184,.1)' : 'rgba(255,255,255,.22)';
    for (i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var cx0 = ((c.x + t * c.s * 0.01) % (W + 260)) - 130 - camX * 0.06;
      ctx.beginPath();
      ctx.ellipse(cx0, c.y, c.w / 2, 13, 0, 0, TAU);
      ctx.ellipse(cx0 + c.w * 0.24, c.y - 7, c.w / 3, 11, 0, 0, TAU);
      ctx.fill();
    }

    /* far ridge */
    ctx.fillStyle = pal.ridgeFar;
    ctx.beginPath();
    ctx.moveTo(-200, HORIZON + 2);
    for (i = 0; i < ridge.length; i++) {
      var r = ridge[i];
      ctx.lineTo(r.x - camX * 0.08 - 120, HORIZON + 2);
      ctx.lineTo(r.x - camX * 0.08 + r.w / 2, r.y);
    }
    ctx.lineTo(W + 200, HORIZON + 2);
    ctx.closePath();
    ctx.fill();

    /* mid structures: ruined towers and walls */
    for (i = 0; i < mids.length; i++) {
      var m = mids[i];
      var mx = m.x - camX * 0.16;
      if (mx < -140 || mx > W + 140) continue;
      ctx.fillStyle = pal.ridgeNear;
      if (m.kind === 'tower') {
        ctx.fillRect(mx, HORIZON - m.h, m.w, m.h + 4);
        ctx.fillRect(mx - 5, HORIZON - m.h - 7, m.w + 10, 8);
        ctx.fillStyle = 'rgba(255,255,255,.08)';
        ctx.fillRect(mx + 4, HORIZON - m.h + 8, m.w - 8, 4);
      } else {
        ctx.fillRect(mx, HORIZON - m.h * 0.6, m.w, m.h * 0.6 + 4);
        /* broken top edge */
        ctx.fillStyle = pal.skyBot;
        ctx.beginPath();
        ctx.moveTo(mx + m.w * 0.3, HORIZON - m.h * 0.6);
        ctx.lineTo(mx + m.w * 0.45, HORIZON - m.h * 0.6 - 8);
        ctx.lineTo(mx + m.w * 0.6, HORIZON - m.h * 0.6);
        ctx.closePath();
        ctx.fill();
      }
    }

    /* fog band on the horizon */
    ctx.fillStyle = pal.fog;
    ctx.fillRect(-40, HORIZON - 16, W + 80, 22);

    /* ground */
    var gg = ctx.createLinearGradient(0, HORIZON, 0, H);
    gg.addColorStop(0, pal.groundA);
    gg.addColorStop(1, pal.groundB);
    ctx.fillStyle = gg;
    ctx.fillRect(-40, HORIZON, W + 80, H - HORIZON + 320);

    /* range distance lines */
    ctx.strokeStyle = 'rgba(255,255,255,.07)';
    ctx.lineWidth = 1;
    for (i = 1; i <= 4; i++) {
      var ly = HORIZON + (H - HORIZON) * (i / 5) * (i / 5);
      ctx.beginPath();
      ctx.moveTo(-40, ly);
      ctx.lineTo(W + 40, ly);
      ctx.stroke();
    }

    /* near foreground rocks (vantage point ledge) */
    for (i = 0; i < rocks.length; i++) {
      var rk = rocks[i];
      var rx = rk.x - camX * 0.4;
      var rs = 0.6 + rk.d;
      ctx.fillStyle = '#3a3629';
      ctx.beginPath();
      ctx.ellipse(rx, H - 4, rk.w * rs / 2, rk.h * rs, 0, Math.PI, TAU);
      ctx.fill();
    }

    /* targets, far to near */
    var order = targets.slice().sort(function (a, b) { return b.depth - a.depth; });
    for (i = 0; i < order.length; i++) {
      var tg = order[i];
      if (tg.kind === 'hider') drawCover(tg);
      drawBot(tg, pal);
      if (tg.kind === 'hider' && tg.behindCover) drawCover(tg);
    }

    /* particles in scene space */
    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawScopeOverlay(t, sw) {
    var ex = crossX + sw.x, ey = crossY + sw.y;
    var R = 172;

    /* vignette outside the scope circle */
    ctx.fillStyle = 'rgba(3,6,12,.88)';
    ctx.beginPath();
    ctx.rect(-20, -20, W + 40, H + 40);
    ctx.arc(ex, ey, R, 0, TAU, true);
    ctx.fill('evenodd');

    /* scope ring */
    ctx.strokeStyle = 'rgba(15,23,42,.9)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(ex, ey, R, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(148,163,184,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(ex, ey, R - 5, 0, TAU);
    ctx.stroke();

    /* crosshair lines + mil dots */
    ctx.strokeStyle = 'rgba(120,232,192,.9)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(ex - R + 14, ey); ctx.lineTo(ex - 12, ey);
    ctx.moveTo(ex + 12, ey); ctx.lineTo(ex + R - 14, ey);
    ctx.moveTo(ex, ey - R + 14); ctx.lineTo(ex, ey - 12);
    ctx.moveTo(ex, ey + 12); ctx.lineTo(ex, ey + R - 14);
    ctx.stroke();
    ctx.fillStyle = 'rgba(120,232,192,.9)';
    for (var d = 1; d <= 3; d++) {
      ctx.beginPath(); ctx.arc(ex, ey + d * 26, 1.8, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(ex, ey - d * 26, 1.8, 0, TAU); ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(ex, ey, 2.4, 0, TAU);
    ctx.fill();

    /* breath meter arc */
    ctx.strokeStyle = 'rgba(148,163,184,.3)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(ex, ey, R - 14, Math.PI * 0.82, Math.PI * 1.18);
    ctx.stroke();
    ctx.strokeStyle = breath > 30 ? '#34d399' : '#f87171';
    ctx.beginPath();
    ctx.arc(ex, ey, R - 14, Math.PI * 0.82,
            Math.PI * 0.82 + (Math.PI * 0.36) * (breath / 100));
    ctx.stroke();

    ctx.fillStyle = 'rgba(226,232,240,.75)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(gasp > 0 ? 'GASPING…' : 'BREATH', ex, ey + R - 26);
  }

  function drawCrosshair(t) {
    if (scopedNow()) return;
    var reloading = reloadT > 0;
    var col = reloading ? 'rgba(248,113,113,.95)' : 'rgba(120,232,192,.95)';
    var x = crossX, y = crossY - kick * 8;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    var gap = 5 + (reloading ? 6 : 0);
    ctx.beginPath();
    ctx.moveTo(x - 22, y); ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y); ctx.lineTo(x + 22, y);
    ctx.moveTo(x, y - 22); ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap); ctx.lineTo(x, y + 22);
    ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.arc(x, y, 2, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    var t = now() / 1000;
    var pal = PALS[mission - 1] || PALS[0];
    var sw = aimSway(t);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }
    /* jump: raise the viewpoint, so the world slides down the screen */
    if (playerZ > 0) ctx.translate(0, playerZ * VIEW_LIFT);

    /* scope zoom: magnify around the effective aim point */
    var scoped = scopedNow();
    if (scoped) {
      var ex = crossX + sw.x, ey = crossY + sw.y;
      ctx.translate(ex, ey);
      ctx.scale(ZOOM, ZOOM);
      ctx.translate(-ex, -ey);
    }

    drawScene(t, pal);

    ctx.restore();

    /* barrel hint + muzzle flash along the bottom */
    ctx.fillStyle = 'rgba(10,14,22,.85)';
    ctx.beginPath();
    ctx.moveTo(W * 0.36, H);
    ctx.lineTo(W * 0.46, H - 26 - kick * 10);
    ctx.lineTo(W * 0.54, H - 26 - kick * 10);
    ctx.lineTo(W * 0.64, H);
    ctx.closePath();
    ctx.fill();
    if (muzzle > 0.05) {
      ctx.fillStyle = 'rgba(253,224,138,' + (muzzle * 0.85) + ')';
      ctx.beginPath();
      ctx.arc(W / 2, H - 30 - kick * 10, 8 + muzzle * 14, 0, TAU);
      ctx.fill();
    }

    if (scoped) drawScopeOverlay(t, sw);
    else drawCrosshair(t);

    /* floating score pops */
    for (var i = 0; i < pops.length; i++) {
      var pu = pops[i];
      ctx.globalAlpha = clamp(pu.t, 0, 1);
      ctx.fillStyle = pu.col;
      ctx.font = '800 15px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pu.text, pu.x, pu.y);
    }
    ctx.globalAlpha = 1;

    /* integrity pips, top-left */
    ctx.fillStyle = 'rgba(226,232,240,.7)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('WATCHTOWER', 16, 24);
    for (var k = 0; k < INTEGRITY; k++) {
      ctx.fillStyle = k < integrity ? '#34d399' : 'rgba(226,232,240,.16)';
      ctx.beginPath();
      var px = 22 + k * 20, py = 36;
      ctx.moveTo(px, py - 8);
      ctx.lineTo(px + 8, py - 4);
      ctx.lineTo(px + 8, py + 4);
      ctx.lineTo(px, py + 10);
      ctx.lineTo(px - 8, py + 4);
      ctx.lineTo(px - 8, py - 4);
      ctx.closePath();
      ctx.fill();
    }

    /* mission + quota, top-center */
    ctx.fillStyle = 'rgba(226,232,240,.85)';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('MISSION ' + mission + '  ·  ' + kills + '/' + quota + ' BOTS', W / 2, 26);

    /* time bar */
    var bw = 200;
    ctx.fillStyle = 'rgba(226,232,240,.14)';
    rr(W / 2 - bw / 2, 34, bw, 6, 3);
    ctx.fill();
    ctx.fillStyle = timeLeft > 10 ? '#38bdf8' : '#f87171';
    rr(W / 2 - bw / 2, 34, bw * clamp(timeLeft / MISSION_TIME, 0, 1), 6, 3);
    ctx.fill();

    /* reloading note */
    if (reloadT > 0 && state === 'running') {
      ctx.fillStyle = 'rgba(248,113,113,.95)';
      ctx.font = '700 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('RELOADING…', W / 2, H - 54);
    }

    if (hurtFlash > 0) {
      ctx.fillStyle = 'rgba(248,113,113,' + (hurtFlash * 0.3) + ')';
      ctx.fillRect(0, 0, W, H);
    }

    if (banner > 0 && state === 'running') {
      ctx.globalAlpha = clamp(banner, 0, 1);
      ctx.fillStyle = '#fde68a';
      ctx.font = '800 30px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(bannerText, W / 2, H * 0.36);
      ctx.globalAlpha = 1;
    }

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', W / 2, H - 20);
    }
  }

  /* ---------------- loop ---------------- */

  function tick(ts) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (ts - last) / 1000 : 0;
    last = ts;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') update(dt, ts / 1000);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function isForm(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function toCanvas(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    var x = (clientX - rect.left) * (W / rect.width);
    var y = (clientY - rect.top) * (H / rect.height);
    return { x: clamp(x, 0, W), y: clamp(y, 0, H) };
  }

  document.addEventListener('keydown', function (e) {
    if (isForm(e.target)) return;
    var k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
    }

    if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else keys.jump = true;
    } else if (k === 'f' || k === 'F') {
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
    } else if (k === 'Shift') {
      shiftHeld = true;
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === ' ') keys.jump = false;
    else if (k === 'f' || k === 'F') keys.fire = false;
    else if (k === 'Shift') shiftHeld = false;
  });

  canvas.addEventListener('contextmenu', function (ev) { ev.preventDefault(); });

  canvas.addEventListener('pointermove', function (ev) {
    if (document.pointerLockElement === canvas) {
      /* locked: sweep the crosshair like a PC shooter, no screen edges to hit */
      var rect = canvas.getBoundingClientRect();
      if (rect.width && rect.height) {
        crossX = clamp(crossX + (ev.movementX || 0) * (canvas.width / rect.width), 0, W);
        crossY = clamp(crossY + (ev.movementY || 0) * (canvas.height / rect.height), 0, H);
      }
      return;
    }
    var p = toCanvas(ev.clientX, ev.clientY);
    if (!p) return;
    crossX = p.x;
    crossY = p.y;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    if (ev.button === 2) {
      rmBtn = true;
      return;
    }
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state !== 'running') return;
    if (ev.pointerType === 'touch') {
      var pt = toCanvas(ev.clientX, ev.clientY);
      if (pt) { crossX = pt.x; crossY = pt.y; }
      tapStart = { x: ev.clientX, y: ev.clientY, t: now() };
      return;
    }
    if (document.pointerLockElement !== canvas) {
      /* Aim at the click point first, then ask the browser for the pointer so
         the view can sweep freely. Some browsers and embedded frames refuse
         the lock (and presses of Esc drop it), so the request must never
         swallow the shot — the click still fires either way. */
      var p1 = toCanvas(ev.clientX, ev.clientY);
      if (p1) { crossX = p1.x; crossY = p1.y; }
      if (canvas.requestPointerLock) {
        try {
          var pr = canvas.requestPointerLock();
          if (pr && pr.catch) pr.catch(function () { /* lock refused */ });
        } catch (e) { /* pointer lock unavailable */ }
      }
    }
    fire();
  });

  canvas.addEventListener('pointerup', function (ev) {
    if (ev.button === 2) rmBtn = false;
    if (ev.pointerType === 'touch' && tapStart && state === 'running') {
      var moved = Math.abs(ev.clientX - tapStart.x) + Math.abs(ev.clientY - tapStart.y);
      if (moved < 16 && now() - tapStart.t < 300) fire();
    }
    tapStart = null;
  });

  window.addEventListener('pointerup', function (ev) {
    if (ev && ev.button === 2) rmBtn = false;
  });

  var scopeBtn = document.getElementById('btnScope');
  if (scopeBtn) {
    scopeBtn.addEventListener('click', function () {
      if (state === 'ready' || state === 'over') { start(); return; }
      if (state === 'paused') { resume(); return; }
      scopeLock = !scopeLock;
    });
  }

  var fireBtn = document.getElementById('btnFire');
  if (fireBtn) {
    fireBtn.addEventListener('click', function () {
      if (state === 'ready' || state === 'over') { start(); return; }
      if (state === 'paused') { resume(); return; }
      fire();
    });
  }

  var jumpBtn = document.getElementById('btnJump');
  if (jumpBtn) {
    jumpBtn.addEventListener('click', function () {
      if (state === 'ready' || state === 'over') { start(); return; }
      if (state === 'paused') { resume(); return; }
      keys.jump = true;
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  document.addEventListener('pointerlockchange', function () {
    if (document.pointerLockElement === canvas) updateHud();
    else if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  seedScene();
  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Scope Elite',
    msg: 'Three timed missions from the watchtower. Move the mouse to place the crosshair ' +
         'and left click — or press F — to fire; a click also locks the mouse so the ' +
         'valley sweeps freely, and firing keeps working while you are scoped. Hold ' +
         'Shift to steady the scope, press Space to hop the tower, and clear the quota ' +
         'of roaming bots before the clock runs out. Every bot that escapes costs your ' +
         'tower a point of integrity.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* read-only snapshot for automated smoke tests */
  window.__scopeElite = {
    state: function () { return state; },
    score: function () { return score; },
    mission: function () { return mission; },
    kills: function () { return kills; },
    quota: function () { return quota; },
    timeLeft: function () { return timeLeft; },
    ammo: function () { return ammo; },
    reloading: function () { return reloadT > 0; },
    scoped: function () { return scopedNow(); },
    breath: function () { return breath; },
    z: function () { return playerZ; },
    onGround: function () { return onGround; },
    integrity: function () { return integrity; },
    shots: function () { return shots; },
    hits: function () { return hits; },
    accuracy: function () { return accuracy(); },
    crosshair: function () { return { x: crossX, y: crossY }; },
    targets: function () {
      return targets.map(function (tg) {
        return {
          sx: tg.sx, sy: tg.sy, sw: tg.sw, sh: tg.sh,
          cx: tg.cx, baseY: tg.baseY, depth: tg.depth,
          kind: tg.kind, behindCover: tg.behindCover, dead: !!tg.dead
        };
      });
    }
  };
})();
