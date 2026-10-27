/* ============================================================
   Brick Blitz — original game for PixelPlay
   Canvas breakout: pointer / touch paddle control, keyboard
   and on-screen pad, levels with rising ball speed.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  canvas.style.touchAction = 'none';   /* keep drags on the board from scrolling the page */

  var W = 640, H = 480;
  var BEST_KEY = 'brick-blitz';

  /* bricks: 9 x 5 grid near the top, 6px gaps */
  var COLS = 9, ROWS = 5, GAP = 6, SIDE = 16, TOP = 56, BRICK_H = 22;
  var BRICK_W = (W - SIDE * 2 - GAP * (COLS - 1)) / COLS;
  var POINTS = [50, 40, 30, 20, 10];                    /* by row, top row most valuable */
  var COLORS = ['#f43f5e', '#f97316', '#f59e0b', '#22c55e', '#0ea5e9'];

  /* paddle + ball */
  var PADDLE_W = 100, PADDLE_H = 14, PADDLE_Y = H - 34;
  var PADDLE_PER_FRAME = 320 / 60;                      /* ~320 px per second */
  var BALL_R = 7, BASE_SPEED = 5.2, MAX_SPEED = 11;

  var bricks, bricksLeft, colorOrder;
  var score, lives, level, ballSpeed;
  var paddleX = 0, ballX = 0, ballY = 0, vx = 0, vy = 0;
  var stuck = true;
  var state = 'ready';                /* ready | running | paused | over */
  var pendingLevel = false;           /* paused on the "level cleared" overlay */
  var keyLeft = false, keyRight = false, padLeft = false, padRight = false;
  var best = GameShell.best.get(BEST_KEY, 0);
  var newBest = false;
  var rafId = 0, lastFrame = 0;

  /* ---------------- helpers ---------------- */

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

  function shownBest() { return Math.max(best, score || 0); }

  function speedFor(lvl) {
    return Math.min(MAX_SPEED, BASE_SPEED * Math.pow(1.06, lvl - 1));
  }

  function buildBricks() {
    bricks = [];
    bricksLeft = COLS * ROWS;
    colorOrder = (level % 2 === 1) ? [0, 1, 2, 3, 4] : [4, 3, 2, 1, 0];
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        bricks.push({
          x: SIDE + c * (BRICK_W + GAP),
          y: TOP + r * (BRICK_H + GAP),
          row: r,
          alive: true
        });
      }
    }
  }

  function resetBall() {
    stuck = true;
    ballX = paddleX + PADDLE_W / 2;
    ballY = PADDLE_Y - BALL_R - 1;
    vx = 0;
    vy = 0;
  }

  function reset() {
    score = 0;
    lives = 3;
    level = 1;
    ballSpeed = speedFor(level);
    paddleX = (W - PADDLE_W) / 2;
    newBest = false;
    pendingLevel = false;
    buildBricks();
    resetBall();
    updateHud();
  }

  function updateHud() {
    var right = '';
    if (state === 'paused') right = '⏸ Paused';
    else if (state === 'running' && stuck) right = 'Space to launch';
    else if (state === 'running') right = '🎯 Top row = 50';
    GameShell.hud({
      Score: score || 0,
      Best: shownBest(),
      Lives: lives || 0,
      Level: level || 1
    }, right);
  }

  function blurActive() {
    var el = document.activeElement;
    if (el && el.blur) { try { el.blur(); } catch (e) { /* ignore */ } }
  }

  /* ---------------- game states ---------------- */

  function start() {
    reset();
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
    ensureLoop();
  }

  function launch() {
    if (state !== 'running' || !stuck) return;
    var ang = (Math.random() * 0.9 - 0.45);          /* ~±26° from vertical */
    vx = Math.sin(ang) * ballSpeed;
    vy = -Math.cos(ang) * ballSpeed;
    stuck = false;
    updateHud();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The wall will wait. Press P or the button when you are ready.',
      stats: [{ label: 'Score', value: score }, { label: 'Best', value: shownBest() }],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    if (pendingLevel) { continueLevel(); return; }
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
  }

  function continueLevel() {
    pendingLevel = false;
    buildBricks();
    resetBall();
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
  }

  function levelClear() {
    score += 100;                                      /* clear bonus */
    level++;
    ballSpeed = speedFor(level);
    state = 'paused';
    pendingLevel = true;
    updateHud();
    GameShell.overlay.show({
      title: 'Level cleared! 🧱',
      msg: 'That is the whole wall down. 100 bonus points banked — level ' +
           level + ' moves about 6% faster.',
      stats: [{ label: 'Score', value: score }, { label: 'Level', value: level }],
      btn: '▶ Continue',
      action: continueLevel
    });
  }

  function gameOver() {
    state = 'over';
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Game over',
      msg: (level > 1
              ? 'You cleared ' + (level - 1) + ' full wall' + (level - 1 === 1 ? '' : 's') + '. '
              : '') +
           'You scored ' + score + ' point' + (score === 1 ? '' : 's') + '. Better luck next run!',
      stats: [{ label: 'Score', value: score }, { label: 'Best', value: best }],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- input ---------------- */

  function isForm(el) {
    var tag = el && el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  document.addEventListener('keydown', function (e) {
    if (isForm(e.target)) return;

    var k = e.key;
    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ') {
      e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyLeft = true;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keyRight = true;
    else if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running' && stuck) launch();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') keyLeft = false;
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') keyRight = false;
  });

  window.addEventListener('blur', function () {
    keyLeft = keyRight = padLeft = padRight = false;
  });

  /* on-screen pad: hold ◀ ▶ to slide, ▲ launches, ▼ pauses */
  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var dir = btn.getAttribute('data-dir');

      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        if (dir === 'left') padLeft = true;
        else if (dir === 'right') padRight = true;
        else if (dir === 'launch') {
          if (state === 'ready' || state === 'over') start();
          else if (state === 'paused') resume();
          else launch();
        } else if (dir === 'pause') {
          if (state === 'running') pause();
          else if (state === 'paused') resume();
        }
      });

      function release() {
        if (dir === 'left') padLeft = false;
        else if (dir === 'right') padRight = false;
      }
      btn.addEventListener('pointerup', release);
      btn.addEventListener('pointercancel', release);
      btn.addEventListener('pointerleave', release);
    })(padBtns[b]);
  }

  /* pointer / touch: paddle follows pointer X, tap launches */
  function canvasX(clientX) {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width) return null;
    return (clientX - rect.left) * (W / rect.width);
  }

  function movePaddleTo(x) {
    paddleX = x - PADDLE_W / 2;
    if (paddleX < 0) paddleX = 0;
    if (paddleX > W - PADDLE_W) paddleX = W - PADDLE_W;
    if (stuck) ballX = paddleX + PADDLE_W / 2;
  }

  canvas.addEventListener('pointermove', function (ev) {
    if (state !== 'running') return;
    var x = canvasX(ev.clientX);
    if (x !== null) movePaddleTo(x);
  });

  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    var x = canvasX(ev.clientX);
    if (x !== null) movePaddleTo(x);
    launch();
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- update ---------------- */

  function loseLife() {
    lives--;
    if (lives <= 0) { gameOver(); return; }
    resetBall();                        /* still running — launch again with Space / tap */
    updateHud();
  }

  function wallBounce() {
    if (ballX - BALL_R < 0) { ballX = BALL_R; vx = Math.abs(vx); }
    else if (ballX + BALL_R > W) { ballX = W - BALL_R; vx = -Math.abs(vx); }
    if (ballY - BALL_R < 0) {
      ballY = BALL_R;
      if (vy < 0) vy = -vy;
    }
  }

  function paddleBounce() {
    if (vy <= 0) return;
    if (ballY + BALL_R < PADDLE_Y || ballY - BALL_R > PADDLE_Y + PADDLE_H) return;
    if (ballX < paddleX - BALL_R || ballX > paddleX + PADDLE_W + BALL_R) return;

    ballY = PADDLE_Y - BALL_R;
    var hit = (ballX - (paddleX + PADDLE_W / 2)) / (PADDLE_W / 2);
    if (hit < -1) hit = -1;
    else if (hit > 1) hit = 1;
    var ang = hit * Math.PI / 3;                    /* -60°…+60° from vertical */
    vx = Math.sin(ang) * ballSpeed;
    vy = -Math.cos(ang) * ballSpeed;
  }

  function circleHitsRect(cx, cy, r, rx, ry, rw, rh) {
    var nx = cx < rx ? rx : (cx > rx + rw ? rx + rw : cx);
    var ny = cy < ry ? ry : (cy > ry + rh ? ry + rh : cy);
    var dx = cx - nx, dy = cy - ny;
    return dx * dx + dy * dy <= r * r;
  }

  function brickBounce(b) {
    var cx = b.x + BRICK_W / 2, cy = b.y + BRICK_H / 2;
    var dx = ballX - cx, dy = ballY - cy;
    var ox = (BRICK_W / 2 + BALL_R) - Math.abs(dx);
    var oy = (BRICK_H / 2 + BALL_R) - Math.abs(dy);
    if (ox < oy) {
      if (dx > 0) { ballX = b.x + BRICK_W + BALL_R; if (vx < 0) vx = -vx; }
      else { ballX = b.x - BALL_R; if (vx > 0) vx = -vx; }
    } else {
      if (dy > 0) { ballY = b.y + BRICK_H + BALL_R; if (vy < 0) vy = -vy; }
      else { ballY = b.y - BALL_R; if (vy > 0) vy = -vy; }
    }
  }

  function brickHit() {
    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      if (!circleHitsRect(ballX, ballY, BALL_R, b.x, b.y, BRICK_W, BRICK_H)) continue;

      b.alive = false;
      bricksLeft--;
      score += POINTS[b.row];
      brickBounce(b);
      updateHud();
      if (bricksLeft <= 0) levelClear();
      return;
    }
  }

  function update(dt) {
    var f = dt / 16.67;                              /* movement per 60fps frame */

    var move = 0;
    if (keyLeft || padLeft) move -= 1;
    if (keyRight || padRight) move += 1;
    if (move !== 0) {
      paddleX += move * PADDLE_PER_FRAME * f;
      if (paddleX < 0) paddleX = 0;
      if (paddleX > W - PADDLE_W) paddleX = W - PADDLE_W;
    }

    if (stuck) {                                     /* ball rides the paddle */
      ballX = paddleX + PADDLE_W / 2;
      ballY = PADDLE_Y - BALL_R - 1;
      return;
    }

    var maxStep = Math.max(Math.abs(vx), Math.abs(vy)) * f;
    var steps = Math.ceil(maxStep / 4);
    if (steps < 1) steps = 1;
    var sx = vx * f / steps, sy = vy * f / steps;

    for (var i = 0; i < steps; i++) {
      if (state !== 'running' || stuck) return;
      ballX += sx;
      ballY += sy;
      wallBounce();
      paddleBounce();
      brickHit();
      if (state !== 'running' || stuck) return;
      if (ballY - BALL_R > H) { loseLife(); return; }
    }
  }

  /* ---------------- draw ---------------- */

  function draw() {
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,.04)';
    ctx.lineWidth = 1;
    for (var gx = 80; gx < W; gx += 80) {
      ctx.beginPath();
      ctx.moveTo(gx + .5, 0);
      ctx.lineTo(gx + .5, H);
      ctx.stroke();
    }

    if (!bricks) return;

    for (var i = 0; i < bricks.length; i++) {
      var b = bricks[i];
      if (!b.alive) continue;
      ctx.fillStyle = COLORS[colorOrder[b.row]];
      rr(b.x, b.y, BRICK_W, BRICK_H, 4);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,.22)';
      rr(b.x + 2, b.y + 2, BRICK_W - 4, 6, 3);
      ctx.fill();
    }

    var grad = ctx.createLinearGradient(paddleX, 0, paddleX + PADDLE_W, 0);
    grad.addColorStop(0, '#f97316');
    grad.addColorStop(1, '#f43f5e');
    ctx.fillStyle = grad;
    rr(paddleX, PADDLE_Y, PADDLE_W, PADDLE_H, 7);
    ctx.fill();

    ctx.save();
    ctx.shadowColor = '#e2e8f0';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.arc(ballX, ballY, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastFrame) lastFrame = t;
    var dt = t - lastFrame;
    lastFrame = t;
    if (dt > 50) dt = 50;                           /* cap after tab switches */
    if (state === 'running' && dt > 0) update(dt);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- boot ---------------- */

  reset();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Brick Blitz',
    msg: 'Steer the paddle with the mouse, touch or arrow keys, then launch the ball. ' +
         'Bounce it off the paddle edges to aim — clear all 45 bricks before your three lives run out.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
