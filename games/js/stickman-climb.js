/* ============================================================
   Stickman Climb — original game for PixelPlay
   Canvas physics climber: two pickaxes, real momentum, one life
   and an endless neon cliff with overhangs, loose rocks, sliding
   ledges, gusts, falling debris and spiked ledges.
   Keyboard first, on-screen buttons for touch.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var TAU = Math.PI * 2;
  var BEST_KEY = 'stickman-climb';
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

  /* ---------------- tuning ---------------- */

  var PPM = 50;                 /* pixels per metre */
  var GRAV = 660;               /* gravity, px/s^2 (up is +y) */
  var ARM = 44;                 /* arm / rope length */
  var GRAB_REACH = 52;          /* how far above its hold a hand hammers */
  var SWING_T = 0.2;            /* swing duration, seconds */
  var CRUMBLE_WARN = 0.6;       /* loose-rock warning before it breaks */
  var CRUMBLE_HOLD = 1.15;      /* time from grip to crumbling away */
  var FALL_DROP = 260;          /* fall this far below your best height = run over */
  var WALK_SPEED = 0;           /* body is moved by impulses only */
  var GUST_BASE = 170;          /* weakest gust acceleration, px/s^2 */
  var GUST_STEP = 20;           /* extra strength per gust zone */
  var ROCK_BASE = 160;          /* first loose rock height */
  var ROCK_STEP = 200;          /* one loose rock every N pixels */
  var LEDGE_STEP = 330;         /* ledge spacing */

  /* falling debris (rocks and icicle volleys) */
  var DEBRIS_BASE = 6.4;        /* seconds between drops at ground level */
  var DEBRIS_MIN = 2.8;         /* fastest cadence, high up */
  var DEBRIS_WARN = 0.9;        /* telegraph time, seconds */
  var DEBRIS_SPEED = 300;       /* base fall speed, px/s */
  var DEBRIS_CEIL = 24000;      /* procedural world wraps beyond any real run */

  var state = 'ready';          /* ready | running | paused | over */
  var lives = 1, score = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var bestM = best;             /* best height in metres (int) */

  var body, hands, ledges, clouds, particles, overhangs, rocks, gusts;
  var debris, debrisTimer;
  var deathCause = 'fall';
  var spikeHits = 0;            /* jagged ledges that threw the climber off */
  var checkpoint;               /* { x, y } hip position of the last safe ledge */
  var camY = 0, heightMax = 0, heightInt = -1;
  var time = 0, shake = 0, hudT = 0;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  /* deterministic hash noise for the cliff silhouette */
  function noise1(y) {
    return 14 * Math.sin(y * 0.012) +
            8 * Math.sin(y * 0.031 + 1.7) +
            5 * Math.sin(y * 0.077 + 0.6);
  }

  /* Overhangs: bands where the wall juts out toward the climber. */
  function buildOverhangs() {
    overhangs = [];
    for (var i = 0; ; i++) {
      var a = 300 + i * 420;
      if (a > DEBRIS_CEIL) break;
      overhangs.push({ a: a, b: a + 88 + (i % 2) * 30, amp: 58 + (i % 3) * 10 });
    }
  }

  function overhangBump(y) {
    var bump = 0;
    /* bands are evenly spaced, so only inspect the nearby ones */
    var start = Math.floor((y - 300) / 420) - 1;
    if (start < 0) start = 0;
    for (var i = start; i < overhangs.length; i++) {
      var o = overhangs[i];
      if (o.a > y) break;
      if (y > o.a && y < o.b) {
        bump += o.amp * Math.sin(Math.PI * (y - o.a) / (o.b - o.a));
      }
    }
    return bump;
  }

  /* Wall face x-position at a given world height. Climber is right of it. */
  function faceX(y) {
    return 230 + noise1(y) + overhangBump(y);
  }

  /* Loose rocks sit at fixed heights; gripping one starts a crumble. */
  function looseRockNear(y) {
    var k = Math.round((y - ROCK_BASE) / ROCK_STEP);
    if (k < 1) return null;
    var ry = ROCK_BASE + k * ROCK_STEP;
    return Math.abs(ry - y) < 14 ? { k: k, y: ry } : null;
  }

  /* Gust zones: bands of sideways wind. */
  function gustForce(y) {
    for (var i = 0; i < gusts.length; i++) {
      var g = gusts[i];
      if (y > g.a && y < g.b) {
        var amp = GUST_BASE + (g.k % 4) * GUST_STEP;
        return amp * Math.sin(time * 1.7 + g.k * 2.1);
      }
    }
    return 0;
  }

  function burst(x, y, col, n, up) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 30 + Math.random() * 150;
      var life = 0.3 + Math.random() * 0.4;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s + (up || 0),
        life: life, life0: life,
        size: 1.2 + Math.random() * 2.2,
        col: col
      });
    }
    if (particles.length > 240) particles.splice(0, particles.length - 240);
  }

  /* ---------------- setup ---------------- */

  function buildLedges() {
    ledges = [];
    for (var k = 0; ; k++) {
      var y = 40 + k * LEDGE_STEP;
      if (y > DEBRIS_CEIL) break;
      if (k === 0) {
        ledges.push({ y: 40, w: 96, off: 0, moving: false, phase: 0, range: 0, speed: 0, spiked: false });
        continue;
      }
      var moving = (k % 2 === 1);
      /* Jagged ledges become a little more common the higher you climb.
         The hash is deterministic so a level always looks the same. */
      var spiked = k >= 5 && ((k * 7919) % 100) < (14 + Math.min(16, k * 0.09));
      ledges.push({
        y: y, w: moving ? 56 : 74 + (k % 2) * 12,
        off: 0, moving: moving, spiked: spiked,
        phase: k * 1.9, range: 70 + (k % 3) * 26, speed: 1.05 + (k % 4) * 0.2
      });
    }
  }

  function ledgeX(l) {
    return faceX(l.y) + 4 + (l.moving ? Math.sin(time * l.speed + l.phase) * l.range : 0);
  }

  function buildClouds() {
    clouds = [];
    for (var i = 0; i < 14; i++) {
      clouds.push({
        x: Math.random() * (W + 160) - 80,
        wy: Math.random() * 900,          /* world height seed */
        layer: i % 2,                     /* 0 = far, 1 = near */
        w: 60 + Math.random() * 90,
        sp: 4 + Math.random() * 8
      });
    }
  }

  function gripHand(h, gx, gy) {
    h.state = 'grip'; h.x = gx; h.y = gy;
    h.loose = looseRockNear(gy);
    h.crumble = h.loose ? CRUMBLE_HOLD : 0;
    h.t = 0;
  }

  function reset() {
    lives = 1; score = 0; heightMax = 0; heightInt = -1;
    particles = [];
    debris = []; debrisTimer = DEBRIS_BASE;
    deathCause = 'fall';
    spikeHits = 0;
    time = 0; shake = 0; hudT = 0;
    buildOverhangs();
    buildLedges();
    buildClouds();
    gusts = [];
    for (var i = 0; i < 140; i++) {
      gusts.push({ k: i, a: 500 + i * 760, b: 500 + i * 760 + 300 });
    }
    body = { x: faceX(40) + 52, y: 66, vx: 0, vy: 0, grounded: true, ledge: ledges[0], dropping: false };
    hands = {
      left: { state: 'grip', x: 0, y: 0, t: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, loose: null, crumble: 0, trail: [] },
      right: { state: 'grip', x: 0, y: 0, t: 0, fromX: 0, fromY: 0, toX: 0, toY: 0, loose: null, crumble: 0, trail: [] }
    };
    gripHand(hands.left, faceX(150) + 1, 150);
    gripHand(hands.right, faceX(190) + 1, 190);
    checkpoint = { x: body.x, y: body.y };
    camY = 0;
  }

  /* ---------------- states ---------------- */

  function start() {
    reset();
    state = 'running';
    last = now();
    GameShell.overlay.hide();
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('select');
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Resting on the rope. Take your time.',
      stats: [
        { label: 'Height', value: Math.round(heightMax) + ' m' },
        { label: 'Lives', value: lives }
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
    var h = Math.round(heightMax);
    var isBest = h > bestM;
    if (isBest) {
      bestM = h;
      best = h;
      GameShell.best.set(BEST_KEY, best);
    }
    var why;
    if (deathCause === 'debris') {
      why = 'A falling rock clipped you at ' + h + ' metre' + (h === 1 ? '' : 's') + '.';
    } else if (deathCause === 'icicle') {
      why = 'An icicle volley caught you at ' + h + ' metre' + (h === 1 ? '' : 's') + '.';
    } else {
      why = 'You slipped and fell from ' + h + ' metre' + (h === 1 ? '' : 's') + '.';
    }
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('lose');
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New best climb!' : 'Game over',
      msg: why + (isBest ? ' That is a new record — the top is wherever you stop.' : ' One life, no second chances. Try again?'),
      stats: [
        { label: 'Height', value: h + ' m' },
        { label: 'Best', value: bestM + ' m' },
        { label: 'Lives', value: 0 }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* End the run instantly: one life, no respawn. */
  function die(cause) {
    if (state !== 'running') return;
    deathCause = cause || 'fall';
    lives = 0;
    shake = 20;
    if (body) burst(body.x, body.y, '#ff5c7a', 24, 70);
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('hit');
    gameOver();
  }

  function updateHud() {
    var hTxt = (Math.round(heightMax * 10) / 10) + ' m';
    var gf = gustForce(body ? body.y : 0);
    var windTxt = Math.abs(gf) > 15 ? ' · gust ' + (gf > 0 ? '→' : '←') : '';
    GameShell.hud(
      {
        Score: Math.max(0, Math.floor(heightMax)),
        Best: Math.max(bestM, Math.floor(heightMax)),
        Height: hTxt,
        Lives: lives
      },
      state === 'paused' ? '⏸ Paused' : '← → alternate to climb' + windTxt
    );
  }

  /* ---------------- input actions ---------------- */

  function pressHand(side) {
    if (state !== 'running') return;
    var h = hands[side];
    if (!h || h.state === 'swing') return;
    /* release the grip and hammer upward toward a new hold */
    h.state = 'swing';
    h.t = 0;
    h.fromX = h.x; h.fromY = h.y;
    var ty = Math.max(h.y + GRAB_REACH, body.y + 44);
    h.toX = faceX(ty) + 1;
    h.toY = ty;
    h.trail = [];
    /* impulse toward the hammered hand */
    var dx = h.toX - body.x, dy = h.toY - body.y;
    var d = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    body.vx += (dx / d) * 90;
    body.vy += (dy / d) * 145 + 50;
    body.grounded = false;
    body.ledge = null;
    burst(body.x, body.y - 6, '#2ee6a6', 4, 40);
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('hit');
  }

  /* ---------------- hazards ---------------- */

  /* A rock (or a three-shard icicle volley) is aimed at marked heights on
     the wall just above the climber. The shadow rings are the telegraph;
     climb past them or hang below before the shard slams home. */
  function makeShard(ty, kind, idx) {
    var tx = faceX(ty);
    return {
      kind: kind,
      tx: tx,
      ty: ty,
      x: tx + (kind === 'icicle' ? 10 : 14),
      y: Math.max(camY + H - 8, ty + 46),
      vy: -(kind === 'icicle' ? DEBRIS_SPEED + 90 : DEBRIS_SPEED),
      warn: DEBRIS_WARN + idx * 0.08,
      warned: false,
      size: kind === 'icicle' ? 7 : 9
    };
  }

  function spawnDebris() {
    var h = heightMax;
    /* keep the aimed band on screen, 120-190 px above the climber */
    var baseY = body.y + 120 + Math.random() * 70;
    var icicle = h > 90 && Math.random() < 0.42;
    var i;
    if (icicle) {
      for (i = 0; i < 3; i++) {
        debris.push(makeShard(baseY + i * 58, 'icicle', i));
      }
    } else {
      debris.push(makeShard(baseY, 'rock', 0));
    }
    debrisTimer = Math.max(DEBRIS_MIN, DEBRIS_BASE - h * 0.0085) *
                  (0.78 + Math.random() * 0.44);
  }

  function hitWall(d) {
    var i;
    burst(d.tx, d.ty, d.kind === 'icicle' ? '#bde8ff' : '#94a3b8', 18, 40);
    shake = Math.max(shake, 9);
    if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('thud');
    if (state !== 'running' || !body) return;

    var dx = body.x - d.tx, dy = body.y - d.ty;
    if (dx * dx + dy * dy < 34 * 34) {
      die(d.kind === 'icicle' ? 'icicle' : 'debris');
      return;
    }
    /* a shard that lands on a gripping hand tears that pickaxe loose */
    for (i = 0; i < 2; i++) {
      var hnd = hands[i === 0 ? 'left' : 'right'];
      var hx = hnd.x - d.tx, hy = hnd.y - d.ty;
      if (hnd.state === 'grip' && hx * hx + hy * hy < 25 * 25) {
        burst(hnd.x, hnd.y, '#94a3b8', 12, 40);
        hnd.state = 'free';
        hnd.loose = null;
        hnd.crumble = 0;
        shake = Math.max(shake, 7);
      }
    }
  }

  function updateDebris(dt) {
    var i;
    debrisTimer -= dt;
    if (debrisTimer <= 0) {
      if (heightMax > 28 && body) spawnDebris();
      else debrisTimer = DEBRIS_BASE;
    }

    for (i = debris.length - 1; i >= 0; i--) {
      var d = debris[i];

      /* telegraph phase: pulsing impact shadow on the wall */
      if (d.warn > 0) {
        d.warn -= dt;
        if (!d.warned && d.warn <= 0.45) {
          d.warned = true;
          if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('wrong');
        }
        continue;
      }

      d.vy -= 700 * dt;
      d.y += d.vy * dt;

      if (d.y <= d.ty) {
        debris.splice(i, 1);
        hitWall(d);
        if (state !== 'running') return;
      }
    }
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;
    time += dt;
    if (shake > 0) shake = Math.max(0, shake - dt * 40);
    if (hudT > 0) hudT -= dt; else { hudT = 0.25; updateHud(); }

    /* --- hands: swings and crumbles --- */
    var handIds = ['left', 'right'];
    for (i = 0; i < 2; i++) {
      var h = hands[handIds[i]];
      if (h.state === 'swing') {
        h.t += dt;
        var p = clamp(h.t / SWING_T, 0, 1);
        var ease = 1 - (1 - p) * (1 - p);
        h.x = h.fromX + (h.toX - h.fromX) * ease;
        h.y = h.fromY + (h.toY - h.fromY) * ease;
        h.trail.push({ x: h.x, y: h.y });
        if (h.trail.length > 10) h.trail.shift();
        if (p >= 1) {
          gripHand(h, h.toX, h.toY);
          /* small tug from the freshly planted axe */
          body.vy += 36;
          body.vx += clamp((h.toX - body.x) * 1.2, -46, 46);
        }
      } else if (h.state === 'grip' && h.crumble > 0) {
        h.crumble -= dt;
        if (h.crumble <= 0) {
          /* the loose rock crumbles away */
          burst(h.x, h.y, '#94a3b8', 14, 60);
          h.state = 'free';
          h.loose = null;
          shake = Math.max(shake, 5);
          if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('thud');
        }
      }
    }

    /* --- gravity + wind --- */
    body.vy -= GRAV * dt;
    body.vx += gustForce(body.y) * dt;
    body.vx *= 0.995;

    /* --- rope constraints from gripped hands --- */
    for (i = 0; i < 2; i++) {
      var hg = hands[handIds[i]];
      if (hg.state !== 'grip') continue;
      var dx = hg.x - body.x, dy = hg.y - body.y;
      var d = Math.sqrt(dx * dx + dy * dy);
      if (d > ARM && d > 0.0001) {
        var nx = dx / d, ny = dy / d;
        body.x = hg.x - nx * ARM;
        body.y = hg.y - ny * ARM;
        var vn = body.vx * nx + body.vy * ny;
        if (vn > 0) { body.vx -= vn * nx; body.vy -= vn * ny; }
      }
    }

    /* --- integrate --- */
    body.x += body.vx * dt;
    body.y += body.vy * dt;

    /* keep the climber on the sunny side of the cliff */
    var fx = faceX(body.y) + 12;
    if (body.x < fx) {
      body.x = fx;
      if (body.vx < 0) body.vx *= -0.25;
      if (body.vy > 60) { shake = Math.max(shake, 3); body.vy *= 0.6; }
    }
    if (body.x > W - 24) { body.x = W - 24; body.vx = Math.min(body.vx, 0); }

    /* --- ledges: carry + land --- */
    if (body.grounded && body.ledge) {
      var l = body.ledge;
      var lx = ledgeX(l);
      body.y = l.y + 26;
      body.vy = 0;
      if (l.moving) {
        body.x += (Math.sin(time * l.speed + l.phase) * l.range -
                   Math.sin((time - dt) * l.speed + l.phase) * l.range);
      }
      if (body.x < lx - 4 || body.x > lx + l.w + 4) {
        body.grounded = false;
        body.ledge = null;
        body.vy = -20;
      }
    } else if (body.vy <= 0 && !body.dropping) {
      for (i = 0; i < ledges.length; i++) {
        var L = ledges[i];
        var lx2 = ledgeX(L);
        if (body.x >= lx2 - 2 && body.x <= lx2 + L.w + 2 &&
            body.y <= L.y + 30 && body.y >= L.y + 6) {
          if (L.spiked) {
            /* jagged ledge: it throws you back off instead of letting you rest */
            var sx = clamp(body.x, lx2 + 8, lx2 + L.w - 8);
            burst(sx, L.y + 10, '#ff5c7a', 22, 80);
            shake = 16;
            spikeHits++;
            body.grounded = false;
            body.ledge = null;
            body.y = L.y + 44;
            body.vy = 260;
            body.vx = 160;
            if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('hit');
            break;
          }
          body.grounded = true;
          body.ledge = L;
          body.y = L.y + 26;
          body.vy = 0;
          body.vx *= 0.3;
          if (L.y + 26 > checkpoint.y + 30) {
            checkpoint = { x: clamp(body.x, lx2 + 10, lx2 + L.w - 10), y: L.y + 26 };
            burst(body.x, body.y - 24, '#22d3ee', 10, 50);
            if (window.PixelPlayAudio) window.PixelPlayAudio.sfx('point');
            updateHud();
          }
          break;
        }
      }
    }

    /* --- height score --- */
    var hm = body.y / PPM;
    if (hm > heightMax) {
      heightMax = hm;
      var hi = Math.floor(heightMax);
      if (hi !== heightInt) { heightInt = hi; updateHud(); }
    }

    /* --- one life: slip too far below your best and the run ends --- */
    if (body.y < heightMax * PPM - FALL_DROP || body.y < -70) {
      die('fall');
      return;
    }

    /* --- falling debris and icicles --- */
    updateDebris(dt);
    if (state !== 'running') return;

    /* --- camera follows upward --- */
    var target = Math.max(0, body.y - 210);
    if (target > camY) camY += (target - camY) * Math.min(1, dt * 5);
    else camY += (target - camY) * Math.min(1, dt * 2);

    /* --- particles --- */
    for (i = particles.length - 1; i >= 0; i--) {
      var pt = particles[i];
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy -= 300 * dt;
      pt.vx *= 0.97;
      pt.life -= dt;
      if (pt.life <= 0) particles.splice(i, 1);
    }
  }

  /* ---------------- draw ---------------- */

  function sy(worldY) { return H - (worldY - camY); }

  function drawCliff() {
    var yTop = camY + H + 60, yBot = camY - 60;
    ctx.beginPath();
    var first = true;
    for (var y = yTop; y >= yBot; y -= 12) {
      var x = faceX(y);
      if (first) { ctx.moveTo(x, sy(y)); first = false; }
      else ctx.lineTo(x, sy(y));
    }
    /* close off to the left edge */
    ctx.lineTo(0, sy(yBot));
    ctx.lineTo(0, sy(yTop));
    ctx.closePath();
    var g = ctx.createLinearGradient(0, 0, 300, 0);
    g.addColorStop(0, '#0a0f1f');
    g.addColorStop(1, '#141c33');
    ctx.fillStyle = g;
    ctx.fill();

    /* neon rim on the face */
    ctx.beginPath();
    first = true;
    for (y = yTop; y >= yBot; y -= 8) {
      var x2 = faceX(y);
      if (first) { ctx.moveTo(x2, sy(y)); first = false; }
      else ctx.lineTo(x2, sy(y));
    }
    ctx.strokeStyle = '#7c5cff';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = '#7c5cff';
    ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;

    /* metre ticks every 10 m */
    ctx.fillStyle = 'rgba(148,163,184,.7)';
    ctx.font = '11px ' + FONT;
    ctx.textAlign = 'left';
    var m0 = Math.floor(yBot / PPM / 10) * 10;
    for (var m = m0; m < yTop / PPM; m += 10) {
      if (m <= 0) continue;
      var yy = sy(m * PPM);
      var xx = faceX(m * PPM);
      ctx.strokeStyle = 'rgba(124,92,255,.35)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xx + 2, yy);
      ctx.lineTo(xx + 16, yy);
      ctx.stroke();
      ctx.fillText(m + ' m', xx + 20, yy + 3);
    }
  }

  function drawGusts() {
    for (var i = 0; i < gusts.length; i++) {
      var g = gusts[i];
      if (sy(g.b) > H + 40 || sy(g.a) < -40) continue;
      var top = sy(g.b), bot = sy(g.a);
      ctx.fillStyle = 'rgba(34,211,238,.05)';
      ctx.fillRect(300, top, W - 300, bot - top);
      var dir = Math.sin(time * 1.4 + g.k * 2.1) >= 0 ? 1 : -1;
      ctx.strokeStyle = 'rgba(34,211,238,.28)';
      ctx.lineWidth = 1.4;
      for (var s = 0; s < 6; s++) {
        var yy2 = top + ((s * 53 + (time * 90) % (bot - top)) % Math.max(1, bot - top));
        var xx3 = 320 + ((s * 97 + time * 140 * dir) % 260 + 260) % 260;
        ctx.beginPath();
        ctx.moveTo(xx3, yy2);
        ctx.lineTo(xx3 + 26 * dir, yy2);
        ctx.stroke();
      }
    }
  }

  function drawDebris() {
    for (var i = 0; i < debris.length; i++) {
      var d = debris[i];
      var mx = d.tx;
      var my = sy(d.ty);
      if (my > -40 && my < H + 40) {
        /* impact shadow on the wall — visible for the whole telegraph */
        var pulse = 0.35 + 0.45 * Math.abs(Math.sin(time * 8 + i));
        var icy = d.kind === 'icicle';
        ctx.save();
        ctx.globalAlpha = d.warn > 0 ? pulse : 0.7;
        ctx.strokeStyle = icy ? '#8fe8ff' : '#ff5c7a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(mx, my, icy ? 14 : 18, 0, TAU);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(mx - 5, my);
        ctx.lineTo(mx + 5, my);
        ctx.moveTo(mx, my - 5);
        ctx.lineTo(mx, my + 5);
        ctx.stroke();
        /* dashed drop line so the danger column is unambiguous */
        if (d.warn > 0) {
          ctx.globalAlpha = 0.3;
          if (ctx.setLineDash) ctx.setLineDash([5, 7]);
          ctx.beginPath();
          ctx.moveTo(mx, my);
          ctx.lineTo(mx, 0);
          ctx.stroke();
          if (ctx.setLineDash) ctx.setLineDash([]);
        }
        ctx.restore();
      }

      if (d.warn > 0) continue;
      var dx = d.x, dy = sy(d.y);
      if (dy < -40 || dy > H + 40) continue;
      if (d.kind === 'icicle') {
        ctx.fillStyle = '#cdefff';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.moveTo(dx, dy + 12);
        ctx.lineTo(dx - 5, dy - 6);
        ctx.lineTo(dx, dy - 16);
        ctx.lineTo(dx + 5, dy - 6);
        ctx.closePath();
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(34,211,238,.85)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#94a3b8';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(dx, dy, 9, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = 'rgba(71,85,105,.9)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(dx - 4, dy - 4); ctx.lineTo(dx + 1, dy);
        ctx.moveTo(dx + 4, dy - 5); ctx.lineTo(dx + 1, dy);
        ctx.stroke();
      }
    }
  }

  function drawWindGauge() {
    var gf = gustForce(body ? body.y : 0);
    var strength = Math.abs(gf);
    if (strength < 10) return;
    var dir = gf > 0 ? 1 : -1;
    var x = W - 34, y = 86;
    var len = 16 + Math.min(28, strength * 0.14);

    ctx.save();
    ctx.fillStyle = 'rgba(34,211,238,.85)';
    ctx.font = '700 10px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('WIND', x, y - 12);

    ctx.strokeStyle = 'rgba(34,211,238,' + (0.5 + Math.min(0.45, strength / 420)) + ')';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    for (var i = 0; i < 3; i++) {
      var ox = x - dir * i * 7;
      ctx.beginPath();
      ctx.moveTo(ox - dir * 5, y - 4);
      ctx.lineTo(ox + dir * 5, y);
      ctx.lineTo(ox - dir * 5, y + 4);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(x - dir * 10, y);
    ctx.lineTo(x - dir * (10 + len), y);
    ctx.stroke();
    ctx.restore();
  }

  function drawLedges() {
    for (var i = 0; i < ledges.length; i++) {
      var l = ledges[i];
      var y = sy(l.y);
      if (y < -40 || y > H + 40) continue;
      var x = ledgeX(l);

      if (l.spiked) {
        /* jagged ledge: dark base, red-hot spikes, clear at a glance */
        var glow = 0.55 + 0.35 * Math.sin(time * 5 + i);
        ctx.fillStyle = '#2a1220';
        ctx.strokeStyle = 'rgba(255,92,122,' + glow + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(x, y - 8, l.w, 12, 4)
                      : ctx.rect(x, y - 8, l.w, 12);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = 'rgba(255,92,122,' + (0.6 + 0.35 * glow) + ')';
        ctx.beginPath();
        for (var s = 0; s < l.w - 4; s += 11) {
          ctx.moveTo(x + s, y - 7);
          ctx.lineTo(x + s + 5.5, y - 21);
          ctx.lineTo(x + s + 11, y - 7);
          ctx.closePath();
        }
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,210,62,.55)';
        ctx.lineWidth = 1;
        ctx.stroke();
        continue;
      }

      ctx.fillStyle = '#1d2a47';
      ctx.strokeStyle = l.moving ? '#22d3ee' : '#2ee6a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y - 8, l.w, 12, 4)
                    : ctx.rect(x, y - 8, l.w, 12);
      ctx.fill();
      ctx.stroke();
      /* safe-rest marker */
      if (checkpoint && Math.abs(l.y + 26 - checkpoint.y) < 4 &&
          Math.abs(x + l.w / 2 - checkpoint.x) < l.w) {
        ctx.fillStyle = 'rgba(34,211,238,.9)';
        ctx.font = 'bold 10px ' + FONT;
        ctx.textAlign = 'center';
        ctx.fillText('⌂', x + l.w / 2, y - 12);
      }
    }
  }

  function drawRocks() {
    /* loose rocks embedded in the face near the camera */
    var k0 = Math.floor((camY - ROCK_BASE) / ROCK_STEP) - 1;
    for (var k = Math.max(1, k0); k < k0 + 7; k++) {
      var ry = ROCK_BASE + k * ROCK_STEP;
      var y = sy(ry);
      if (y < -30 || y > H + 30) continue;
      var x = faceX(ry) - 8;
      var warn = 0;
      var handIds = ['left', 'right'];
      for (var i = 0; i < 2; i++) {
        var h = hands[handIds[i]];
        if (h.state === 'grip' && h.loose && h.loose.k === k && h.crumble > 0) {
          warn = 1 - h.crumble / CRUMBLE_HOLD;
        }
      }
      ctx.fillStyle = warn > 0 ? 'rgba(255,92,122,' + (0.35 + 0.4 * Math.abs(Math.sin(time * 14))) + ')'
                               : '#2a3757';
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, TAU);
      ctx.fill();
      if (warn > 0) {
        ctx.strokeStyle = 'rgba(255,255,255,.8)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 5); ctx.lineTo(x, y); ctx.lineTo(x - 3, y + 6);
        ctx.moveTo(x + 5, y - 4); ctx.lineTo(x + 1, y + 2);
        ctx.stroke();
      }
    }
  }

  function drawClouds() {
    for (var i = 0; i < clouds.length; i++) {
      var c = clouds[i];
      var par = c.layer === 0 ? 0.45 : 0.7;
      var y = H - ((c.wy * 4 - camY * par) % (H * 2.6)) ;
      if (y < -80) y += H * 2.6;
      if (y > H + 80) continue;
      var x = ((c.x + time * c.sp) % (W + 200)) - 100;
      ctx.fillStyle = c.layer === 0 ? 'rgba(124,92,255,.10)' : 'rgba(34,211,238,.08)';
      ctx.beginPath();
      ctx.ellipse(x, y, c.w, c.w * 0.32, 0, 0, TAU);
      ctx.fill();
    }
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      ctx.globalAlpha = clamp(p.life / p.life0, 0, 1);
      ctx.fillStyle = p.col;
      ctx.fillRect(p.x - p.size / 2, sy(p.y) - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  function drawStickman(t) {
    var hx = body.x, hy = sy(body.y);
    var shoulderY = hy - 22;
    var headY = shoulderY - 10;

    /* arms: shoulder → hand, stretched with a slight curve */
    var handIds = ['left', 'right'];
    for (var i = 0; i < 2; i++) {
      var h = hands[handIds[i]];
      var hxx = h.x, hyy = sy(h.y);
      /* pickaxe swing trail */
      if (h.state === 'swing' && h.trail.length > 1) {
        ctx.strokeStyle = 'rgba(46,230,166,.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (var tr = 0; tr < h.trail.length; tr++) {
          var tp = h.trail[tr];
          if (tr === 0) ctx.moveTo(tp.x, sy(tp.y));
          else ctx.lineTo(tp.x, sy(tp.y));
        }
        ctx.stroke();
      }
      /* arm as a curved stretched line */
      var mx = (hx + hxx) / 2, my = (shoulderY + hyy) / 2 + 6;
      ctx.strokeStyle = '#e8eefc';
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(hx + (i === 0 ? -2 : 2), shoulderY);
      ctx.quadraticCurveTo(mx, my, hxx, hyy);
      ctx.stroke();

      /* pickaxe at the hand */
      ctx.save();
      ctx.translate(hxx, hyy);
      var ang = h.state === 'swing'
        ? Math.atan2(hyy - sy(h.fromY), hxx - h.fromX) - Math.PI / 2
        : -0.5;
      ctx.rotate(ang);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, 12);         /* handle into the rock */
      ctx.moveTo(-7, -1); ctx.quadraticCurveTo(0, -6, 7, -1); /* axe head */
      ctx.stroke();
      ctx.fillStyle = '#2ee6a6';
      ctx.beginPath();
      ctx.arc(0, 0, 2.6, 0, TAU);
      ctx.fill();
      ctx.restore();
    }

    /* torso */
    ctx.strokeStyle = '#e8eefc';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.lineTo(hx, shoulderY);
    ctx.stroke();

    /* head */
    ctx.beginPath();
    ctx.arc(hx, headY, 7.5, 0, TAU);
    ctx.stroke();

    /* legs: dangle with a swing, plant when grounded */
    var spread = body.grounded ? 0.5 : clamp(-body.vx * 0.006, -0.4, 0.4);
    var wig = body.grounded ? 0 : Math.sin(t / 150) * 0.12;
    for (var leg = -1; leg <= 1; leg += 2) {
      var a = 1.35 + leg * spread * 0.55 + wig * leg;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.sin(a) * 18 * leg * (leg === 1 ? 1 : -1) * -1, hy + Math.cos(a) * 18);
      ctx.stroke();
    }
    /* simple feet */
    ctx.lineWidth = 2;
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);

    /* sky */
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#05070e');
    g.addColorStop(0.6, '#0a1020');
    g.addColorStop(1, '#101a30');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* glow high up */
    var rg = ctx.createRadialGradient(W * 0.7, 60, 10, W * 0.7, 60, W * 0.8);
    rg.addColorStop(0, 'rgba(46,230,166,.08)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rg;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    if (shake > 0) {
      ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    }

    drawClouds();
    drawCliff();
    drawGusts();
    drawLedges();
    drawDebris();
    drawRocks();
    drawParticles();
    if (body) drawStickman(t);

    ctx.restore();

    drawWindGauge();

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
    if (state === 'running') {
      try { update(dt); } catch (e) { /* never break the loop */ }
    }
    try { draw(t); } catch (e) { /* never break the loop */ }
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') e.preventDefault();
    if (e.repeat) {
      /* holding a key does not auto-swing — deliberate presses only */
      if (k === 'ArrowLeft' || k === 'ArrowRight') return;
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') pressHand('left');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') pressHand('right');
    else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
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

  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on(ev) {
        ev.preventDefault();
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'left') pressHand('left');
        else if (act === 'right') pressHand('right');
      }
      btn.addEventListener('pointerdown', on);
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();

  /* read-only test/debug hook (dropAll mimics both axes ripping out at once) */
  window.__stickman_climb = {
    getState: function () { return state; },
    getLives: function () { return lives; },
    getHeight: function () { return heightMax; },
    getBody: function () { return { x: body.x, y: body.y }; },
    getTargetHeight: function () { return 0; },   /* endless — no finish line */
    isEndless: function () { return true; },
    getCheckpoint: function () { return { x: checkpoint.x, y: checkpoint.y }; },
    getWind: function () { return gustForce(body.y); },
    getDeathCause: function () { return deathCause; },
    getSpikeHits: function () { return spikeHits; },
    getHazards: function () {
      var spiked = 0;
      for (var i = 0; i < ledges.length; i++) if (ledges[i].spiked) spiked++;
      return {
        debris: debris.length,
        fallingDebris: debris.filter(function (d) { return d.kind === 'rock'; }).length,
        icicles: debris.filter(function (d) { return d.kind === 'icicle'; }).length,
        spikedLedges: spiked,
        looseRocks: Math.floor(DEBRIS_CEIL / ROCK_STEP),
        gusts: gusts.length,
        overhangs: overhangs.length,
        movingLedges: Math.floor(ledges.length / 2),
        types: ['loose rocks', 'overhangs', 'moving ledges', 'gusts',
                'falling debris', 'icicle volleys', 'spiked ledges']
      };
    },
    getDifficulty: function () {
      return {
        gravity: GRAV,
        arm: ARM,
        grabReach: GRAB_REACH,
        crumbleHold: CRUMBLE_HOLD,
        crumbleWarn: CRUMBLE_WARN,
        rocksEvery: ROCK_STEP,
        rockBase: ROCK_BASE,
        gusts: gusts.length,
        gustStrength: GUST_BASE,
        gustMax: GUST_BASE + 3 * GUST_STEP,
        gustFrequency: 1.7,
        gustZoneHeight: 300,
        overhangAmp: 58,
        overhangSpacing: 420,
        ledgeSpacing: LEDGE_STEP,
        movingLedgesEvery: 2,
        fallDrop: FALL_DROP,
        targetHeight: 0,
        endless: true,
        lives: 1,
        debrisWarn: DEBRIS_WARN,
        debrisBaseInterval: DEBRIS_BASE,
        debrisMinInterval: DEBRIS_MIN,
        debrisSpeed: DEBRIS_SPEED,
        debrisMaxSpeed: DEBRIS_SPEED + 240,
        debrisScalesWithHeight: 0.0085,
        debrisFromHeight: 28,
        icicleFromHeight: 90,
        spikedLedgeChanceLow: 0.14,
        spikedLedgeChanceHigh: 0.30
      };
    },
    press: function (side) { pressHand(side); },
    dropAll: function () {
      if (state !== 'running') return;
      hands.left.state = 'free';
      hands.right.state = 'free';
      body.grounded = false;
      body.ledge = null;
      body.dropping = true;
    },
    start: start
  };

  GameShell.overlay.show({
    title: 'Stickman Climb',
    msg: 'Alternate ← and → to hammer the pickaxes up an endless neon cliff. One life only — falling rocks, icicle volleys, jagged ledges, gusts and crumbling holds all want you back at the bottom.',
    stats: [{ label: 'Best', value: bestM + ' m' }, { label: 'Lives', value: 1 }],
    btn: '▶ Play',
    action: start
  });
})();
