/* ============================================================
   Pong Arena — original game for PixelPlay
   Canvas paddle duel against an AI. Mouse / finger / keyboard.
   First to 7 points wins the match; best win streak is saved.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 640, H = 480;
  var BEST_KEY = 'pong-arena';
  var WIN_SCORE = 7;

  var WALL = 16;              /* gap between court edge and paddle */
  var PADDLE_W = 14;
  var PADDLE_H = 90;
  var BALL_R = 8;

  var PLAYER_SPEED = 6;       /* px per 60fps frame (~360 px/s) */
  var AI_BASE = 5.2;          /* px per frame */
  var AI_MAX = 7.5;
  var AI_REACTION = 120;      /* ms between the AI re-reading the ball */
  var BALL_BASE = 6;          /* px per frame at launch */
  var BALL_MAX = 14;
  var MAX_ANGLE = Math.PI / 3; /* 60 degrees */
  var SERVE_MS = 800;         /* pause before an automatic serve */

  var state = 'ready';        /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var streak = 0;
  var match = { you: 0, ai: 0 };
  var player = { y: H / 2 - PADDLE_H / 2 };
  var ai = { y: H / 2 - PADDLE_H / 2 };
  var ball = { x: W / 2, y: H / 2, vx: 0, vy: 0 };
  var keys = { up: false, down: false };
  var awaiting = true;        /* true while waiting for Space / a tap to serve */
  var serveMs = 0;
  var serveDir = 1;
  var aiTargetY = H / 2;
  var aiReact = 0;
  var flash = 0;
  var newBest = false;
  var rafId = 0;
  var lastT = 0;

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function updateHud() {
    GameShell.hud(
      { Score: match.you + ' : ' + match.ai, Best: best },
      state === 'paused' ? '⏸ Paused' : 'First to ' + WIN_SCORE
    );
  }

  /* ---------------- ball / scoring ---------------- */

  /* Set the ball direction from an angle, keeping the magnitude exact and
     always leaving a small vertical component so a rally can never lock into
     a perfectly flat, endless loop. */
  function setVelocity(angle, speed, sign) {
    var vx = Math.cos(angle) * speed * sign;
    var vy = Math.sin(angle) * speed;
    var minY = speed * 0.2;
    if (vy > -minY && vy < minY) {
      vy = vy < 0 ? -minY : minY;
      vx = Math.sqrt(speed * speed - vy * vy) * sign;
    }
    ball.vx = vx;
    ball.vy = vy;
  }

  function launch(dir) {
    var angle = (Math.random() * 2 - 1) * 0.35;
    ball.x = W / 2;
    ball.y = H / 2;
    setVelocity(angle, BALL_BASE, dir);
  }

  function launchNow() {
    if (state !== 'running') return;
    awaiting = false;
    serveMs = 0;
    launch(serveDir);
    updateHud();
  }

  function bounce(paddle, isPlayer) {
    var off = (ball.y - (paddle.y + PADDLE_H / 2)) / (PADDLE_H / 2);
    off = clamp(off, -1, 1);

    var speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    speed = Math.min(BALL_MAX, speed * 1.08);      /* +8% per paddle hit */
    if (speed < BALL_BASE) speed = BALL_BASE;

    setVelocity(off * MAX_ANGLE, speed, isPlayer ? 1 : -1);
    flash = 130;
  }

  function point(who) {
    if (who === 'you') match.you++;
    else match.ai++;

    flash = 0;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;

    updateHud();

    if (match.you >= WIN_SCORE || match.ai >= WIN_SCORE) {
      endMatch();
      return;
    }
    serveDir = who === 'you' ? 1 : -1;   /* serve toward whoever conceded */
    awaiting = false;
    serveMs = SERVE_MS;
  }

  function endMatch() {
    state = 'over';
    var won = match.you > match.ai;

    if (won) {
      streak++;
      if (streak > best) {
        best = streak;
        newBest = true;
        GameShell.best.set(BEST_KEY, best);
      }
    } else {
      streak = 0;
    }

    updateHud();
    GameShell.overlay.show({
      title: won ? (newBest ? 'New best streak!' : 'You win the match!') : 'AI wins the match',
      msg: won
        ? 'You took the match ' + match.you + '–' + match.ai + '. Win streak: ' + streak + '.'
        : 'The AI edged you out ' + match.ai + '–' + match.you + '. Your win streak resets — go again.',
      stats: [
        { label: 'Final', value: match.you + ' : ' + match.ai },
        { label: 'Win streak', value: streak },
        { label: 'Best streak', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- state changes ---------------- */

  function start() {
    match.you = 0;
    match.ai = 0;
    player.y = H / 2 - PADDLE_H / 2;
    ai.y = H / 2 - PADDLE_H / 2;
    aiTargetY = H / 2;
    aiReact = 0;
    ball.x = W / 2;
    ball.y = H / 2;
    ball.vx = 0;
    ball.vy = 0;
    keys.up = false;
    keys.down = false;
    flash = 0;
    newBest = false;
    serveDir = Math.random() < 0.5 ? 1 : -1;
    awaiting = true;                    /* play starts on Space / click / tap */
    serveMs = 0;
    state = 'running';
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
      msg: 'The rally is frozen. Resume whenever you are ready to serve again.',
      stats: [
        { label: 'Score', value: match.you + ' : ' + match.ai },
        { label: 'Best streak', value: best }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    GameShell.overlay.hide();
    updateHud();
  }

  /* ---------------- update ---------------- */

  function update(dt, k) {
    var dir = 0;
    if (keys.up) dir -= 1;
    if (keys.down) dir += 1;
    if (dir !== 0) {
      player.y += dir * PLAYER_SPEED * k;
      player.y = clamp(player.y, 0, H - PADDLE_H);
    }

    /* AI: reaction-limited tracking, speed capped and scaled when behind */
    aiReact -= dt;
    if (aiReact <= 0) {
      aiReact = AI_REACTION;
      aiTargetY = ball.vx > 0 ? ball.y : H / 2;
    }
    var aiSpeed = Math.min(AI_MAX, AI_BASE + match.you * 0.25);
    var diff = aiTargetY - (ai.y + PADDLE_H / 2);
    var step = aiSpeed * k;
    if (Math.abs(diff) <= step) ai.y = aiTargetY - PADDLE_H / 2;
    else ai.y += diff > 0 ? step : -step;
    ai.y = clamp(ai.y, 0, H - PADDLE_H);

    if (flash > 0) flash -= dt;

    if (serveMs > 0) {
      serveMs -= dt;
      if (serveMs <= 0) {
        serveMs = 0;
        launch(serveDir);
      }
      return;
    }
    if (awaiting) return;

    var prevX = ball.x;
    ball.x += ball.vx * k;
    ball.y += ball.vy * k;

    /* top and bottom walls */
    if (ball.y - BALL_R < 0) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
    } else if (ball.y + BALL_R > H) {
      ball.y = H - BALL_R;
      ball.vy = -Math.abs(ball.vy);
    }

    /* player paddle (left) — swept: only a ball crossing the paddle plane counts */
    if (ball.vx < 0 &&
        prevX - BALL_R > WALL + PADDLE_W &&
        ball.x - BALL_R <= WALL + PADDLE_W &&
        ball.y + BALL_R >= player.y &&
        ball.y - BALL_R <= player.y + PADDLE_H) {
      ball.x = WALL + PADDLE_W + BALL_R;
      bounce(player, true);
    }

    /* AI paddle (right) */
    var rx = W - WALL - PADDLE_W;
    if (ball.vx > 0 &&
        prevX + BALL_R < rx &&
        ball.x + BALL_R >= rx &&
        ball.y + BALL_R >= ai.y &&
        ball.y - BALL_R <= ai.y + PADDLE_H) {
      ball.x = rx - BALL_R;
      bounce(ai, false);
    }

    /* goals */
    if (ball.x + BALL_R < 0) point('ai');
    else if (ball.x - BALL_R > W) point('you');
  }

  /* ---------------- draw ---------------- */

  function drawPaddle(x, y, colour) {
    ctx.save();
    ctx.shadowColor = colour;
    ctx.shadowBlur = flash > 0 ? 26 : 15;
    ctx.fillStyle = colour;
    roundRect(x, y, PADDLE_W, PADDLE_H, 7);
    ctx.fill();
    ctx.restore();
  }

  function draw() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b1224');
    g.addColorStop(1, '#05070e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* dashed centre line */
    ctx.save();
    ctx.setLineDash([12, 18]);
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(232, 238, 252, .12)';
    ctx.beginPath();
    ctx.moveTo(W / 2, 14);
    ctx.lineTo(W / 2, H - 14);
    ctx.stroke();
    ctx.restore();

    /* centre circle */
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, 62, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(232, 238, 252, .07)';
    ctx.lineWidth = 2;
    ctx.stroke();

    /* ghost scores behind the play */
    ctx.save();
    ctx.font = '700 72px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(232, 238, 252, .06)';
    ctx.fillText(String(match.you), W / 2 - 112, 76);
    ctx.fillText(String(match.ai), W / 2 + 112, 76);
    ctx.restore();

    drawPaddle(WALL, player.y, '#00d9ff');
    drawPaddle(W - WALL - PADDLE_W, ai.y, '#ff5c7a');

    /* ball */
    ctx.save();
    ctx.shadowColor = '#e8eefc';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#e8eefc';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (state === 'running' && (awaiting || serveMs > 0)) {
      ctx.save();
      ctx.font = '600 16px "Segoe UI", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgba(232, 238, 252, .78)';
      ctx.fillText(awaiting ? 'Press Space or tap to serve' : 'Get ready…', W / 2, H / 2 + 122);
      ctx.restore();
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);      /* cap so tab jumps never teleport */
    lastT = t;
    var k = dt / 16.67;                    /* normalise to 60fps frames */
    if (state === 'running') update(dt, k);
    draw();
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pointerToY(e) {
    var rect = canvas.getBoundingClientRect();
    var scale = rect.height ? H / rect.height : 1;
    return (e.clientY - rect.top) * scale;
  }

  function movePlayerTo(y) {
    player.y = clamp(y - PADDLE_H / 2, 0, H - PADDLE_H);
  }

  canvas.addEventListener('pointermove', function (e) {
    if (state !== 'running') return;
    movePlayerTo(pointerToY(e));
  });

  canvas.addEventListener('pointerdown', function (e) {
    e.preventDefault();
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state !== 'running') return;
    movePlayerTo(pointerToY(e));
    if (awaiting || serveMs > 0) launchNow();
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' ||
        k === 'ArrowRight' || k === ' ') {
      e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') keys.up = true;
    else if (k === 'ArrowDown' || k === 's' || k === 'S') keys.down = true;
    else if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else if (state === 'running') {
        if (awaiting || serveMs > 0) launchNow();
        else pause();
      }
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
  });

  window.addEventListener('blur', function () {
    keys.up = false;
    keys.down = false;
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var b = 0; b < actionBtns.length; b++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        if (action === 'pause') {
          if (state === 'running') pause();
          else if (state === 'paused') resume();
        } else if (action === 'new') {
          start();
        }
      });
    })(actionBtns[b]);
  }

  /* auto-pause when the tab is hidden; the ball stays exactly where it is */
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) return;
    keys.up = false;
    keys.down = false;
    if (state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Pong Arena',
    msg: 'Move your paddle with the mouse, a finger drag or the arrow keys. First to 7 points wins the match — the winner keeps the streak alive.',
    stats: [{ label: 'Best streak', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
