/* ============================================================
   Stickman Climb — original game for PixelPlay
   Canvas physics climber: two pickaxes, real momentum, a tall
   neon cliff with overhangs, loose rocks, sliding ledges and
   gusts. Keyboard first, on-screen buttons for touch.
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
  var GRAV = 620;               /* gravity, px/s^2 (up is +y) */
  var ARM = 46;                 /* arm / rope length */
  var GRAB_REACH = 58;          /* how far above its hold a hand hammers */
  var SWING_T = 0.2;            /* swing duration, seconds */
  var CRUMBLE_WARN = 0.85;      /* loose-rock warning before it breaks */
  var CRUMBLE_HOLD = 1.5;       /* time from grip to crumbling away */
  var FALL_DROP = 300;          /* fall below the checkpoint to lose a life */
  var WALK_SPEED = 0;           /* body is moved by impulses only */

  var state = 'ready';          /* ready | running | paused | over */
  var lives = 3, score = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var bestM = best;             /* best height in metres (int) */

  var body, hands, ledges, clouds, particles, overhangs, rocks, gusts;
  var checkpoint;               /* { x, y } hip position of the resting ledge */
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
      var a = 300 + i * 470;
      if (a > 20000) break;
      overhangs.push({ a: a, b: a + 80 + (i % 2) * 26, amp: 46 + (i % 3) * 8 });
    }
  }

  function overhangBump(y) {
    var bump = 0;
    for (var i = 0; i < overhangs.length; i++) {
      var o = overhangs[i];
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
    var k = Math.round((y - 200) / 240);
    if (k < 1) return null;
    var ry = 200 + k * 240;
    return Math.abs(ry - y) < 16 ? { k: k, y: ry } : null;
  }

  /* Gust zones: bands of sideways wind. */
  function gustForce(y) {
    for (var i = 0; i < gusts.length; i++) {
      var g = gusts[i];
      if (y > g.a && y < g.b) {
        return 150 * Math.sin(time * 1.4 + g.k * 2.1);
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
      var y = 40 + k * 330;
      if (y > 20000) break;
      if (k === 0) {
        ledges.push({ y: 40, w: 96, off: 0, moving: false, phase: 0, range: 0, speed: 0 });
        continue;
      }
      var moving = (k % 3 === 2);
      ledges.push({
        y: y, w: moving ? 64 : 78 + (k % 2) * 14,
        off: 0, moving: moving,
        phase: k * 1.9, range: 60 + (k % 3) * 22, speed: 0.9 + (k % 4) * 0.18
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
    lives = 3; score = 0; heightMax = 0; heightInt = -1;
    particles = [];
    time = 0; shake = 0; hudT = 0;
    buildOverhangs();
    buildLedges();
    buildClouds();
    gusts = [];
    for (var i = 0; i < 8; i++) {
      gusts.push({ k: i, a: 560 + i * 900, b: 560 + i * 900 + 250 });
    }
    body = { x: faceX(40) + 52, y: 66, vx: 0, vy: 0, grounded: true, ledge: ledges[0] };
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
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New best climb!' : 'Game over',
      msg: isBest
        ? 'A new record — ' + h + ' metres of neon rock. Can you top it?'
        : 'You reached ' + h + ' metre' + (h === 1 ? '' : 's') + ' before the cliff won.',
      stats: [
        { label: 'Height', value: h + ' m' },
        { label: 'Best', value: bestM + ' m' },
        { label: 'Lives', value: lives }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function loseLife() {
    if (state !== 'running') return;
    lives--;
    shake = 14;
    if (lives <= 0) {
      lives = 0;
      updateHud();
      gameOver();
      return;
    }
    /* respawn on the last checkpoint ledge */
    body.x = checkpoint.x;
    body.y = checkpoint.y;
    body.vx = 0; body.vy = 0;
    body.grounded = true; body.ledge = null;
    body.dropping = false;
    for (var i = 0; i < ledges.length; i++) {
      var l = ledges[i];
      var lx = ledgeX(l);
      if (body.x >= lx - 8 && body.x <= lx + l.w + 8 &&
          Math.abs((l.y + 26) - body.y) < 60) { body.ledge = l; break; }
    }
    gripHand(hands.left, faceX(body.y + 30) + 1, body.y + 30);
    gripHand(hands.right, faceX(body.y + 60) + 1, body.y + 60);
    if (body.ledge) { body.grounded = true; body.y = body.ledge.y + 26; }
    camY = Math.max(0, body.y - 200);
    updateHud();
  }

  function updateHud() {
    var hTxt = (Math.round(heightMax * 10) / 10) + ' m';
    GameShell.hud(
      {
        Score: Math.max(0, Math.floor(heightMax)),
        Best: Math.max(bestM, Math.floor(heightMax)),
        Height: hTxt,
        Lives: lives
      },
      state === 'paused' ? '⏸ Paused' : '← → alternate to climb'
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
          body.grounded = true;
          body.ledge = L;
          body.y = L.y + 26;
          body.vy = 0;
          body.vx *= 0.3;
          if (L.y + 26 > checkpoint.y + 30) {
            checkpoint = { x: clamp(body.x, lx2 + 10, lx2 + L.w - 10), y: L.y + 26 };
            burst(body.x, body.y - 24, '#22d3ee', 10, 50);
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

    /* --- falling too far costs a life --- */
    if (body.y < checkpoint.y - FALL_DROP || body.y < -70) {
      loseLife();
      if (state !== 'running') return;
    }

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

  function drawLedges() {
    for (var i = 0; i < ledges.length; i++) {
      var l = ledges[i];
      var y = sy(l.y);
      if (y < -30 || y > H + 30) continue;
      var x = ledgeX(l);
      ctx.fillStyle = '#1d2a47';
      ctx.strokeStyle = l.moving ? '#22d3ee' : '#2ee6a6';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(x, y - 8, l.w, 12, 4)
                    : ctx.rect(x, y - 8, l.w, 12);
      ctx.fill();
      ctx.stroke();
      /* checkpoint marker */
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
    var k0 = Math.floor((camY - 200) / 240) - 1;
    for (var k = Math.max(1, k0); k < k0 + 6; k++) {
      var ry = 200 + k * 240;
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
    drawRocks();
    drawParticles();
    if (body) drawStickman(t);

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
    msg: 'Alternate ← and → to hammer the pickaxes up the neon cliff. Watch for loose rocks and do not let go with both hands.',
    stats: [{ label: 'Best', value: bestM + ' m' }],
    btn: '▶ Play',
    action: start
  });
})();
