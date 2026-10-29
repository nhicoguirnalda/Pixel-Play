/* ============================================================
   Neon Snake — original game for PixelPlay
   Canvas arcade game: keyboard, swipe and on-screen d-pad.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var COLS = 20, ROWS = 20, CELL = 30;
  var W = COLS * CELL, H = ROWS * CELL;
  var BEST_KEY = 'snake';

  var snake, dir, queue, food, score, stepMs;
  var snake2, dir2, queue2, score2, dead1, dead2, eaten;
  var duo = false;
  var best = GameShell.best.get(BEST_KEY, 0);
  var state = 'ready';               /* ready | running | paused | over */
  var lastTick = 0, rafId = 0, spawnAt = 0, newBest = false;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function mix(a, b, t) {
    return 'rgb(' +
      Math.round(a[0] + (b[0] - a[0]) * t) + ',' +
      Math.round(a[1] + (b[1] - a[1]) * t) + ',' +
      Math.round(a[2] + (b[2] - a[2]) * t) + ')';
  }

  function shownBest() { return Math.max(best, score || 0); }

  function placeFood() {
    var ok = false, x, y, i;
    while (!ok) {
      x = rand(COLS);
      y = rand(ROWS);
      ok = true;
      for (i = 0; i < snake.length; i++) {
        if (snake[i].x === x && snake[i].y === y) { ok = false; break; }
      }
      for (i = 0; ok && i < snake2.length; i++) {
        if (snake2[i].x === x && snake2[i].y === y) { ok = false; break; }
      }
    }
    food = { x: x, y: y };
    spawnAt = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function reset() {
    snake = [{ x: 8, y: 10 }, { x: 7, y: 10 }, { x: 6, y: 10 }];
    dir = { x: 1, y: 0 };
    queue = [];
    score = 0;
    snake2 = [{ x: COLS - 9, y: ROWS - 11 }, { x: COLS - 8, y: ROWS - 11 }, { x: COLS - 7, y: ROWS - 11 }];
    dir2 = { x: -1, y: 0 };
    queue2 = [];
    score2 = 0;
    dead1 = dead2 = false;
    eaten = 0;
    stepMs = 130;
    newBest = false;
    placeFood();
    updateHud();
  }

  function updateHud() {
    if (duo) {
      GameShell.hud({ P1: score, P2: score2 },
                    state === 'paused' ? '⏸ Paused' : 'Duo · first to eat the orbs');
    } else {
      GameShell.hud({ Score: score || 0, Best: shownBest() },
                    state === 'paused' ? '⏸ Paused' : '');
    }
  }

  /* ---------------- game states ---------------- */

  function start() {
    reset();
    state = 'running';
    lastTick = now();
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
      msg: 'Your run is waiting for you.',
      stats: duo ? [{ label: 'P1', value: score }, { label: 'P2', value: score2 }]
                 : [{ label: 'Score', value: score }, { label: 'Best', value: best }],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    lastTick = now();
    GameShell.overlay.hide();
    updateHud();
  }

  function gameOver() {
    state = 'over';
    if (duo) {
      updateHud();
      var title = score > score2 ? 'Player 1 wins!' :
                  score2 > score ? 'Player 2 wins!' : "It's a draw!";
      GameShell.overlay.show({
        title: title,
        msg: 'Player 1 ate ' + score + ' points and Player 2 ate ' + score2 +
             '. Press Duo to go back to solo, or play another match.',
        stats: [
          { label: 'Player 1', value: score },
          { label: 'Player 2', value: score2 }
        ],
        btn: '▶ Play again',
        action: start
      });
      return;
    }
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Game over',
      msg: 'You scored ' + score + ' point' + (score === 1 ? '' : 's') + '. How far can you go next time?',
      stats: [{ label: 'Score', value: score }, { label: 'Best', value: best }],
      btn: '▶ Play again',
      action: start
    });
  }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  /* ---------------- input ---------------- */

  function turn(x, y) {
    var last = queue.length ? queue[queue.length - 1] : dir;
    if ((last.x === -x && last.y === -y) || (last.x === x && last.y === y)) return;
    if (queue.length < 2) queue.push({ x: x, y: y });
  }

  function steer(name) {
    if (state === 'ready') start();
    if (state !== 'running') return;
    if (name === 'up') turn(0, -1);
    else if (name === 'down') turn(0, 1);
    else if (name === 'left') turn(-1, 0);
    else if (name === 'right') turn(1, 0);
  }

  function turn2(x, y) {
    var last = queue2.length ? queue2[queue2.length - 1] : dir2;
    if ((last.x === -x && last.y === -y) || (last.x === x && last.y === y)) return;
    if (queue2.length < 2) queue2.push({ x: x, y: y });
  }

  function steer2(name) {
    if (state === 'ready') start();
    if (state !== 'running') return;
    if (name === 'up') turn2(0, -1);
    else if (name === 'down') turn2(0, 1);
    else if (name === 'left') turn2(-1, 0);
    else if (name === 'right') turn2(1, 0);
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' || k === ' ') {
      e.preventDefault();
    }

    if (duo) {
      if (k === 'ArrowUp') steer2('up');
      else if (k === 'ArrowDown') steer2('down');
      else if (k === 'ArrowLeft') steer2('left');
      else if (k === 'ArrowRight') steer2('right');
      else if (k === 'w' || k === 'W') steer('up');
      else if (k === 's' || k === 'S') steer('down');
      else if (k === 'a' || k === 'A') steer('left');
      else if (k === 'd' || k === 'D') steer('right');
    } else if (k === 'ArrowUp' || k === 'w' || k === 'W') steer('up');
    else if (k === 'ArrowDown' || k === 's' || k === 'S') steer('down');
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') steer('left');
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') steer('right');

    if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  var padBtns = document.querySelectorAll('[data-dir]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        steer(btn.getAttribute('data-dir'));
      });
    })(padBtns[b]);
  }

  var touchX = 0, touchY = 0;
  canvas.addEventListener('touchstart', function (e) {
    if (!e.touches[0]) return;
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });

  canvas.addEventListener('touchend', function (e) {
    if (!e.changedTouches[0]) return;
    var dx = e.changedTouches[0].clientX - touchX;
    var dy = e.changedTouches[0].clientY - touchY;
    if (Math.abs(dx) < 24 && Math.abs(dy) < 24) {
      if (state === 'ready') start();
      return;
    }
    if (state === 'ready') start();
    if (Math.abs(dx) > Math.abs(dy)) steer(dx > 0 ? 'right' : 'left');
    else steer(dy > 0 ? 'down' : 'up');
  }, { passive: true });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- update ---------------- */

  function inSnake(x, y, body, grow) {
    var limit = grow ? body.length : body.length - 1;
    for (var i = 0; i < limit; i++) {
      if (body[i].x === x && body[i].y === y) return true;
    }
    return false;
  }

  function update() {
    if (duo) updateDuo();
    else updateSolo();
  }

  function updateSolo() {
    if (queue.length) dir = queue.shift();

    var head = snake[0];
    var nx = head.x + dir.x;
    var ny = head.y + dir.y;

    if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) { gameOver(); return; }

    var willGrow = (nx === food.x && ny === food.y);
    var limit = willGrow ? snake.length : snake.length - 1;
    for (var i = 0; i < limit; i++) {
      if (snake[i].x === nx && snake[i].y === ny) { gameOver(); return; }
    }

    snake.unshift({ x: nx, y: ny });

    if (willGrow) {
      score += 10;
      eaten++;
      stepMs = Math.max(65, 130 - Math.floor(eaten / 5) * 5);
      placeFood();
      updateHud();
    } else {
      snake.pop();
    }
  }

  function updateDuo() {
    if (dead1 && dead2) { gameOver(); return; }
    if (queue.length) dir = queue.shift();
    if (queue2.length) dir2 = queue2.shift();

    var n1 = null, n2 = null, grow1 = false, grow2 = false;
    if (!dead1) {
      n1 = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };
      grow1 = n1.x === food.x && n1.y === food.y;
    }
    if (!dead2) {
      n2 = { x: snake2[0].x + dir2.x, y: snake2[0].y + dir2.y };
      grow2 = n2.x === food.x && n2.y === food.y;
    }

    var headOn = n1 && n2 && n1.x === n2.x && n1.y === n2.y;

    var wall1 = n1 && (n1.x < 0 || n1.y < 0 || n1.x >= COLS || n1.y >= ROWS);
    var wall2 = n2 && (n2.x < 0 || n2.y < 0 || n2.x >= COLS || n2.y >= ROWS);

    var crash1 = !!n1 && (wall1 || headOn ||
      inSnake(n1.x, n1.y, snake, grow1) ||
      (!dead2 && inSnake(n1.x, n1.y, snake2, grow2)));
    var crash2 = !!n2 && (wall2 || headOn ||
      inSnake(n2.x, n2.y, snake2, grow2) ||
      (!dead1 && inSnake(n2.x, n2.y, snake, grow1)));

    if (crash1) { dead1 = true; snake = []; }
    if (crash2) { dead2 = true; snake2 = []; }
    if (dead1 && dead2) { gameOver(); return; }

    if (!dead1) {
      snake.unshift(n1);
      if (grow1) score += 10; else snake.pop();
    }
    if (!dead2) {
      snake2.unshift(n2);
      if (grow2) score2 += 10; else snake2.pop();
    }

    if (grow1 || grow2) {
      eaten++;
      stepMs = Math.max(65, 130 - Math.floor(eaten / 5) * 5);
      placeFood();
    }
    updateHud();
  }

  /* ---------------- draw ---------------- */

  function draw(t) {
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = 'rgba(255,255,255,.045)';
    ctx.lineWidth = 1;
    for (var x = 1; x < COLS; x++) {
      ctx.beginPath();
      ctx.moveTo(x * CELL + .5, 0);
      ctx.lineTo(x * CELL + .5, H);
      ctx.stroke();
    }
    for (var y = 1; y < ROWS; y++) {
      ctx.beginPath();
      ctx.moveTo(0, y * CELL + .5);
      ctx.lineTo(W, y * CELL + .5);
      ctx.stroke();
    }

    /* food — pulsing glow */
    if (food) {
      var pulse = 0.82 + Math.sin((t - spawnAt) / 220) * 0.1;
      var fr = (CELL * 0.34) * pulse;
      ctx.save();
      ctx.shadowColor = '#ff5c7a';
      ctx.shadowBlur = 18;
      ctx.fillStyle = '#ff5c7a';
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, fr, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,.75)';
      ctx.beginPath();
      ctx.arc(food.x * CELL + CELL / 2 - fr * 0.3, food.y * CELL + CELL / 2 - fr * 0.3, fr * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }

    drawSnakeBody(snake, dir, [46, 230, 166], [14, 165, 233]);
    if (duo) drawSnakeBody(snake2, dir2, [244, 114, 182], [192, 132, 252]);
  }

  function drawSnakeBody(body, d, headCol, tailCol) {
    if (!body || !body.length) return;
    var n = body.length;

    for (var i = n - 1; i >= 0; i--) {
      var seg = body[i];
      var t2 = n === 1 ? 0 : i / (n - 1);
      var pad = 2 + t2 * 3;
      ctx.fillStyle = mix(headCol, tailCol, t2);
      rr(seg.x * CELL + pad, seg.y * CELL + pad, CELL - pad * 2, CELL - pad * 2, 8 - t2 * 3);
      ctx.fill();
    }

    /* eyes on the head */
    var h = body[0];
    var cx = h.x * CELL + CELL / 2;
    var cy = h.y * CELL + CELL / 2;
    var px = -d.y, py = d.x;
    var fx = d.x * 5, fy = d.y * 5;
    for (var s = -1; s <= 1; s += 2) {
      var ex = cx + fx + px * s * 5;
      var ey = cy + fy + py * s * 5;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(ex, ey, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#05070e';
      ctx.beginPath();
      ctx.arc(ex + d.x * 1.5, ey + d.y * 1.5, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (state === 'running') {
      var guard = 0;
      while (t - lastTick >= stepMs && guard++ < 6) {
        lastTick += stepMs;
        update();
        if (state !== 'running') break;
      }
    }
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- boot ---------------- */

  function startDuo() {
    duo = true;
    start();
  }

  function stopDuo() {
    duo = false;
    start();
  }

  if (typeof GameShell.onDuo === 'function') GameShell.onDuo(startDuo, stopDuo);

  reset();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Neon Snake',
    msg: 'Steer with the arrow keys, WASD, a swipe or the pad below. Eat the glowing orbs to grow — avoid the walls and your own tail. For two players at once, press Duo in the HUD: P1 uses WASD, P2 uses the arrow keys and both chase the same orbs.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);

  window.__snake = {
    state: function () { return state; },
    duo: function () { return duo; },
    scores: function () { return { p1: score, p2: score2 }; },
    dead: function () { return { p1: dead1, p2: dead2 }; },
    food: function () { return food ? { x: food.x, y: food.y } : null; },
    bodies: function () {
      return {
        p1: snake.map(function (s) { return { x: s.x, y: s.y }; }),
        p2: snake2.map(function (s) { return { x: s.x, y: s.y }; })
      };
    }
  };
})();
