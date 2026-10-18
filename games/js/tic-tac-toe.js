/* ============================================================
   Tic Tac Toe — original game for PixelPlay
   DOM board: 3x3, minimax AI (Hard) or two players on one screen.
   You are X and always move first against the AI.
   ============================================================ */

(function () {
  'use strict';

  var gameDom = document.getElementById('gameDom');
  if (!gameDom) return;

  var BEST_KEY = 'tic-tac-toe';
  var LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6]
  ];

  var els = [], board = [];
  var turn = 'X', mode = 'ai', hard = true, busy = false;
  var state = 'ready';               /* ready | running | over */
  var aiTimer = 0, aiPaused = false;
  var wins = 0, draws = 0, losses = 0;
  var streak = GameShell.best.get(BEST_KEY, 0);

  /* ---------------- pure rules ---------------- */

  function winner(b) {
    for (var i = 0; i < LINES.length; i++) {
      var l = LINES[i];
      if (b[l[0]] && b[l[0]] === b[l[1]] && b[l[0]] === b[l[2]]) {
        return { player: b[l[0]], line: l };
      }
    }
    return null;
  }

  function full(b) {
    for (var i = 0; i < 9; i++) if (!b[i]) return false;
    return true;
  }

  function empties(b) {
    var list = [];
    for (var i = 0; i < 9; i++) if (!b[i]) list.push(i);
    return list;
  }

  /* Minimax: score a position from the AI's (O) point of view.
     +10 = O wins, -10 = O loses, 0 = draw. Lower depth is preferred. */
  function score(b, who, ai, depth) {
    var w = winner(b);
    if (w) return w.player === ai ? 10 - depth : depth - 10;
    if (full(b)) return 0;

    var bestScore = who === ai ? -Infinity : Infinity;
    var list = empties(b), s, i;
    for (i = 0; i < list.length; i++) {
      b[list[i]] = who;
      s = score(b, who === 'X' ? 'O' : 'X', ai, depth + 1);
      b[list[i]] = '';
      if (who === ai) { if (s > bestScore) bestScore = s; }
      else { if (s < bestScore) bestScore = s; }
    }
    return bestScore;
  }

  function bestMoves(ai) {
    var b = board.slice();
    var list = empties(b), bestScore = -Infinity, out = [], s, i;
    for (i = 0; i < list.length; i++) {
      b[list[i]] = ai;
      s = score(b, ai === 'X' ? 'O' : 'X', ai, 0);
      b[list[i]] = '';
      if (s > bestScore) { bestScore = s; out = [list[i]]; }
      else if (s === bestScore) out.push(list[i]);
    }
    return out;
  }

  /* ---------------- build + paint ---------------- */

  function buildBoard() {
    gameDom.className += ' ttt-board';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 9; i++) {
      var el = document.createElement('div');
      el.className = 'ttt-cell';
      el.setAttribute('data-i', String(i));
      frag.appendChild(el);
      els.push(el);
    }
    gameDom.appendChild(frag);
  }

  function paint(i) {
    var v = board[i];
    els[i].className = 'ttt-cell' + (v === 'X' ? ' x' : v === 'O' ? ' o' : '');
    els[i].textContent = v || '';
  }

  function paintAll() { for (var i = 0; i < 9; i++) paint(i); }

  function highlight(line) {
    if (!line) return;
    for (var i = 0; i < line.length; i++) els[line[i]].className += ' win';
  }

  /* ---------------- hud ---------------- */

  function updateHud() {
    var right = '';
    if (state === 'running') {
      if (mode === 'ai') {
        right = (hard ? '🤖 Hard · ' : '🤖 Easy · ') + (busy ? 'thinking…' : 'your move');
      } else {
        right = '👥 ' + turn + ' to move';
      }
    }
    GameShell.hud({ Wins: wins, Draws: draws, Losses: losses, Best: streak }, right);
  }

  function saveStreak(v) {
    streak = v;
    GameShell.best.set(BEST_KEY, streak);
  }

  /* ---------------- game states ---------------- */

  function clearBoard() {
    for (var i = 0; i < 9; i++) board[i] = '';
  }

  function start() {
    clearBoard();
    turn = 'X';
    busy = false;
    clearAi();
    state = 'running';
    paintAll();
    GameShell.overlay.hide();
    updateHud();
  }

  function endRound(res, line) {
    state = 'over';
    busy = false;
    clearAi();
    highlight(line);

    var title, msg;
    if (res === 'draw') {
      draws++;
      if (mode === 'ai') saveStreak(0);
      title = 'Draw';
      msg = 'Nine squares, no line. Against a perfect opponent a draw really is a job well done.';
    } else if (mode === 'ai') {
      if (res === 'X') {
        wins++;
        saveStreak(streak + 1);
        title = 'You win!';
        msg = 'Three in a row with ❌ — your streak is now ' + streak + '. Can you keep it alive?';
      } else {
        losses++;
        saveStreak(0);
        title = 'AI wins!';
        msg = hard
          ? 'The minimax bot had already seen every reply you could make. Try Easy mode, or grab a friend for two players.'
          : 'Even on Easy the bot found its line. Go again and block it earlier!';
      }
    } else {
      if (res === 'X') { wins++; title = '❌ X wins!'; }
      else { losses++; title = '⭕ O wins!'; }
      msg = 'Player ' + res + ' completed a line. Pass the device and let ' +
            (res === 'X' ? 'O' : 'X') + ' try to answer.';
    }

    updateHud();
    GameShell.overlay.show({
      title: title,
      msg: msg,
      stats: [
        { label: 'Wins', value: wins },
        { label: 'Draws', value: draws },
        { label: 'Losses', value: losses },
        { label: 'Streak', value: streak }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  /* ---------------- moves ---------------- */

  function finish(who) {
    var w = winner(board);
    if (w) { endRound(w.player, w.line); return true; }
    if (full(board)) { endRound('draw', null); return true; }
    return false;
  }

  function play(i) {
    if (state !== 'running' || busy) return;
    if (i < 0 || i > 8 || board[i]) return;

    if (mode === 'ai') {
      board[i] = 'X';
      paint(i);
      if (finish('X')) return;
      busy = true;                       /* block the board while the AI thinks */
      updateHud();
      scheduleAi();
    } else {
      board[i] = turn;
      paint(i);
      if (finish(turn)) return;
      turn = turn === 'X' ? 'O' : 'X';
      updateHud();
    }
  }

  /* ---------------- ai ---------------- */

  function scheduleAi() {
    if (aiTimer) return;
    aiTimer = setTimeout(aiMove, 350);
  }

  function clearAi() {
    if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; }
    aiPaused = false;
  }

  function aiMove() {
    aiTimer = 0;
    if (state !== 'running' || mode !== 'ai') { busy = false; return; }

    var list = empties(board);
    if (!list.length) { busy = false; return; }

    var move;
    if (!hard && Math.random() < 0.6) {
      move = list[Math.floor(Math.random() * list.length)];
    } else {
      var opts = bestMoves('O');
      move = opts[Math.floor(Math.random() * opts.length)];
    }

    busy = false;
    board[move] = 'O';
    paint(move);
    finish('O');
    updateHud();
  }

  /* ---------------- input ---------------- */

  function cellFromEvent(e) {
    var el = e.target;
    while (el && el !== gameDom) {
      if ((' ' + el.className + ' ').indexOf(' ttt-cell ') !== -1) {
        var n = parseInt(el.getAttribute('data-i'), 10);
        return isNaN(n) ? -1 : n;
      }
      el = el.parentNode;
    }
    return -1;
  }

  gameDom.addEventListener('click', function (e) {
    var i = cellFromEvent(e);
    if (i >= 0) play(i);
  });

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
    if (document.hidden) {
      if (aiTimer) { clearTimeout(aiTimer); aiTimer = 0; aiPaused = true; }
    } else if (aiPaused) {
      aiPaused = false;
      scheduleAi();
    }
  });

  /* mode + difficulty toggles */

  var modeAiBtn = document.getElementById('modeAiBtn');
  var mode2pBtn = document.getElementById('mode2pBtn');
  var diffBtn = document.getElementById('diffBtn');
  var newGameBtn = document.getElementById('newGameBtn');

  function syncControls() {
    if (modeAiBtn) {
      modeAiBtn.className = 'tbtn' + (mode === 'ai' ? ' on' : '');
      modeAiBtn.setAttribute('aria-pressed', mode === 'ai' ? 'true' : 'false');
    }
    if (mode2pBtn) {
      mode2pBtn.className = 'tbtn' + (mode === '2p' ? ' on' : '');
      mode2pBtn.setAttribute('aria-pressed', mode === '2p' ? 'true' : 'false');
    }
    if (diffBtn) {
      diffBtn.style.display = mode === 'ai' ? '' : 'none';
      diffBtn.textContent = hard ? '🎚️ Hard' : '🎚️ Easy';
    }
  }

  function setMode(next) {
    mode = next;
    syncControls();
    start();
  }

  if (modeAiBtn) modeAiBtn.addEventListener('click', function () { if (mode !== 'ai') setMode('ai'); });
  if (mode2pBtn) mode2pBtn.addEventListener('click', function () { if (mode !== '2p') setMode('2p'); });

  if (diffBtn) {
    diffBtn.addEventListener('click', function () {
      hard = !hard;
      syncControls();
      if (mode === 'ai') start();
    });
  }

  if (newGameBtn) newGameBtn.addEventListener('click', start);

  /* ---------------- boot ---------------- */

  buildBoard();
  clearBoard();
  clearAi();
  turn = 'X';
  busy = false;
  paintAll();
  syncControls();
  updateHud();
  GameShell.overlay.show({
    title: 'Tic Tac Toe',
    msg: 'Three in a row wins. You are ❌ X and you move first — take on the Hard AI, or share the screen in two-player mode.',
    stats: [{ label: 'Best streak', value: streak }],
    btn: '▶ Play',
    action: start
  });
})();
