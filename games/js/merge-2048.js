/* ============================================================
   Merge 2048 — original game for PixelPlay
   DOM sliding-tile puzzle: 4x4 board, arrow keys / WASD, swipe
   and an on-screen d-pad. Equal tiles merge once per move.
   ============================================================ */

(function () {
  'use strict';

  var board = document.getElementById('gameDom');
  if (!board) return;

  var SIZE = 4;
  var BEST_KEY = 'merge-2048';
  var WIN_VALUE = 2048;
  var MOVE_MS = 110;                       /* slide duration */
  var MOVE_FRAMES = MOVE_MS / 16.67;       /* same duration in 60fps frames */
  var SWIPE_MIN = 24;                      /* px before a drag counts as a swipe */

  var best = GameShell.best.get(BEST_KEY, 0);
  var state = 'ready';                     /* ready | running | paused | won | over */
  var grid = [];                           /* SIZE x SIZE of tile refs, or null */
  var tiles = [];                          /* every tile currently on the board */
  var tilesLayer = null;
  var cellsLayer = null;
  var score = 0;
  var maxTile = 0;
  var wonShown = false;
  var newBest = false;
  var uid = 0;
  var animating = false;
  var animFrames = 0;
  var pending = null;                      /* run once the slide finishes */
  var rafId = 0;
  var lastT = 0;

  var btn2 = document.getElementById('overlayBtn2');

  /* ---------------- helpers ---------------- */

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;                   /* force a reflow so the animation replays */
    el.classList.add(cls);
  }

  function emptyGrid() {
    grid = [];
    for (var r = 0; r < SIZE; r++) {
      var row = [];
      for (var c = 0; c < SIZE; c++) row.push(null);
      grid.push(row);
    }
  }

  function emptyCells() {
    var out = [];
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        if (!grid[r][c]) out.push({ r: r, c: c });
      }
    }
    return out;
  }

  function buildBoard() {
    board.innerHTML = '';

    cellsLayer = document.createElement('div');
    cellsLayer.className = 't2048-layer t2048-grid';
    for (var i = 0; i < SIZE * SIZE; i++) {
      var cell = document.createElement('div');
      cell.className = 't2048-cell';
      cellsLayer.appendChild(cell);
    }

    tilesLayer = document.createElement('div');
    tilesLayer.className = 't2048-layer t2048-tiles';

    board.appendChild(cellsLayer);
    board.appendChild(tilesLayer);
  }

  function paint(tile) {
    var v = tile.value;
    var len = String(v).length;
    tile.inner.textContent = v;
    tile.el.setAttribute('data-val', v > WIN_VALUE ? WIN_VALUE : v);
    tile.el.className = 't2048-tile' +
      (v > WIN_VALUE ? ' super' : '') +
      (len >= 4 ? ' d4' : (len === 3 ? ' d3' : ''));
  }

  function setPos(tile) {
    tile.el.style.setProperty('--r', tile.r);
    tile.el.style.setProperty('--c', tile.c);
  }

  function createTile(r, c, value, pop) {
    var tile = { id: ++uid, value: value, r: r, c: c, merged: false, dead: false };
    var el = document.createElement('div');
    var inner = document.createElement('div');
    inner.className = 't2048-inner';
    el.appendChild(inner);
    tile.el = el;
    tile.inner = inner;
    tile.el.className = 't2048-tile';
    grid[r][c] = tile;
    setPos(tile);
    paint(tile);
    tilesLayer.appendChild(el);
    if (pop) retrigger(el, 'pop');
    tiles.push(tile);
    return tile;
  }

  function spawn() {
    var free = emptyCells();
    if (!free.length) return null;
    var spot = free[Math.floor(Math.random() * free.length)];
    var value = Math.random() < 0.9 ? 2 : 4;   /* 90% twos, 10% fours */
    return createTile(spot.r, spot.c, value, true);
  }

  function movesAvailable() {
    for (var r = 0; r < SIZE; r++) {
      for (var c = 0; c < SIZE; c++) {
        var t = grid[r][c];
        if (!t) return true;
        if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === t.value) return true;
        if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === t.value) return true;
      }
    }
    return false;
  }

  function updateHud() {
    var right = state === 'paused' ? '⏸ Paused'
              : (maxTile >= WIN_VALUE ? 'Max tile: ' + maxTile : 'Goal: ' + WIN_VALUE);
    GameShell.hud({ Score: score, Best: Math.max(best, score) }, right);
  }

  /* ---------------- overlay ---------------- */

  function setSecond(label, action) {
    if (!btn2) return;
    if (!label) {
      btn2.style.display = 'none';
      btn2.onclick = null;
      return;
    }
    btn2.textContent = label;
    btn2.onclick = action;
    btn2.style.display = '';
  }

  function showOverlay(opts, secondLabel, secondAction) {
    GameShell.overlay.show(opts);
    setSecond(secondLabel, secondAction);
  }

  /* ---------------- move logic ---------------- */

  function tryMove(dr, dc) {
    if (state === 'ready') start();
    if (state !== 'running' || animating) return;

    var i;
    for (i = 0; i < tiles.length; i++) tiles[i].merged = false;

    var rows = dr === -1 ? [0, 1, 2, 3] : (dr === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3]);
    var cols = dc === -1 ? [0, 1, 2, 3] : (dc === 1 ? [3, 2, 1, 0] : [0, 1, 2, 3]);

    var moved = false, gained = 0, hitWin = false;

    for (var a = 0; a < SIZE; a++) {
      for (var b = 0; b < SIZE; b++) {
        var r = rows[a], c = cols[b];
        var tile = grid[r][c];
        if (!tile) continue;

        /* slide as far as possible, stopping on a merge partner */
        var nr = r, nc = c;
        while (true) {
          var tr = nr + dr, tc = nc + dc;
          if (tr < 0 || tr >= SIZE || tc < 0 || tc >= SIZE) break;
          var target = grid[tr][tc];
          if (!target) { nr = tr; nc = tc; continue; }
          if (target.value === tile.value && !target.merged && !tile.merged) {
            nr = tr;
            nc = tc;
          }
          break;
        }
        if (nr === r && nc === c) continue;

        moved = true;
        grid[r][c] = null;
        var dest = grid[nr][nc];

        if (dest && dest.value === tile.value && !dest.merged) {
          /* merge into the tile that is already settled */
          dest.merged = true;
          tile.merged = true;
          dest.value *= 2;
          gained += dest.value;
          if (dest.value > maxTile) maxTile = dest.value;
          if (dest.value >= WIN_VALUE) hitWin = true;
          paint(dest);
          retrigger(dest.el, 'bump');
          tile.r = nr;
          tile.c = nc;
          tile.dead = true;
          setPos(tile);
        } else {
          grid[nr][nc] = tile;
          tile.r = nr;
          tile.c = nc;
          setPos(tile);
        }
      }
    }

    if (!moved) return;

    score += gained;
    spawn();
    updateHud();

    animating = true;
    animFrames = 0;
    pending = function () {
      for (var j = tiles.length - 1; j >= 0; j--) {
        if (tiles[j].dead) {
          if (tiles[j].el.parentNode) tiles[j].el.parentNode.removeChild(tiles[j].el);
          tiles.splice(j, 1);
        }
      }
      if (hitWin && !wonShown) { wonShown = true; showWin(); return; }
      if (!movesAvailable()) gameOver();
    };
  }

  /* ---------------- state changes ---------------- */

  function resetBoard() {
    score = 0;
    maxTile = 0;
    wonShown = false;
    newBest = false;
    animating = false;
    animFrames = 0;
    pending = null;
    emptyGrid();
    tiles = [];
    buildBoard();
    spawn();
    spawn();
    updateHud();
  }

  function start() {
    resetBoard();
    state = 'running';
    GameShell.overlay.hide();
    setSecond(null);
    updateHud();
    ensureLoop();
  }

  function pause() {
    if (state !== 'running') return;
    state = 'paused';
    updateHud();
    showOverlay({
      title: 'Paused',
      msg: 'The board is waiting. No tile will move until you resume.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: Math.max(best, score) }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    GameShell.overlay.hide();
    setSecond(null);
    updateHud();
  }

  function keepPlaying() {
    if (state !== 'won') return;
    state = 'running';
    GameShell.overlay.hide();
    setSecond(null);
    updateHud();
    if (!movesAvailable()) gameOver();
  }

  function showWin() {
    state = 'won';
    updateHud();
    showOverlay({
      title: '🎉 You made 2048!',
      msg: 'Congratulations — you built the legendary 2048 tile with ' + score +
           ' points. Keep going for an even bigger number, or start a fresh board.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best tile', value: maxTile }
      ],
      btn: '▶ Keep playing',
      action: keepPlaying
    }, '↻ New game', start);
  }

  function gameOver() {
    state = 'over';
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    showOverlay({
      title: newBest ? 'New high score!' : 'Game over',
      msg: newBest
        ? 'No moves left, but you set a new personal best of ' + best + ' points.'
        : 'No moves left on the board. You finished with ' + score + ' point' +
          (score === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Best tile', value: maxTile }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- input ---------------- */

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    /* a focused button handles its own Space/Enter activation */
    if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;

    var k = e.key;
    if (k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' ||
        k === 'ArrowRight' || k === ' ') {
      e.preventDefault();
    }

    if (k === 'ArrowUp' || k === 'w' || k === 'W') tryMove(-1, 0);
    else if (k === 'ArrowDown' || k === 's' || k === 'S') tryMove(1, 0);
    else if (k === 'ArrowLeft' || k === 'a' || k === 'A') tryMove(0, -1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') tryMove(0, 1);
    else if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
      else if (state === 'won') keepPlaying();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    }
  });

  var DIRS = { up: [-1, 0], down: [1, 0], left: [0, -1], right: [0, 1] };
  var padBtns = document.querySelectorAll('[data-dir]');
  for (var pb = 0; pb < padBtns.length; pb++) {
    (function (btn) {
      btn.addEventListener('pointerdown', function (ev) {
        ev.preventDefault();
        var d = DIRS[btn.getAttribute('data-dir')];
        if (d) tryMove(d[0], d[1]);
      });
    })(padBtns[pb]);
  }

  /* swipe / drag anywhere on the board */
  var dragging = false, dragId = null, dragX = 0, dragY = 0;

  board.addEventListener('pointerdown', function (e) {
    dragging = true;
    dragId = e.pointerId;
    dragX = e.clientX;
    dragY = e.clientY;
    if (board.setPointerCapture) {
      try { board.setPointerCapture(e.pointerId); } catch (err) {}
    }
  });

  board.addEventListener('pointerup', function (e) {
    if (!dragging || (dragId !== null && e.pointerId !== dragId)) return;
    dragging = false;
    dragId = null;
    var dx = e.clientX - dragX;
    var dy = e.clientY - dragY;
    if (Math.abs(dx) < SWIPE_MIN && Math.abs(dy) < SWIPE_MIN) return;
    if (Math.abs(dx) > Math.abs(dy)) tryMove(0, dx > 0 ? 1 : -1);
    else tryMove(dy > 0 ? 1 : -1, 0);
  });

  board.addEventListener('pointercancel', function () {
    dragging = false;
    dragId = null;
  });

  /* auto-pause without disturbing the board — never auto-move a tile */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- loop ---------------- */

  function tick(t) {
    rafId = requestAnimationFrame(tick);
    if (!lastT) lastT = t;
    var dt = Math.min(50, t - lastT);      /* cap so tab jumps never teleport */
    lastT = t;
    var k = dt / 16.67;                    /* normalise to 60fps frames */
    if (animating) {
      animFrames += k;
      if (animFrames >= MOVE_FRAMES) {
        animating = false;
        var run = pending;
        pending = null;
        if (run) run();
      }
    }
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- boot ---------------- */

  resetBoard();
  state = 'ready';
  ensureLoop();
  showOverlay({
    title: 'Merge 2048',
    msg: 'Slide the tiles with the arrow keys, WASD, a swipe or the pad below. Equal numbers merge into one bigger tile — can you reach 2048?',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
