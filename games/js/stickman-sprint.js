/* ============================================================
   Stickman Sprint — original game for PixelPlay
   Canvas endless parkour runner: leap barriers, slide under
   energy beams, clear gaps and grab coins through a neon city.
   Keyboard first, pointer + on-screen buttons for touch.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'stickman-sprint';
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

  /* ---------------- world constants ---------------- */

  var GROUND = 468;             /* ground top, in screen y          */
  var PX = 150;                 /* player screen x (world x = worldX + PX) */
  var M_PER_PX = 1 / 40;        /* one metre = 40 px                 */
  var GRAV = 2400;              /* px/s²                             */
  var JUMP_V = -840;            /* first jump                        */
  var DJUMP_V = -740;           /* double jump                       */
  var STAND_H = 64, SLIDE_H = 22;
  var SPEED0 = 330, SPEED_MAX = 720, SPEED_RAMP = 3.6; /* +3.6 px/s per metre */
  var FIRST_SPAWN = 660;        /* world px before the first obstacle */
  var LOOP = 1280;              /* skyline tiling period              */

  /* ---------------- state ---------------- */

  var state = 'ready';          /* ready | running | paused | stumble | over */
  var worldX = 0, speed = SPEED0, distance = 0;
  var score = 0, coins = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var player = {
    feetY: GROUND, vy: 0, onGround: true,
    jumps: 0, sliding: false, slideT: 0, runPhase: 0, tumble: 0
  };
  var obstacles = [], coinList = [], particles = [];
  var nextSpawnX = 0;
  var stumbleT = 0, shake = 0;
  var keys = { slide: false };
  var hudScore = -1;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function smooth(t) { return t * t * (3 - 2 * t); }

  function hash(n) {
    var x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 40 + Math.random() * 190;
      var life = 0.3 + Math.random() * 0.4;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.2,
        col: col
      });
    }
    if (particles.length > 260) particles.splice(0, particles.length - 260);
  }

  /* ---------------- skyline (parallax) ---------------- */

  var farBld = [], nearBld = [];

  function makeSkyline() {
    farBld = []; nearBld = [];
    var i, x;
    x = 0;
    while (x < LOOP) {
      var w = 46 + Math.floor(hash(x) * 70);
      farBld.push({ x: x, w: w, h: 90 + Math.floor(hash(x + 7) * 150) });
      x += w + 14 + Math.floor(hash(x + 3) * 26);
    }
    x = 0;
    while (x < LOOP) {
      var w2 = 36 + Math.floor(hash(x + 101) * 56);
      nearBld.push({ x: x, w: w2, h: 60 + Math.floor(hash(x + 55) * 110) });
      x += w2 + 18 + Math.floor(hash(x + 9) * 30);
    }
  }

  function drawSkyline(list, par, baseY, colA, colB) {
    var off = (worldX * par) % LOOP;
    for (var i = 0; i < list.length; i++) {
      var b = list[i];
      for (var k = -1; k <= 1; k++) {
        var sx = b.x - off + k * LOOP;
        if (sx > W || sx + b.w < 0) continue;
        ctx.fillStyle = colA;
        ctx.fillRect(sx, baseY - b.h, b.w, b.h + 40);
        ctx.fillStyle = colB;
        var rows = Math.floor(b.h / 22), cols = Math.floor(b.w / 16);
        for (var r = 0; r < rows; r++) {
          for (var c = 0; c < cols; c++) {
            if (hash(i * 31 + r * 7 + c) > 0.62) {
              ctx.fillRect(sx + 5 + c * 16, baseY - b.h + 8 + r * 22, 5, 8);
            }
          }
        }
      }
    }
  }

  /* ---------------- HUD / states ---------------- */

  function updateHud() {
    hudScore = score;
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Distance: Math.floor(distance) + ' m',
        Coins: coins
      },
      state === 'paused' ? '⏸ Paused' : 'Space = jump · ↓ = slide'
    );
  }

  function reset() {
    worldX = 0; speed = SPEED0; distance = 0;
    score = 0; coins = 0;
    obstacles = []; coinList = []; particles = [];
    nextSpawnX = FIRST_SPAWN + PX;
    stumbleT = 0; shake = 0; hudScore = -1;
    player.feetY = GROUND; player.vy = 0; player.onGround = true;
    player.jumps = 0; player.sliding = false; player.slideT = 0;
    player.runPhase = 0; player.tumble = 0;
    releaseKeys();
    ensureSpawn();
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
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Catch your breath — the city will wait.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Distance', value: Math.floor(distance) + ' m' },
        { label: 'Coins', value: coins }
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

  function stumble() {
    if (state !== 'running') return;
    state = 'stumble';
    stumbleT = 0.95;
    shake = 14;
    burst(PX + 10, player.feetY - 30, '#ff5c7a', 18);
    releaseKeys();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Sprint over',
      msg: 'You covered ' + Math.floor(distance) + ' metres and grabbed ' +
           coins + ' coin' + (coins === 1 ? '' : 's') + '. Can you go further?',
      stats: [
        { label: 'Distance', value: Math.floor(distance) + ' m' },
        { label: 'Best', value: best },
        { label: 'Coins', value: coins }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function releaseKeys() {
    keys.slide = false;
  }

  /* ---------------- moves ---------------- */

  function jump() {
    if (state !== 'running') return false;
    if (player.onGround) {
      player.vy = JUMP_V;
      player.onGround = false;
      player.jumps = 1;
      player.sliding = false;
      player.slideT = 0;
      burst(PX, GROUND, '#22d3ee', 8);
    } else if (player.jumps < 2) {
      player.vy = DJUMP_V;
      player.jumps = 2;
      burst(PX, player.feetY - 10, '#7c5cff', 10);
    } else {
      return false;
    }
    return true;
  }

  /* ---------------- procedural spawning ---------------- */

  function addCoin(x, y) {
    coinList.push({ x: x, y: y, taken: false, ph: Math.random() * TAU });
  }

  function coinArc(x0, n, topY, spanY) {
    for (var i = 0; i < n; i++) {
      var f = n === 1 ? 0.5 : i / (n - 1);
      addCoin(x0 + i * 36, topY + Math.sin(f * Math.PI) * -spanY + spanY);
    }
  }

  function spawnPattern() {
    var x = nextSpawnX;
    var diff = x * M_PER_PX;                 /* difficulty rises with distance */
    var r = Math.random();
    var w, spacing, type;

    /* weighted pick, unlocked by distance — always jumpable/slideable */
    if (diff < 22) type = 'barrier';
    else if (diff < 48) type = r < 0.55 ? 'barrier' : (r < 0.8 ? 'coins' : 'beam');
    else type = r < 0.38 ? 'barrier' : (r < 0.62 ? 'beam' : (r < 0.84 ? 'gap' : 'coins'));

    if (type === 'barrier') {
      w = 26 + rand(16);
      var h = 46 + rand(26);
      obstacles.push({ type: 'barrier', x: x, w: w, h: h });
      coinArc(x - 24, 5, GROUND - h - 76, 40);
      spacing = w + Math.max(240, speed * 0.85);
    } else if (type === 'beam') {
      w = 72 + rand(48);
      obstacles.push({ type: 'beam', x: x, w: w });
      for (var i = 0; i < 3; i++) addCoin(x + 18 + i * 30, GROUND - 18);
      spacing = w + Math.max(250, speed * 0.9);
    } else if (type === 'gap') {
      var jumpDist = (2 * -JUMP_V / GRAV) * speed;
      var maxGap = clamp(jumpDist * 0.5, 96, 196);
      w = 92 + rand(Math.max(1, Math.floor(maxGap - 92)));
      obstacles.push({ type: 'gap', x: x, w: w });
      coinArc(x - 8, Math.min(6, Math.floor(w / 34) + 2), GROUND - 150, 58);
      spacing = w + Math.max(300, speed * 1.05);
    } else {                                  /* coins only — breathing room */
      w = 0;
      for (var c = 0; c < 4; c++) addCoin(x + c * 34, GROUND - 64 - (c % 2) * 26);
      spacing = Math.max(220, speed * 0.7);
    }
    nextSpawnX += spacing;
  }

  function ensureSpawn() {
    while (nextSpawnX < worldX + PX + W + 200) spawnPattern();
  }

  /* ---------------- update ---------------- */

  function overGap() {
    var px = worldX + PX;
    for (var i = 0; i < obstacles.length; i++) {
      var o = obstacles[i];
      if (o.type !== 'gap') continue;
      if (px > o.x + 5 && px < o.x + o.w - 5) return true;
    }
    return false;
  }

  function update(dt) {
    var i;

    if (state === 'stumble') {
      stumbleT -= dt;
      speed = Math.max(140, speed - speed * 5 * dt);
      worldX += speed * dt;
      player.tumble = Math.min(2.6, player.tumble + dt * 7);
      player.feetY = Math.min(GROUND + 40, player.feetY + 60 * dt);
      if (shake > 0) shake = Math.max(0, shake - dt * 40);
      updateParticles(dt);
      if (stumbleT <= 0) gameOver();
      return;
    }
    if (state !== 'running') return;

    /* --- speed ramp + distance --- */
    speed = Math.min(SPEED_MAX, SPEED0 + distance * SPEED_RAMP);
    worldX += speed * dt;
    distance = worldX * M_PER_PX;

    /* --- vertical physics --- */
    player.vy += GRAV * dt;
    player.feetY += player.vy * dt;
    if (!overGap()) {
      if (player.feetY >= GROUND) {
        player.feetY = GROUND;
        player.vy = 0;
        if (!player.onGround) burst(PX, GROUND, 'rgba(34,211,238,.8)', 6);
        player.onGround = true;
        player.jumps = 0;
      }
    } else if (player.feetY >= GROUND && player.vy >= 0) {
      player.onGround = false;            /* the road has vanished — fall in */
    }
    if (player.feetY > GROUND + 96) { stumble(); return; }

    /* --- slide --- */
    if (keys.slide && player.onGround) {
      if (!player.sliding) { player.sliding = true; player.slideT = 0; }
      player.slideT += dt;
    } else {
      player.sliding = false;
    }

    /* --- run cycle --- */
    if (player.onGround && !player.sliding) {
      player.runPhase += dt * (speed / 42);
    } else if (player.onGround) {
      player.runPhase += dt * 2.2;
    }

    /* --- collisions: obstacles --- */
    var pLeft = worldX + PX - 12, pRight = worldX + PX + 12;
    var pH = player.sliding ? SLIDE_H : STAND_H;
    var pTop = player.feetY - pH;
    for (i = obstacles.length - 1; i >= 0; i--) {
      var o = obstacles[i];
      if (o.x + o.w < worldX + PX - 200) { obstacles.splice(i, 1); continue; }
      if (o.type === 'gap') continue;
      if (o.x > pRight || o.x + o.w < pLeft) continue;
      if (o.type === 'barrier') {
        if (player.feetY > GROUND - o.h + 4 && pTop < GROUND) {
          stumble(); return;
        }
      } else if (o.type === 'beam') {
        /* energy field hangs from GROUND-180 down to GROUND-34 */
        if (pTop < GROUND - 34 && player.feetY > GROUND - 180) {
          stumble(); return;
        }
      }
    }

    /* --- collisions: coins --- */
    for (i = coinList.length - 1; i >= 0; i--) {
      var cn = coinList[i];
      if (cn.taken) continue;
      if (cn.x < worldX - 80) { coinList.splice(i, 1); continue; }
      var dx = cn.x - (worldX + PX);
      if (dx > -18 && dx < 18 && cn.y > pTop - 14 && cn.y < player.feetY + 8) {
        cn.taken = true;
        coins++;
        score = Math.floor(distance) + coins * 10;
        burst(cn.x, cn.y, '#facc15', 9);
      }
    }

    ensureSpawn();
    updateParticles(dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 40);

    /* --- live HUD --- */
    var s = Math.floor(distance) + coins * 10;
    if (s !== hudScore) { score = s; updateHud(); }
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.96;
      p.vy *= 0.96;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  /* ---------------- stickman drawing ----------------
     A small skeleton: head circle + line limbs, with pose
     keyframes interpolated for smooth animated poses.      */

  var RUN_POSES = [
    { lean: 0.20, armF: -0.80, armB: 0.80, elbowF: -0.35, elbowB: 0.35, legF: 0.55, legB: -0.55, kneeF: -0.10, kneeB: -0.55 },
    { lean: 0.22, armF: -0.25, armB: 0.25, elbowF: -0.40, elbowB: 0.40, legF: 0.05, legB: -0.12, kneeF: -0.50, kneeB: -0.60 },
    { lean: 0.24, armF: 0.80, armB: -0.80, elbowF: -0.35, elbowB: 0.35, legF: -0.55, legB: 0.62, kneeF: -0.55, kneeB: -0.12 },
    { lean: 0.22, armF: 0.25, armB: -0.25, elbowF: -0.40, elbowB: 0.40, legF: -0.12, legB: 0.16, kneeF: -0.60, kneeB: -0.50 }
  ];
  var JUMP_POSE  = { lean: 0.16, armF: -2.20, armB: 1.10, elbowF: -0.45, elbowB: 0.30, legF: 0.90, legB: -0.50, kneeF: -1.20, kneeB: -0.70 };
  var DJUMP_POSE = { lean: 0.10, armF: -2.50, armB: -2.20, elbowF: -0.30, elbowB: 0.30, legF: 0.60, legB: -0.85, kneeF: -1.00, kneeB: -0.45 };
  var SLIDE_POSE = { lean: -1.12, armF: -1.60, armB: -2.05, elbowF: -0.30, elbowB: -0.30, legF: 1.38, legB: 1.18, kneeF: -0.35, kneeB: -0.35 };

  function lerpPose(a, b, t) {
    var out = {};
    for (var k in a) {
      if (!Object.prototype.hasOwnProperty.call(a, k)) continue;
      out[k] = a[k] + (b[k] - a[k]) * t;
    }
    return out;
  }

  function runPose() {
    var p = ((player.runPhase % 1) + 1) % 1 * 4;
    var i = Math.floor(p) % 4;
    return lerpPose(RUN_POSES[i], RUN_POSES[(i + 1) % 4], smooth(p - Math.floor(p)));
  }

  function currentPose(t) {
    if (state === 'stumble') {
      var lean = 0.8 + Math.sin(t / 40) * 0.25;
      return {
        lean: lean,
        armF: -2.0 + Math.sin(t / 45) * 0.4, armB: 2.1,
        elbowF: -0.3, elbowB: 0.3,
        legF: 1.0, legB: -1.1, kneeF: -0.2, kneeB: -0.45
      };
    }
    if (player.sliding) return SLIDE_POSE;
    if (!player.onGround) return player.jumps >= 2 ? DJUMP_POSE : JUMP_POSE;
    return runPose();
  }

  function drawStick(hipX, hipY, pose, tumble, col) {
    ctx.save();
    ctx.translate(hipX, hipY);
    if (tumble) ctx.rotate(tumble);
    ctx.strokeStyle = col;
    ctx.lineWidth = 3.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = col;
    ctx.shadowBlur = 9;

    var lean = pose.lean;
    var sx = Math.sin(lean) * 26, sy = -Math.cos(lean) * 26;   /* shoulder */

    /* legs (from hip) */
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

    /* arms (from shoulder) */
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

    /* torso */
    ctx.beginPath();
    ctx.moveTo(0, 0); ctx.lineTo(sx, sy);
    ctx.stroke();

    /* head */
    var hx = sx + Math.sin(lean) * 13, hy = sy - Math.cos(lean) * 13;
    ctx.beginPath();
    ctx.arc(hx, hy, 8.5, 0, TAU);
    ctx.stroke();

    ctx.restore();
  }

  /* ---------------- drawing ---------------- */

  function drawCoin(c, t) {
    var sx = c.x - worldX;
    if (sx < -30 || sx > W + 30) return;
    var spin = 0.28 + 0.72 * Math.abs(Math.sin(t / 260 + c.ph));
    ctx.save();
    ctx.translate(sx, c.y);
    ctx.shadowColor = '#facc15';
    ctx.shadowBlur = 12;
    ctx.fillStyle = '#fde68a';
    ctx.beginPath();
    ctx.ellipse(0, 0, 8 * spin, 9.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.ellipse(0, 0, 4.4 * spin, 6, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawObstacle(o, t) {
    var sx = o.x - worldX;
    if (sx > W + 40 || sx + o.w < -40) return;
    if (o.type === 'barrier') {
      var y = GROUND - o.h;
      ctx.save();
      ctx.shadowColor = '#ff5c7a';
      ctx.shadowBlur = 12;
      ctx.fillStyle = '#3b1024';
      ctx.fillRect(sx, y, o.w, o.h);
      ctx.strokeStyle = '#ff5c7a';
      ctx.lineWidth = 2.5;
      ctx.strokeRect(sx + 1, y + 1, o.w - 2, o.h - 2);
      ctx.shadowBlur = 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(sx + 2, y + 2, o.w - 4, o.h - 4);
      ctx.clip();
      ctx.strokeStyle = 'rgba(250,204,21,.85)';
      ctx.lineWidth = 3;
      for (var i = 0; i < o.h + o.w; i += 14) {
        ctx.beginPath();
        ctx.moveTo(sx + i - o.h, y + o.h);
        ctx.lineTo(sx + i, y);
        ctx.stroke();
      }
      ctx.restore();
      ctx.restore();
    } else if (o.type === 'beam') {
      /* energy field GROUND-180 .. GROUND-34, bright bar at the bottom */
      var fx = sx, fy = GROUND - 180, fh = 146;
      var pulse = 0.5 + 0.5 * Math.sin(t / 180 + o.x);
      ctx.save();
      var g = ctx.createLinearGradient(0, fy, 0, fy + fh);
      g.addColorStop(0, 'rgba(34,211,238,0)');
      g.addColorStop(1, 'rgba(34,211,238,' + (0.18 + pulse * 0.12) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(fx, fy, o.w, fh);
      ctx.shadowColor = '#22d3ee';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#67e8f9';
      ctx.fillRect(fx - 4, fy + fh - 8, o.w + 8, 8);
      ctx.fillStyle = 'rgba(103,232,249,.55)';
      ctx.fillRect(fx - 4, fy - 4, o.w + 8, 4);
      ctx.restore();
    } else if (o.type === 'gap') {
      ctx.save();
      ctx.fillStyle = '#020309';
      ctx.fillRect(sx, GROUND, o.w, H - GROUND);
      ctx.shadowColor = '#a855f7';
      ctx.shadowBlur = 12;
      ctx.strokeStyle = 'rgba(168,85,247,.9)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(sx, GROUND + 2); ctx.lineTo(sx, H);
      ctx.moveTo(sx + o.w, GROUND + 2); ctx.lineTo(sx + o.w, H);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* sky */
    var g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#05070e');
    g.addColorStop(0.62, '#0b1026');
    g.addColorStop(1, '#1a1038');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* glow moon */
    var mg = ctx.createRadialGradient(W - 110, 92, 8, W - 110, 92, 130);
    mg.addColorStop(0, 'rgba(168,85,247,.5)');
    mg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(W - 250, 0, 250, 240);
    ctx.fillStyle = '#e9d5ff';
    ctx.beginPath();
    ctx.arc(W - 110, 92, 26, 0, TAU);
    ctx.fill();

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawSkyline(farBld, 0.22, GROUND + 10, '#141b36', 'rgba(96,165,250,.28)');
    drawSkyline(nearBld, 0.5, GROUND + 14, '#0d1326', 'rgba(34,211,238,.30)');

    /* ground */
    ctx.fillStyle = '#070b16';
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = 'rgba(34,211,238,.75)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, GROUND + 1.5); ctx.lineTo(W, GROUND + 1.5);
    ctx.stroke();
    /* scrolling road dashes */
    ctx.fillStyle = 'rgba(124,92,255,.45)';
    var dashOff = worldX % 90;
    for (var d = -1; d < W / 90 + 2; d++) {
      ctx.fillRect(d * 90 - dashOff, GROUND + 20, 46, 5);
    }

    var i;
    for (i = 0; i < obstacles.length; i++) {
      if (obstacles[i].type === 'gap') drawObstacle(obstacles[i], t);
    }
    for (i = 0; i < coinList.length; i++) {
      if (!coinList[i].taken) drawCoin(coinList[i], t);
    }
    for (i = 0; i < obstacles.length; i++) {
      if (obstacles[i].type !== 'gap') drawObstacle(obstacles[i], t);
    }

    for (i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.life0));
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;

    /* player */
    var hipY = player.sliding ? player.feetY - 6 : player.feetY - 34;
    drawStick(PX, hipY, currentPose(t), state === 'stumble' ? player.tumble : 0, '#22d3ee');

    ctx.restore();

    if (state === 'paused') {
      ctx.fillStyle = 'rgba(232,238,252,.75)';
      ctx.font = 'bold 24px ' + FONT;
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
    if (state === 'running' || state === 'stumble') update(dt);
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
    if (k === undefined || k === null) return;

    if (k === 'ArrowUp' || k === 'ArrowDown' || k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') {
      if (state === 'ready' || state === 'over') start();
      else jump();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      keys.slide = true;
    } else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else jump();
    } else if (k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowDown' || k === 's' || k === 'S') keys.slide = false;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.preventDefault) ev.preventDefault();
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state === 'paused') { resume(); return; }
    jump();
  });

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'jump') jump();
        else if (act === 'slide') keys.slide = true;
      }
      function off() {
        if (act === 'slide') keys.slide = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  window.addEventListener('blur', releaseKeys);

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__stickmanSprint', {
      value: Object.freeze({
        snapshot: function () {
          return {
            state: state,
            score: score,
            best: Math.max(best, score),
            distance: distance,
            coins: coins,
            speed: speed,
            worldX: worldX,
            feetY: player.feetY,
            vy: player.vy,
            onGround: player.onGround,
            sliding: player.sliding,
            jumps: player.jumps,
            obstacles: obstacles.length
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  makeSkyline();
  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Stickman Sprint',
    msg: 'Your runner never stops — jump the barriers with Space, slide under the beams with ↓ and clear the gaps. How many metres can you cover?',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
