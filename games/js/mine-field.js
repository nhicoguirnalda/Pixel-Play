/* ============================================================
   Mine Field — original game for PixelPlay
   DOM minesweeper: 10x10 grid, 12 mines, first click is safe.
   Left click reveals, right click (or flag mode) plants a flag.
   ============================================================ */

(function () {
  'use strict';

  var gameDom = document.getElementById('gameDom');
  if (!gameDom) return;

  var COLS = 10, ROWS = 10, MINES = 12, TOTAL = COLS * ROWS, BEST_KEY = 'mine-field';

  var els = [], cells = [];
  var flagCount = 0, revealedCount = 0, seconds = 0;
  var minesPlaced = false, flagMode = false, newBest = false;
  var state = 'ready';               /* ready | running | over */
  var timerId = 0;
  var best = GameShell.best.get(BEST_KEY, 0);

  /* ---------------- helpers ---------------- */

  function idx(x, y) { return y * COLS + x; }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  function fmtTime(s) { return pad2(Math.floor(s / 60)) + ':' + pad2(s % 60); }

  function neighbours(i, fn) {
    var x = i % COLS, y = Math.floor(i / COLS), dx, dy, nx, ny;
    for (dy = -1; dy <= 1; dy++) {
      for (dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        nx = x + dx;
        ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        fn(idx(nx, ny));
      }
    }
  }

  function countMines(i) {
    var n = 0;
    neighbours(i, function (j) { if (cells[j].mine) n++; });
    return n;
  }

  /* ---------------- build + paint ---------------- */

  function buildCells() {
    gameDom.className += ' mf-grid';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < TOTAL; i++) {
      var el = document.createElement('div');
      el.className = 'mf-cell';
      el.setAttribute('data-i', String(i));
      frag.appendChild(el);
      els.push(el);
      cells.push({ mine: false, adj: 0, open: false, flag: false, wrong: false, boom: false });
    }
    gameDom.appendChild(frag);
  }

  function paint(i) {
    var c = cells[i], el = els[i], cls = 'mf-cell', txt = '';
    if (c.wrong) { cls += ' wrong'; txt = '❌'; }
    else if (c.flag) { cls += ' flag'; txt = '🚩'; }
    else if (c.mine && state === 'over') { cls += c.boom ? ' boom' : ' mine'; txt = '💣'; }
    else if (c.open) {
      cls += ' open';
      if (c.adj > 0) { cls += ' n' + c.adj; txt = String(c.adj); }
    }
    el.className = cls;
    el.textContent = txt;
  }

  function paintAll() { for (var i = 0; i < TOTAL; i++) paint(i); }

  /* ---------------- setup ---------------- */

  function placeMines(safe) {
    var banned = {}, x = safe % COLS, y = Math.floor(safe / COLS);
    var dx, dy, nx, ny, i, pool = [], placed = 0, r;

    for (dy = -1; dy <= 1; dy++) {
      for (dx = -1; dx <= 1; dx++) {
        nx = x + dx;
        ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
        banned[idx(nx, ny)] = true;
      }
    }

    for (i = 0; i < TOTAL; i++) if (!banned[i]) pool.push(i);

    while (placed < MINES && pool.length) {
      r = Math.floor(Math.random() * pool.length);
      cells[pool[r]].mine = true;
      pool.splice(r, 1);
      placed++;
    }

    for (i = 0; i < TOTAL; i++) cells[i].adj = cells[i].mine ? 0 : countMines(i);
  }

  function reset() {
    for (var i = 0; i < TOTAL; i++) {
      cells[i].mine = false;
      cells[i].adj = 0;
      cells[i].open = false;
      cells[i].flag = false;
      cells[i].wrong = false;
      cells[i].boom = false;
    }
    minesPlaced = false;
    flagCount = 0;
    revealedCount = 0;
    seconds = 0;
    newBest = false;
    stopTimer();
    paintAll();
    updateHud();
  }

  function updateHud() {
    GameShell.hud({ Mines: MINES - flagCount, Time: fmtTime(seconds), Best: best },
                  state === 'over' ? '' : '10×10');
  }

  /* ---------------- timer ---------------- */

  function startTimer() {
    if (timerId) return;
    timerId = setInterval(function () {
      seconds++;
      updateHud();
    }, 1000);
  }

  function stopTimer() {
    if (timerId) { clearInterval(timerId); timerId = 0; }
  }

  /* ---------------- game states ---------------- */

  function start() {
    state = 'running';
    reset();
    GameShell.overlay.hide();
    updateHud();
  }

  function gameOver(won) {
    state = 'over';
    stopTimer();

    var i;
    if (!won) {
      for (i = 0; i < TOTAL; i++) if (cells[i].flag && !cells[i].mine) cells[i].wrong = true;
    } else {
      for (i = 0; i < TOTAL; i++) if (cells[i].mine) cells[i].flag = true;
      flagCount = MINES;
    }
    paintAll();

    var score = 0;
    if (won) {
      score = Math.max(100, 1200 - seconds * 8);
      if (score > best) {
        best = score;
        newBest = true;
        GameShell.best.set(BEST_KEY, best);
      }
    }

    updateHud();

    if (won) {
      GameShell.overlay.show({
        title: newBest ? '🎉 New best!' : '🎉 Field cleared!',
        msg: 'All ' + (TOTAL - MINES) + ' safe squares uncovered in ' + fmtTime(seconds) + '. Score = 1200 − 8 × seconds.',
        stats: [
          { label: 'Score', value: score },
          { label: 'Time', value: fmtTime(seconds) },
          { label: 'Best', value: best }
        ],
        btn: '▶ Play again',
        action: start
      });
    } else {
      GameShell.overlay.show({
        title: '💥 Boom!',
        msg: MINES + ' mines were hiding in the field. Read the numbers, flag what you know, then click the rest.',
        stats: [
          { label: 'Mines', value: MINES },
          { label: 'Time', value: fmtTime(seconds) },
          { label: 'Best', value: best }
        ],
        btn: '▶ Play again',
        action: start
      });
    }
  }

  /* ---------------- actions ---------------- */

  function reveal(i) {
    if (state !== 'running') return;
    var c = cells[i];
    if (c.open || c.flag) return;

    if (!minesPlaced) {
      placeMines(i);
      minesPlaced = true;
      startTimer();
    }

    if (c.mine) { c.boom = true; gameOver(false); return; }

    var stack = [i], cur, cc;
    while (stack.length) {
      cur = stack.pop();
      cc = cells[cur];
      if (cc.open || cc.flag || cc.mine) continue;
      cc.open = true;
      revealedCount++;
      paint(cur);
      if (cc.adj === 0) {
        neighbours(cur, function (j) {
          if (!cells[j].open && !cells[j].flag) stack.push(j);
        });
      }
    }

    if (revealedCount === TOTAL - MINES) gameOver(true);
  }

  function toggleFlag(i) {
    if (state !== 'running') return;
    var c = cells[i];
    if (c.open) return;
    if (!c.flag && flagCount >= MINES) return;
    c.flag = !c.flag;
    flagCount += c.flag ? 1 : -1;
    paint(i);
    updateHud();
  }

  /* ---------------- input ---------------- */

  function cellFromEvent(e) {
    var el = e.target;
    while (el && el !== gameDom) {
      if ((' ' + el.className + ' ').indexOf(' mf-cell ') !== -1) {
        var n = parseInt(el.getAttribute('data-i'), 10);
        return isNaN(n) ? -1 : n;
      }
      el = el.parentNode;
    }
    return -1;
  }

  var suppressClick = false, pressTimer = 0, pressIdx = -1, ctxGuard = 0;

  gameDom.addEventListener('click', function (e) {
    if (suppressClick) { suppressClick = false; return; }
    var i = cellFromEvent(e);
    if (i < 0) return;
    if (flagMode) toggleFlag(i);
    else reveal(i);
  });

  gameDom.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    var i = cellFromEvent(e);
    if (i < 0) return;
    if (Date.now() - ctxGuard < 600) return;   /* our own long-press already flagged it */
    toggleFlag(i);
  });

  gameDom.addEventListener('pointerdown', function (e) {
    suppressClick = false;
    if (e.pointerType === 'mouse') return;     /* mice flag with right-click */
    var i = cellFromEvent(e);
    if (i < 0) return;
    pressIdx = i;
    if (pressTimer) clearTimeout(pressTimer);
    pressTimer = setTimeout(function () {
      pressTimer = 0;
      suppressClick = true;
      ctxGuard = Date.now();
      toggleFlag(pressIdx);
      pressIdx = -1;
    }, 520);
  });

  function endPress() {
    if (pressTimer) { clearTimeout(pressTimer); pressTimer = 0; }
  }

  gameDom.addEventListener('pointerup', endPress);
  gameDom.addEventListener('pointercancel', endPress);
  gameDom.addEventListener('pointerleave', endPress);

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;
    if (k === ' ') e.preventDefault();

    if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
    } else if (k === 'r' || k === 'R') {
      start();
    }
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopTimer();                    /* freeze the clock, no time jump */
    else if (state === 'running' && minesPlaced) startTimer();
  });

  var flagModeBtn = document.getElementById('flagModeBtn');
  if (flagModeBtn) {
    flagModeBtn.addEventListener('click', function () {
      flagMode = !flagMode;
      flagModeBtn.className = flagMode ? 'tbtn on' : 'tbtn';
      flagModeBtn.setAttribute('aria-pressed', flagMode ? 'true' : 'false');
    });
  }

  var newGameBtn = document.getElementById('newGameBtn');
  if (newGameBtn) newGameBtn.addEventListener('click', start);

  /* ---------------- boot ---------------- */

  buildCells();
  reset();
  GameShell.overlay.show({
    title: 'Mine Field',
    msg: '12 mines hide in this 10×10 grid. Click to reveal, right-click to flag, and let the numbers guide you to all 88 safe squares. Your first click is always safe.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
