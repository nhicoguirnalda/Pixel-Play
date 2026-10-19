/* ============================================================
   Neon Blocks — original game for PixelPlay
   Canvas block-stacking classic: 10×20 well, seven neon shapes,
   7-bag randomiser, ghost piece, hold queue, lock delay and
   live scoring. Keyboard first, on-screen buttons for touch.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var COLS = 10, ROWS = 20, CELL = 24;
  var WELL_W = COLS * CELL, WELL_H = ROWS * CELL;   /* 240 × 480 */
  var WELL_X = 48, WELL_Y = 60;
  var PANEL_X = 336, PANEL_W = 216;
  var BEST_KEY = 'neon-blocks';
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

  /* ---------------- shapes ---------------- */

  var ORDER = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
  var COLORS = {
    I: '#22d3ee', O: '#facc15', T: '#a855f7',
    S: '#2ee6a6', Z: '#ff5c7a', J: '#60a5fa', L: '#fb923c'
  };
  var SHAPES = {
    I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
    O: [[1, 1], [1, 1]],
    T: [[0, 1, 0], [1, 1, 1], [0, 0, 0]],
    S: [[0, 1, 1], [1, 1, 0], [0, 0, 0]],
    Z: [[1, 1, 0], [0, 1, 1], [0, 0, 0]],
    J: [[1, 0, 0], [1, 1, 1], [0, 0, 0]],
    L: [[0, 0, 1], [1, 1, 1], [0, 0, 0]]
  };
  var KICKS = [[0, 0], [-1, 0], [1, 0], [0, -1], [-2, 0], [2, 0]];
  var LINE_SCORE = [0, 100, 300, 500, 800];

  var DAS_DELAY = 0.15, ARR = 0.05;
  var LOCK_DELAY = 0.5, LOCK_RESETS_MAX = 15;
  var CLEAR_TIME = 0.34;

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | over */
  var board = [];
  var piece = null;               /* { type, rot, m, x, y } */
  var queue = [], holdType = null, holdUsed = false;
  var score = 0, lines = 0, level = 1;
  var best = GameShell.best.get(BEST_KEY, 0);
  var gravT = 0, lockT = 0, lockResets = 0;
  var clearRows = [], clearT = 0;
  var keys = { left: false, right: false, soft: false };
  var das = { dir: 0, t: 0, arr: 0 };
  var hudDirty = true;
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clone(m) {
    var out = [];
    for (var r = 0; r < m.length; r++) out.push(m[r].slice());
    return out;
  }

  function rotCW(m) {
    var n = m.length, out = [];
    for (var r = 0; r < n; r++) out.push([]);
    for (r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) out[c][n - 1 - r] = m[r][c];
    }
    return out;
  }

  function collides(m, px, py) {
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (!m[r][c]) continue;
        var bx = px + c, by = py + r;
        if (bx < 0 || bx >= COLS || by >= ROWS) return true;
        if (by >= 0 && board[by][bx]) return true;
      }
    }
    return false;
  }

  function emptyRow() {
    var row = [];
    for (var i = 0; i < COLS; i++) row.push(null);
    return row;
  }

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function gravInterval() {
    var g = 0.9 - (level - 1) * 0.075;
    return g < 0.05 ? 0.05 : g;
  }

  /* ---------------- bag / spawning ---------------- */

  function refillQueue() {
    while (queue.length < 6) {
      var bag = ORDER.slice();
      for (var i = bag.length - 1; i > 0; i--) {
        var j = rand(i + 1);
        var tmp = bag[i]; bag[i] = bag[j]; bag[j] = tmp;
      }
      for (var k = 0; k < bag.length; k++) queue.push(bag[k]);
    }
  }

  function spawnNext() {
    refillQueue();
    var type = queue.shift();
    piece = { type: type, rot: 0, m: clone(SHAPES[type]), x: type === 'O' ? 4 : 3, y: 0 };
    gravT = 0; lockT = 0; lockResets = 0; holdUsed = false;
    if (collides(piece.m, piece.x, piece.y)) gameOver();
  }

  function ghostY() {
    if (!piece) return 0;
    var gy = piece.y;
    while (!collides(piece.m, piece.x, gy + 1)) gy++;
    return gy;
  }

   /* ---------------- moves ---------------- */

  function grounded() {
    return !!piece && collides(piece.m, piece.x, piece.y + 1);
  }

  function touchLock() {
    if (grounded() && lockResets < LOCK_RESETS_MAX) {
      lockT = 0;
      lockResets++;
    }
  }

  function move(dx) {
    if (state !== 'running' || !piece || clearT > 0) return false;
    if (collides(piece.m, piece.x + dx, piece.y)) return false;
    piece.x += dx;
    touchLock();
    return true;
  }

  function rotate() {
    if (state !== 'running' || !piece || clearT > 0) return false;
    var nm = rotCW(piece.m);
    for (var i = 0; i < KICKS.length; i++) {
      var kx = KICKS[i][0], ky = KICKS[i][1];
      if (!collides(nm, piece.x + kx, piece.y + ky)) {
        piece.m = nm;
        piece.x += kx;
        piece.y += ky;
        piece.rot = (piece.rot + 1) % 4;
        touchLock();
        return true;
      }
    }
    return false;
  }

  function hardDrop() {
    if (state !== 'running' || !piece || clearT > 0) return false;
    var dist = 0;
    while (!collides(piece.m, piece.x, piece.y + 1)) { piece.y++; dist++; }
    if (dist) { score += dist * 2; hudDirty = true; }
    lockPiece();
    return true;
  }

  function holdPiece() {
    if (state !== 'running' || !piece || clearT > 0 || holdUsed) return false;
    var cur = piece.type;
    if (holdType === null) {
      holdType = cur;
      spawnNext();
    } else {
      var h = holdType;
      holdType = cur;
      piece = { type: h, rot: 0, m: clone(SHAPES[h]), x: h === 'O' ? 4 : 3, y: 0 };
      gravT = 0; lockT = 0; lockResets = 0;
      if (collides(piece.m, piece.x, piece.y)) { holdUsed = true; gameOver(); return false; }
    }
    holdUsed = true;
    return true;
  }

  /* ---------------- locking / clearing ---------------- */

  function fullRows() {
    var rows = [];
    for (var r = 0; r < ROWS; r++) {
      var full = true;
      for (var c = 0; c < COLS; c++) {
        if (!board[r][c]) { full = false; break; }
      }
      if (full) rows.push(r);
    }
    return rows;
  }

  function lockPiece() {
    if (!piece) return;
    for (var r = 0; r < piece.m.length; r++) {
      for (var c = 0; c < piece.m.length; c++) {
        if (!piece.m[r][c]) continue;
        var by = piece.y + r, bx = piece.x + c;
        if (by >= 0 && by < ROWS && bx >= 0 && bx < COLS) board[by][bx] = piece.type;
      }
    }
    piece = null;
    var rows = fullRows();
    if (rows.length) {
      var n = rows.length;
      score += LINE_SCORE[n] * level;
      lines += n;
      level = 1 + Math.floor(lines / 10);
      clearRows = rows;
      clearT = CLEAR_TIME;
      hudDirty = true;
    } else {
      spawnNext();
    }
  }

  function removeClearRows() {
    var gone = {};
    for (var i = 0; i < clearRows.length; i++) gone[clearRows[i]] = true;
    var kept = [];
    for (var r = 0; r < ROWS; r++) if (!gone[r]) kept.push(board[r]);
    while (kept.length < ROWS) kept.unshift(emptyRow());
    board = kept;
    clearRows = [];
  }

  /* ---------------- HUD / states ---------------- */

  function updateHud() {
    hudDirty = false;
    GameShell.hud(
      { Score: score, Best: Math.max(best, score), Lines: lines, Level: level },
      state === 'paused' ? '⏸ Paused' : 'Space = hard drop'
    );
  }

  function reset() {
    board = [];
    for (var r = 0; r < ROWS; r++) board.push(emptyRow());
    queue = []; holdType = null; holdUsed = false;
    score = 0; lines = 0; level = 1;
    gravT = 0; lockT = 0; lockResets = 0;
    clearRows = []; clearT = 0;
    releaseKeys();
    spawnNext();
    hudDirty = true;
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
      msg: 'The stack can wait. Resume whenever you are ready.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Lines', value: lines },
        { label: 'Level', value: level }
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
    releaseKeys();
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : 'Game over',
      msg: 'The well topped out after ' + lines + ' line' + (lines === 1 ? '' : 's') +
           ' at level ' + level + '. Clear lines earlier to keep the stack low.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Lines', value: lines },
        { label: 'Level', value: level }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function releaseKeys() {
    keys.left = keys.right = keys.soft = false;
    das.dir = 0; das.t = 0; das.arr = 0;
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    if (clearT > 0) {
      clearT -= dt;
      if (clearT <= 0) {
        removeClearRows();
        spawnNext();
      }
      return;
    }

    /* delayed auto shift: hold an arrow to slide continuously */
    if (das.dir !== 0) {
      var held = das.dir < 0 ? keys.left : keys.right;
      if (!held) das.dir = 0;
      else {
        das.t += dt;
        if (das.t >= DAS_DELAY) {
          das.arr += dt;
          while (das.arr >= ARR) {
            das.arr -= ARR;
            if (!move(das.dir)) { das.arr = 0; break; }
          }
        }
      }
    }

    if (!piece) return;

    var iv = keys.soft ? Math.min(0.035, gravInterval()) : gravInterval();
    gravT += dt;
    while (gravT >= iv) {
      gravT -= iv;
      if (collides(piece.m, piece.x, piece.y + 1)) { gravT = 0; break; }
      piece.y++;
      lockT = 0;
      if (keys.soft) { score += 1; hudDirty = true; }
    }

    if (collides(piece.m, piece.x, piece.y + 1)) {
      lockT += dt;
      if (lockT >= LOCK_DELAY || lockResets >= LOCK_RESETS_MAX) lockPiece();
    } else {
      lockT = 0;
    }

    if (hudDirty) updateHud();
  }

  /* ---------------- drawing ---------------- */

  function drawBlock(px, py, color, alpha) {
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.shadowColor = color;
    ctx.shadowBlur = 9;
    ctx.fillStyle = color;
    ctx.fillRect(px + 1, py + 1, CELL - 2, CELL - 2);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255,255,255,.30)';
    ctx.fillRect(px + 3, py + 3, CELL - 6, 3);
    ctx.fillStyle = 'rgba(0,0,0,.26)';
    ctx.fillRect(px + 3, py + CELL - 6, CELL - 6, 3);
    ctx.globalAlpha = 1;
  }

  function eachCell(m, px, py, fn) {
    for (var r = 0; r < m.length; r++) {
      for (var c = 0; c < m.length; c++) {
        if (m[r][c]) fn(px + c * CELL, py + r * CELL);
      }
    }
  }

  function drawPreview(m, cx, cy, size, color, alpha) {
    var n = m.length, off = (n - 1) / 2;
    for (var r = 0; r < n; r++) {
      for (var c = 0; c < n; c++) {
        if (!m[r][c]) continue;
        var x = cx + (c - off) * size - size / 2;
        var y = cy + (r - off) * size - size / 2;
        ctx.globalAlpha = alpha === undefined ? 1 : alpha;
        ctx.fillStyle = color;
        ctx.fillRect(x + 1, y + 1, size - 2, size - 2);
        ctx.fillStyle = 'rgba(255,255,255,.25)';
        ctx.fillRect(x + 2, y + 2, size - 4, 2);
        ctx.globalAlpha = 1;
      }
    }
  }

  function panel(x, y, w, h, label) {
    ctx.fillStyle = 'rgba(10,15,28,.9)';
    ctx.strokeStyle = 'rgba(124,92,255,.45)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.font = '700 13px ' + FONT;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(label, x + 12, y + 22);
  }

  function draw(t) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.42, 60, 20, W * 0.42, 60, W * 0.95);
    g.addColorStop(0, 'rgba(168,85,247,.16)');
    g.addColorStop(0.5, 'rgba(34,211,238,.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* well background + grid */
    ctx.fillStyle = '#070b16';
    ctx.fillRect(WELL_X, WELL_Y, WELL_W, WELL_H);
    ctx.strokeStyle = 'rgba(124,92,255,.08)';
    ctx.lineWidth = 1;
    for (var i = 1; i < COLS; i++) {
      ctx.beginPath();
      ctx.moveTo(WELL_X + i * CELL + 0.5, WELL_Y);
      ctx.lineTo(WELL_X + i * CELL + 0.5, WELL_Y + WELL_H);
      ctx.stroke();
    }
    for (i = 1; i < ROWS; i++) {
      ctx.beginPath();
      ctx.moveTo(WELL_X, WELL_Y + i * CELL + 0.5);
      ctx.lineTo(WELL_X + WELL_W, WELL_Y + i * CELL + 0.5);
      ctx.stroke();
    }

    /* locked stack */
    var r, c;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var cell = board[r][c];
        if (cell) drawBlock(WELL_X + c * CELL, WELL_Y + r * CELL, COLORS[cell]);
      }
    }

    /* line-clear flash */
    if (clearT > 0) {
      var a = 0.55 + 0.45 * Math.sin(t / 45);
      for (i = 0; i < clearRows.length; i++) {
        for (c = 0; c < COLS; c++) {
          ctx.globalAlpha = a;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(WELL_X + c * CELL + 1, WELL_Y + clearRows[i] * CELL + 1, CELL - 2, CELL - 2);
          ctx.globalAlpha = 1;
        }
      }
    }

    /* ghost + active piece */
    if (piece) {
      var col = COLORS[piece.type];
      var gy = ghostY();
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.4;
      ctx.lineWidth = 2;
      eachCell(piece.m, WELL_X + piece.x * CELL, WELL_Y + gy * CELL, function (x, y) {
        ctx.strokeRect(x + 3, y + 3, CELL - 6, CELL - 6);
      });
      ctx.globalAlpha = 1;
      eachCell(piece.m, WELL_X + piece.x * CELL, WELL_Y + piece.y * CELL, function (x, y) {
        drawBlock(x, y, col);
      });
    }

    /* well border, neon */
    ctx.shadowColor = '#22d3ee';
    ctx.shadowBlur = 14;
    ctx.strokeStyle = 'rgba(34,211,238,.85)';
    ctx.lineWidth = 2;
    ctx.strokeRect(WELL_X - 1, WELL_Y - 1, WELL_W + 2, WELL_H + 2);
    ctx.shadowBlur = 0;

    /* next previews */
    panel(PANEL_X, WELL_Y, PANEL_W, 176, 'NEXT');
    if (queue.length) {
      drawPreview(SHAPES[queue[0]], PANEL_X + PANEL_W / 2, WELL_Y + 62, 17, COLORS[queue[0]]);
      if (queue.length > 1) {
        drawPreview(SHAPES[queue[1]], PANEL_X + PANEL_W / 2, WELL_Y + 130, 14, COLORS[queue[1]], 0.75);
      }
    }

    /* hold box */
    panel(PANEL_X, WELL_Y + 196, PANEL_W, 116, 'HOLD' + (holdUsed ? '  (used)' : ''));
    if (holdType) {
      drawPreview(SHAPES[holdType], PANEL_X + PANEL_W / 2, WELL_Y + 258, 17, COLORS[holdType], holdUsed ? 0.45 : 1);
    }

    /* scoring legend */
    var lx = PANEL_X + 4, ly = WELL_Y + 348;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.font = '700 13px ' + FONT;
    ctx.fillStyle = 'rgba(147,163,194,.95)';
    ctx.fillText('SCORING', lx, ly);
    var legend = [
      ['1 line', '100'], ['2 lines', '300'], ['3 lines', '500'],
      ['4 lines', '800 × level'], ['soft drop', '+1 / row'], ['hard drop', '+2 / row']
    ];
    ctx.font = '600 13px ' + FONT;
    for (i = 0; i < legend.length; i++) {
      ctx.fillStyle = 'rgba(195,205,227,.85)';
      ctx.fillText(legend[i][0], lx, ly + 22 + i * 21);
      ctx.fillStyle = '#2ee6a6';
      ctx.textAlign = 'right';
      ctx.fillText(legend[i][1], PANEL_X + PANEL_W - 6, ly + 22 + i * 21);
      ctx.textAlign = 'left';
    }
  }

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    var dt = last ? (t - last) / 1000 : 0;
    last = t;
    if (!(dt > 0)) dt = 0;
    if (dt > 0.05) dt = 0.05;
    if (state === 'running') update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  function pressLeft() {
    move(-1);
    das.dir = -1; das.t = 0; das.arr = 0;
  }

  function pressRight() {
    move(1);
    das.dir = 1; das.t = 0; das.arr = 0;
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;
    if (k === undefined || k === null) return;

    if (k === 'ArrowLeft' || k === 'ArrowRight' || k === 'ArrowUp' ||
        k === 'ArrowDown' || k === ' ' || k === 'Enter') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      keys.left = true;
      pressLeft();
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      keys.right = true;
      pressRight();
    } else if (k === 'ArrowUp' || k === 'x' || k === 'X' || k === 'w' || k === 'W') {
      rotate();
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      keys.soft = true;
    } else if (k === 'c' || k === 'C' || k === 'Shift') {
      holdPiece();
    } else if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
      else hardDrop();
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

  document.addEventListener('keyup', function (e) {
    var k = e.key;
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') {
      keys.left = false;
      if (das.dir === -1) das.dir = 0;
    } else if (k === 'ArrowRight' || k === 'd' || k === 'D') {
      keys.right = false;
      if (das.dir === 1) das.dir = 0;
    } else if (k === 'ArrowDown' || k === 's' || k === 'S') {
      keys.soft = false;
    }
  });

  window.addEventListener('blur', releaseKeys);

  /* on-screen touch buttons */
  var padBtns = document.querySelectorAll('[data-act]');
  for (var b = 0; b < padBtns.length; b++) {
    (function (btn) {
      var act = btn.getAttribute('data-act');
      function on() {
        if (state === 'ready' || state === 'over') { start(); return; }
        if (state === 'paused') { resume(); return; }
        if (act === 'left') { keys.left = true; pressLeft(); }
        else if (act === 'right') { keys.right = true; pressRight(); }
        else if (act === 'rot') rotate();
        else if (act === 'soft') keys.soft = true;
        else if (act === 'drop') hardDrop();
        else if (act === 'hold') holdPiece();
      }
      function off() {
        if (act === 'left') { keys.left = false; if (das.dir === -1) das.dir = 0; }
        else if (act === 'right') { keys.right = false; if (das.dir === 1) das.dir = 0; }
        else if (act === 'soft') keys.soft = false;
      }
      btn.addEventListener('pointerdown', function (ev) { ev.preventDefault(); on(); });
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointerleave', off);
      btn.addEventListener('pointercancel', off);
    })(padBtns[b]);
  }

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__neonBlocks', {
      value: Object.freeze({
        snapshot: function () {
          return {
            state: state,
            score: score,
            best: Math.max(best, score),
            lines: lines,
            level: level,
            cols: COLS,
            rows: ROWS,
            clearing: clearT > 0,
            holdUsed: holdUsed,
            holdType: holdType,
            queue: queue.slice(0, 3),
            board: board.map(function (row) { return row.slice(); }),
            piece: piece ? {
              type: piece.type,
              rot: piece.rot,
              x: piece.x,
              y: piece.y,
              m: clone(piece.m)
            } : null
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Neon Blocks',
    msg: 'Rotate and slide the falling blocks with the arrow keys or WASD, build flat stacks and clear full rows. Space hard-drops — press it now to play.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
