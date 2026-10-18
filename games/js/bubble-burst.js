/* ============================================================
   Bubble Burst — original game for PixelPlay
   Canvas bubble shooter: aim with the pointer, pop groups of
   three or more matching bubbles, drop loose clumps for bonus
   points and clear the whole board to advance a level.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  canvas.style.touchAction = 'none';   /* keep drags on the board from scrolling the page */

  /* ---------------- board geometry ---------------- */

  var W = 600, H = 640;
  var R = 24;                          /* bubble radius */
  var D = R * 2;                       /* horizontal pitch inside a row */
  var COLS = 12, ROWS = 13;
  var ROW_H = R * Math.sqrt(3);        /* staggered row pitch (hex packing) */
  var DANGER_Y = R + (ROWS - 1) * ROW_H + R;  /* wall touching this line ends the round */
  var SHOOT_X = W / 2, SHOOT_Y = H - 46;
  var HIT_R = D - 4;                   /* collision radius against a bubble */
  var SHOTS_PER_ROW = 8;               /* a new row every this many shots */
  var SHOT_SPEED = 900;                /* pixels per second */

  var BEST_KEY = 'bubble-burst';
  var COLORS = ['#38bdf8', '#a855f7', '#4ade80', '#facc15', '#fb7185', '#22d3ee'];
  var LIGHT = ['#bae6fd', '#e9d5ff', '#bbf7d0', '#fde68a', '#fecdd3', '#a5f3fc'];

  /* ---------------- state ---------------- */

  var grid = null;                     /* ROWS x COLS of colour index or null */
  var level = 1, score = 0, paletteSize = 4, shotCount = 0;
  var curColor = 0, nextColor = 0;
  var shot = null;                     /* the bubble in flight */
  var pops = [];                       /* little burst animations */
  var pendingLevel = false;
  var newBest = false;
  var state = 'ready';                 /* ready | running | paused | over */
  var best = GameShell.best.get(BEST_KEY, 0);
  var aimX = W / 2, aimY = 160;
  var rafId = 0, lastFrame = 0;

  /* ---------------- helpers ---------------- */

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function shownBest() { return Math.max(best, score || 0); }

  function cellX(r, c) { return R + c * D + (r % 2) * R; }
  function cellY(r) { return R + r * ROW_H; }

  function rowGuess(y) {
    var r = Math.round((y - R) / ROW_H);
    if (r < 0) return 0;
    if (r > ROWS - 1) return ROWS - 1;
    return r;
  }

  function neighborsOf(r, c) {
    var odd = (r % 2) === 1;
    return [
      [r, c - 1], [r, c + 1],
      [r - 1, c - (odd ? 0 : 1)], [r - 1, c + (odd ? 1 : 0)],
      [r + 1, c - (odd ? 0 : 1)], [r + 1, c + (odd ? 1 : 0)]
    ];
  }

  function blurActive() {
    var el = document.activeElement;
    if (el && el.blur) { try { el.blur(); } catch (e) { /* ignore */ } }
  }

  function addPop(r, c, color) {
    pops.push({ x: cellX(r, c), y: cellY(r), color: color, t: 1 });
    if (pops.length > 90) pops.shift();
  }

  /* ---------------- board ---------------- */

  function buildBoard(lvl) {
    paletteSize = Math.min(COLORS.length, 2 + lvl);
    var fillRows = Math.min(ROWS - 5, 3 + lvl);
    grid = [];
    for (var r = 0; r < ROWS; r++) {
      var row = [];
      for (var c = 0; c < COLS; c++) {
        row.push(r < fillRows ? Math.floor(Math.random() * paletteSize) : null);
      }
      grid.push(row);
    }
    shotCount = 0;
  }

  /* pick a colour that is still on the board so a payout is always possible */
  function randomColor() {
    var present = [], opts = [], i;
    for (i = 0; i < paletteSize; i++) present[i] = false;
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        var v = grid[r][c];
        if (v !== null && v >= 0 && v < paletteSize) present[v] = true;
      }
    }
    for (i = 0; i < paletteSize; i++) if (present[i]) opts.push(i);
    if (!opts.length) for (i = 0; i < paletteSize; i++) opts.push(i);
    return opts[Math.floor(Math.random() * opts.length)];
  }

  function boardEmpty() {
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) if (grid[r][c] !== null) return false;
    }
    return true;
  }

  function reachBottom() {
    for (var c = 0; c < COLS; c++) if (grid[ROWS - 1][c] !== null) return true;
    return false;
  }

  function reset() {
    level = 1;
    score = 0;
    newBest = false;
    pendingLevel = false;
    shot = null;
    pops = [];
    buildBoard(level);
    curColor = Math.floor(Math.random() * paletteSize);
    nextColor = randomColor();
    updateHud();
  }

  function updateHud() {
    var right = (state === 'paused' ? '⏸ Paused · ' : '') + 'Level ' + level;
    GameShell.hud({ Score: score || 0, Best: shownBest() }, right);
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

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'Your bubble shooter is waiting. Press P or the button when you are ready.',
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

  function levelClear() {
    score += 250;
    level++;
    state = 'paused';
    pendingLevel = true;
    updateHud();
    GameShell.overlay.show({
      title: 'Board cleared! 🫧',
      msg: 'Every bubble is gone — 250 bonus points banked. Level ' + level +
           ' starts with a deeper wall and an extra colour.',
      stats: [{ label: 'Score', value: score }, { label: 'Level', value: level }],
      btn: '▶ Continue',
      action: continueLevel
    });
  }

  function continueLevel() {
    pendingLevel = false;
    shot = null;
    pops = [];
    buildBoard(level);
    curColor = Math.floor(Math.random() * paletteSize);
    nextColor = randomColor();
    state = 'running';
    lastFrame = now();
    GameShell.overlay.hide();
    blurActive();
    updateHud();
  }

  function gameOver() {
    if (state === 'over') return;
    state = 'over';
    shot = null;
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New high score!' : 'Game over',
      msg: 'The bubbles crossed the danger line. You cleared ' + (level - 1) +
           ' board' + (level - 1 === 1 ? '' : 's') + ' and scored ' + score +
           ' point' + (score === 1 ? '' : 's') + '.',
      stats: [{ label: 'Score', value: score }, { label: 'Best', value: best }],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- shooting ---------------- */

  function aimVector() {
    var dx = aimX - SHOOT_X, dy = aimY - SHOOT_Y;
    if (dy > -30) dy = -30;              /* never aim straight down or sideways */
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  function hitsBubble(x, y) {
    var r0 = rowGuess(y);
    var r1 = Math.max(0, r0 - 1), r2 = Math.min(ROWS - 1, r0 + 1);
    for (var r = r1; r <= r2; r++) {
      var cy = cellY(r);
      for (var c = 0; c < COLS; c++) {
        if (grid[r][c] === null) continue;
        var dx = x - cellX(r, c), dy = y - cy;
        if (dx * dx + dy * dy < HIT_R * HIT_R) return true;
      }
    }
    return false;
  }

  function fire() {
    if (state === 'ready' || state === 'over') { start(); return; }
    if (state !== 'running' || shot || pendingLevel) return;
    var v = aimVector();
    shot = { x: SHOOT_X, y: SHOOT_Y, dx: v.x, dy: v.y, color: curColor };
    curColor = nextColor;
    nextColor = randomColor();
  }

  function snapShot() {
    if (!shot) return;
    var x = shot.x, y = shot.y, color = shot.color;
    shot = null;

    var guess = rowGuess(y);
    var cell = null, bestD = Infinity;
    var r1 = Math.max(0, guess - 2), r2 = Math.min(ROWS - 1, guess + 2);
    for (var r = r1; r <= r2; r++) {
      var cy = cellY(r);
      for (var c = 0; c < COLS; c++) {
        if (grid[r][c] !== null) continue;
        var dx = x - cellX(r, c), dy = y - cy;
        var d2 = dx * dx + dy * dy;
        if (d2 < bestD) { bestD = d2; cell = { r: r, c: c }; }
      }
    }
    if (!cell) { gameOver(); return; }    /* the board is packed solid */

    grid[cell.r][cell.c] = color;
    resolveMatches(cell.r, cell.c);
    if (state !== 'running') return;

    if (boardEmpty()) { levelClear(); return; }

    shotCount++;
    if (shotCount >= SHOTS_PER_ROW) { shotCount = 0; descend(); }
    if (state !== 'running') return;
    if (reachBottom()) gameOver();
    updateHud();
  }

  function descend() {
    var row = [];
    for (var c = 0; c < COLS; c++) row.push(randomColor());
    for (var r = ROWS - 1; r > 0; r--) grid[r] = grid[r - 1].slice();
    grid[0] = row;
  }

  function collectGroup(r, c, color) {
    var seen = [], out = [], stack = [[r, c]];
    var i;
    for (i = 0; i < ROWS * COLS; i++) seen[i] = false;
    seen[r * COLS + c] = true;
    while (stack.length) {
      var cur = stack.pop();
      out.push({ r: cur[0], c: cur[1] });
      var nb = neighborsOf(cur[0], cur[1]);
      for (i = 0; i < nb.length; i++) {
        var rr = nb[i][0], cc = nb[i][1];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        var k = rr * COLS + cc;
        if (seen[k] || grid[rr][cc] !== color) continue;
        seen[k] = true;
        stack.push([rr, cc]);
      }
    }
    return out;
  }

  function resolveMatches(r, c) {
    var color = grid[r][c];
    if (color === null) return;
    var group = collectGroup(r, c, color);
    if (group.length < 3) return;

    for (var i = 0; i < group.length; i++) {
      addPop(group[i].r, group[i].c, color);
      grid[group[i].r][group[i].c] = null;
    }
    score += group.length * 10;
    dropFloaters();
    updateHud();
  }

  /* anything no longer connected to the ceiling falls for a bonus */
  function dropFloaters() {
    var attached = [], stack = [], i;
    for (i = 0; i < ROWS * COLS; i++) attached[i] = false;
    for (var c = 0; c < COLS; c++) {
      if (grid[0][c] !== null) { attached[c] = true; stack.push([0, c]); }
    }
    while (stack.length) {
      var cur = stack.pop();
      var nb = neighborsOf(cur[0], cur[1]);
      for (i = 0; i < nb.length; i++) {
        var rr = nb[i][0], cc = nb[i][1];
        if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) continue;
        var k = rr * COLS + cc;
        if (attached[k] || grid[rr][cc] === null) continue;
        attached[k] = true;
        stack.push([rr, cc]);
      }
    }
    var dropped = 0;
    for (var r = 0; r < ROWS; r++) {
      for (var c2 = 0; c2 < COLS; c2++) {
        if (grid[r][c2] !== null && !attached[r * COLS + c2]) {
          addPop(r, c2, grid[r][c2]);
          grid[r][c2] = null;
          dropped++;
        }
      }
    }
    if (dropped) score += dropped * 20;
    return dropped;
  }

  /* ---------------- update ---------------- */

  function updateShot(dt) {
    if (!shot) return;
    var dist = SHOT_SPEED * (dt / 1000);
    var steps = Math.ceil(dist / 5);
    if (steps < 1) steps = 1;
    var sx = shot.dx * dist / steps, sy = shot.dy * dist / steps;

    for (var i = 0; i < steps; i++) {
      shot.x += sx;
      shot.y += sy;

      if (shot.x < R && sx < 0) { shot.x = R; sx = -sx; shot.dx = -shot.dx; }
      else if (shot.x > W - R && sx > 0) { shot.x = W - R; sx = -sx; shot.dx = -shot.dx; }

      if (shot.y <= R || shot.y < -R || hitsBubble(shot.x, shot.y)) { snapShot(); return; }
    }
  }

  function updatePops(dt) {
    for (var i = pops.length - 1; i >= 0; i--) {
      pops[i].t -= dt / 300;
      if (pops[i].t <= 0) pops.splice(i, 1);
    }
  }

  /* ---------------- aim guide ---------------- */

  function traceAim() {
    var v = aimVector();
    var dx = v.x, dy = v.y;
    var x = SHOOT_X, y = SHOOT_Y;
    var pts = [{ x: x, y: y }];
    var step = 7, guard = 0;

    while (guard++ < 220) {
      x += dx * step;
      y += dy * step;
      if (x < R) { x = R; dx = -dx; pts.push({ x: x, y: y }); }
      else if (x > W - R) { x = W - R; dx = -dx; pts.push({ x: x, y: y }); }
      if (y <= R) { pts.push({ x: x, y: y }); break; }
      if (hitsBubble(x, y)) { pts.push({ x: x, y: y }); break; }
    }
    return pts;
  }

  /* ---------------- draw ---------------- */

  function drawBubble(x, y, color, scale) {
    if (color === null || color === undefined || !COLORS[color]) return;
    var rad = R * (scale === undefined ? 1 : scale);
    if (rad < 0.5) return;
    var g = ctx.createRadialGradient(x - rad * 0.32, y - rad * 0.36, rad * 0.16, x, y, rad);
    g.addColorStop(0, LIGHT[color]);
    g.addColorStop(0.6, COLORS[color]);
    g.addColorStop(1, COLORS[color]);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.24)';
    ctx.lineWidth = 1.4;
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.6)';
    ctx.beginPath();
    ctx.arc(x - rad * 0.32, y - rad * 0.36, rad * 0.17, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAim() {
    var pts = traceAim();
    ctx.save();
    ctx.fillStyle = 'rgba(226,232,240,.55)';
    for (var i = 0; i < pts.length - 1; i++) {
      var ax = pts[i].x, ay = pts[i].y;
      var bx = pts[i + 1].x, by = pts[i + 1].y;
      var len = Math.sqrt((bx - ax) * (bx - ax) + (by - ay) * (by - ay));
      var n = Math.max(1, Math.floor(len / 16));
      for (var k = 0; k < n; k++) {
        var t = k / n;
        var px = ax + (bx - ax) * t, py = ay + (by - ay) * t;
        var fade = 0.9 - (i / Math.max(1, pts.length)) * 0.5;
        ctx.globalAlpha = fade * (1 - t * 0.4);
        ctx.beginPath();
        ctx.arc(px, py, 2.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();

    var last = pts[pts.length - 1];
    ctx.save();
    ctx.strokeStyle = 'rgba(226,232,240,.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(last.x, last.y, R * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    ctx.fillStyle = 'rgba(255,255,255,.02)';
    ctx.fillRect(0, 0, W, H);

    /* ceiling bar */
    ctx.fillStyle = 'rgba(148,163,184,.28)';
    ctx.fillRect(0, 0, W, 4);

    /* danger line */
    ctx.save();
    ctx.strokeStyle = 'rgba(248,113,113,.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.moveTo(0, DANGER_Y + .5);
    ctx.lineTo(W, DANGER_Y + .5);
    ctx.stroke();
    ctx.restore();

    /* the wall */
    for (var r = 0; r < ROWS; r++) {
      for (var c = 0; c < COLS; c++) {
        if (grid[r][c] === null) continue;
        drawBubble(cellX(r, c), cellY(r), grid[r][c], 1);
      }
    }

    /* bursts */
    for (var i = 0; i < pops.length; i++) {
      var p = pops[i];
      ctx.save();
      ctx.globalAlpha = Math.max(0, p.t);
      drawBubble(p.x, p.y - (1 - p.t) * 16, p.color, p.t * 1.1);
      ctx.restore();
    }

    if (state === 'running' && !pendingLevel) drawAim();

    /* launcher */
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.16)';
    ctx.beginPath();
    ctx.arc(SHOOT_X, SHOOT_Y, R + 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,232,240,.22)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    if (!pendingLevel && state !== 'over') {
      drawBubble(SHOOT_X, SHOOT_Y, curColor, 1);
      drawBubble(SHOOT_X + 74, SHOOT_Y, nextColor, 0.82);
      ctx.save();
      ctx.fillStyle = 'rgba(148,163,184,.75)';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('NEXT', SHOOT_X + 74, SHOOT_Y + R + 18);
      ctx.restore();
    }

    /* bubble in flight */
    if (shot) drawBubble(shot.x, shot.y, shot.color, 1);

    /* shots until the wall descends */
    ctx.save();
    ctx.fillStyle = 'rgba(148,163,184,.7)';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('Next row in ' + (SHOTS_PER_ROW - shotCount) + ' shot' +
                 (SHOTS_PER_ROW - shotCount === 1 ? '' : 's'), 14, H - 14);
    ctx.restore();
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastFrame) lastFrame = t;
    var dt = t - lastFrame;
    lastFrame = t;
    if (dt > 50) dt = 50;
    if (dt < 0) dt = 0;

    if (state === 'running') {
      updateShot(dt);
      updatePops(dt);
    }
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
    if (!rect.width || !rect.height) return null;
    return {
      x: (clientX - rect.left) * (W / rect.width),
      y: (clientY - rect.top) * (H / rect.height)
    };
  }

  canvas.addEventListener('pointermove', function (ev) {
    var p = toCanvas(ev.clientX, ev.clientY);
    if (!p) return;
    aimX = p.x;
    aimY = p.y;
  });

  canvas.addEventListener('pointerdown', function (ev) {
    ev.preventDefault();
    var p = toCanvas(ev.clientX, ev.clientY);
    if (p) { aimX = p.x; aimY = p.y; }
    if (state === 'ready' || state === 'over') { start(); return; }
    fire();
  });

  canvas.addEventListener('touchmove', function (ev) {
    if (!ev.touches[0]) return;
    var p = toCanvas(ev.touches[0].clientX, ev.touches[0].clientY);
    if (!p) return;
    aimX = p.x;
    aimY = p.y;
  }, { passive: true });

  document.addEventListener('keydown', function (e) {
    if (isForm(e.target)) return;
    var k = e.key;

    if (k === ' ' || k === 'Enter') {
      e.preventDefault();
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

  var fireBtn = document.getElementById('btnFire');
  if (fireBtn) {
    fireBtn.addEventListener('click', function () {
      if (state === 'ready' || state === 'over') start();
      else fire();
    });
  }

  var pauseBtn = document.getElementById('btnPause');
  if (pauseBtn) {
    pauseBtn.addEventListener('click', function () {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    });
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Bubble Burst',
    msg: 'Aim with the mouse or your finger — the guide bounces off the side walls. ' +
         'Fire with a click or tap, pop groups of three or more matching bubbles and ' +
         'clear the board before the wall reaches the danger line.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* read-only snapshot for automated smoke tests */
  window.__bubbleBurst = {
    state: function () { return state; },
    score: function () { return score; },
    level: function () { return level; },
    colors: function () { return { cur: curColor, next: nextColor }; },
    grid: function () {
      return grid.map(function (row) { return row.slice(); });
    }
  };
})();
