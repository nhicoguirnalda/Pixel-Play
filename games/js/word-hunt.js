/* ============================================================
   Word Hunt — original game for PixelPlay
   Canvas hidden-word search: trace straight lines through a
   neon 10x10 letter grid and find ten hidden words per puzzle
   before the countdown clock runs out.
   Pointer drag or tap-to-tap; P/Esc pauses, R restarts.
   ============================================================ */

(function () {
  'use strict';

  var canvas = document.getElementById('gameCanvas');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');

  var W = 600, H = 600;
  var COLS = 10, ROWS = 10, CELL = 44;
  var GX = 80, GY = 60;                 /* grid origin: 440x440 block */
  var PUZZLE_WORDS = 10;
  var ROUND_TIME = 120;
  var ADVANCE_TIME = 15;                /* bonus seconds for clearing a puzzle */
  var BEST_KEY = 'word-hunt';
  var FONT = '"Segoe UI", system-ui, sans-serif';
  var TAU = Math.PI * 2;

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

  /* ---------------- hidden word list ----------------
     Common everyday words, 4-8 letters, embedded (no fetches). */

  var WORDS = [
    'fish','tree','star','moon','lion','bear','wolf','deer','duck','crab',
    'frog','goat','hawk','boat','cake','corn','cube','door','dust','flag',
    'foam','gold','hall','hand','heat','hill','home','kite','knee','lake',
    'lamp','land','leaf','lime','list','lock','loud','love','mark','milk',
    'mind','mint','moss','mule','nest','note','palm','pear','pine','pond',
    'pool','rain','ring','rock','roof','room','root','rose','salt','sand',
    'seed','ship','shoe','silk','sing','snow','soap','song','stem','surf',
    'swan','tail','tide','tile','toad','tune','vase','veil','vine','wall',
    'wand','wave','well','wife','wild','wind','wing','wood','wool','worm',
    'yard','yarn','yoga','zone','helm','reel','dale','fjord','apple','beach',
    'bread','brush','cabin','candy','chair','charm','chase','chess','chill','coral',
    'cream','dance','drink','eagle','earth','flame','forest','fresh','frost','giant',
    'glass','grape','green','honey','horse','house','juice','lemon','light','mango',
    'melon','music','night','ocean','olive','panda','paper','pearl','piano','queen',
    'quick','rabbit','radio','river','robot','shark','sheep','shelf','shirt','smile',
    'snake','solar','sound','space','spark','spice','spoon','stone','storm','sugar',
    'table','tiger','toast','train','voice','water','whale','wheat','wheel','white',
    'window','winter','zebra','anchor','blaze','climb','dream','flock','bridge','bright',
    'circle','fabric','guitar','island','jungle','orange','pencil','planet','purple','silver',
    'spirit','temple','tunnel','vision','castle','candle','motion','frozen','garden','hammer',
    'kitten','marker','marble','meteor','nickel','oyster','parrot','pillow','potato','rocket',
    'shadow','shield','sparrow','spider','summer','sunset','tender','turkey','velvet','walnut',
    'wonder','between','diamond','eclipse','harvest','morning','network','nothing','station','trumpet',
    'elephant','mushroom','sunshine','starfish','seahorse','snowball','treasure','airplane'
  ];

  var COLORS = ['#7c5cff', '#22d3ee', '#2ee6a6', '#f59e0b', '#ff5c7a',
                '#a855f7', '#34d399', '#f472b6', '#60a5fa', '#facc15'];

  /* Directions, ordered so the first three placed words always use
     three different direction classes (across, down, diagonal). */
  var DIRS = [
    { dr: 0, dc: 1 }, { dr: 1, dc: 0 }, { dr: 1, dc: 1 }, { dr: -1, dc: 1 },
    { dr: 0, dc: -1 }, { dr: -1, dc: 0 }, { dr: -1, dc: -1 }, { dr: 1, dc: -1 }
  ];

  /* ---------------- state ---------------- */

  var state = 'ready';            /* ready | running | paused | clear | over */
  var score = 0;
  var best = GameShell.best.get(BEST_KEY, 0);
  var time = ROUND_TIME, puzzleNo = 1;
  var grid = [];                  /* grid[r][c] = letter */
  var hidden = [];                /* the ten words of this puzzle */
  var paths = [];                 /* { word, cells: [[r,c],...] } as placed */
  var found = [];                 /* { word, cells, color, pop } */
  var foundSet = {};
  var foundCell = {};             /* "r,c" -> color index */
  var totalFound = 0, longest = '';
  var sel = null;                 /* { sr, sc, er, ec } while selecting */
  var dragging = false, tapCell = null;
  var flashCells = null, flashT = 0;   /* red flash for wrong lines */
  var celebrateT = 0, lastBonus = 0;
  var particles = [];
  var lastHud = '';
  var rafId = 0, last = 0;

  /* ---------------- helpers ---------------- */

  function rand(n) { return Math.floor(Math.random() * n); }

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }

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

  function shuffle(arr) {
    for (var i = arr.length - 1; i > 0; i--) {
      var j = rand(i + 1), t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function cellX(c) { return GX + c * CELL; }
  function cellY(r) { return GY + r * CELL; }
  function cx(c) { return GX + c * CELL + CELL / 2; }
  function cy(r) { return GY + r * CELL + CELL / 2; }

  function burst(x, y, col, n) {
    for (var i = 0; i < n; i++) {
      var a = Math.random() * TAU;
      var s = 40 + Math.random() * 210;
      var life = 0.35 + Math.random() * 0.5;
      particles.push({
        x: x, y: y,
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: life, life0: life,
        size: 1.4 + Math.random() * 2.4,
        col: col
      });
    }
    if (particles.length > 320) particles.splice(0, particles.length - 320);
  }

  /* ---------------- puzzle building ---------------- */

  function placeWord(grid, word, dir, sr, sc) {
    var cells = [];
    for (var i = 0; i < word.length; i++) {
      var r = sr + dir.dr * i, c = sc + dir.dc * i;
      if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
      var cur = grid[r][c];
      if (cur !== null && cur !== word[i]) return null;
      cells.push([r, c]);
    }
    for (i = 0; i < word.length; i++) {
      grid[cells[i][0]][cells[i][1]] = word[i];
    }
    return cells;
  }

  function buildPuzzle() {
    var built = false;
    var attempt = 0;
    var pick, i, j;

    while (!built && attempt < 60) {
      attempt++;
      /* ten distinct words, longest placed first for the best fit */
      var pool = shuffle(WORDS.slice());
      pick = [];
      var seen = {};
      for (i = 0; i < pool.length && pick.length < PUZZLE_WORDS; i++) {
        if (seen[pool[i]]) continue;
        seen[pool[i]] = 1;
        pick.push(pool[i]);
      }
      pick.sort(function (a, b) { return b.length - a.length; });

      grid = [];
      for (i = 0; i < ROWS; i++) {
        var row = [];
        for (j = 0; j < COLS; j++) row.push(null);
        grid.push(row);
      }

      var ok = true;
      var newPaths = [];
      for (i = 0; i < pick.length; i++) {
        var word = pick[i];
        var placed = null;
        /* word i prefers direction (i mod 8) so early words use
           three+ distinct directions; then spiral through the rest */
        for (var t = 0; t < 8 && !placed; t++) {
          var dir = DIRS[(i + t) % 8];
          for (var a = 0; a < 10 && !placed; a++) {
            var sr = rand(ROWS), sc = rand(COLS);
            placed = placeWord(grid, word, dir, sr, sc);
          }
        }
        if (!placed) { ok = false; break; }
        newPaths.push({ word: word, cells: placed });
      }
      if (!ok) continue;

      hidden = pick;
      paths = newPaths;
      built = true;
    }

    if (!built) {
      /* Extremely unlikely fallback: keep whatever placed cleanly. */
      hidden = pick || WORDS.slice(0, PUZZLE_WORDS);
    }

    /* fill empty cells, weighted toward the letters we just placed */
    var letters = [];
    for (i = 0; i < ROWS; i++) {
      for (j = 0; j < COLS; j++) {
        if (grid[i][j] !== null) letters.push(grid[i][j]);
      }
    }
    var abc = 'abcdefghijklmnopqrstuvwxyz';
    for (i = 0; i < ROWS; i++) {
      for (j = 0; j < COLS; j++) {
        if (grid[i][j] !== null) continue;
        if (letters.length && Math.random() < 0.7) {
          grid[i][j] = letters[rand(letters.length)];
        } else {
          grid[i][j] = abc[rand(26)];
        }
      }
    }

    found = [];
    foundSet = {};
    foundCell = {};
    tapCell = null;
    sel = null;
    dragging = false;
    flashCells = null;
    flashT = 0;
  }

  /* ---------------- HUD / states ---------------- */

  function updateHud() {
    var hint = state === 'paused' ? '⏸ Paused · puzzle ' + puzzleNo
             : 'Drag across letters to find words';
    var key = state + '|' + score + '|' + Math.ceil(time) + '|' + found.length + '|' + hint;
    if (key === lastHud) return;
    lastHud = key;
    GameShell.hud(
      {
        Score: score,
        Best: Math.max(best, score),
        Words: found.length + '/' + PUZZLE_WORDS,
        Time: Math.ceil(time) + 's'
      },
      hint
    );
  }

  function reset() {
    score = 0;
    time = ROUND_TIME;
    puzzleNo = 1;
    totalFound = 0;
    longest = '';
    celebrateT = 0;
    particles = [];
    buildPuzzle();
    lastHud = '';
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
    dragging = false;
    sel = null;
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The letters will wait. Take your time.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Words', value: found.length + '/' + PUZZLE_WORDS },
        { label: 'Time', value: Math.ceil(time) + 's' }
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
    dragging = false;
    sel = null;
    tapCell = null;
    var isBest = score > best;
    if (isBest) {
      best = score;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: isBest ? 'New high score!' : "Time's up",
      msg: 'You found ' + totalFound + ' word' + (totalFound === 1 ? '' : 's') +
           ' across ' + puzzleNo + ' puzzle' + (puzzleNo === 1 ? '' : 's') + '.',
      stats: [
        { label: 'Score', value: score },
        { label: 'Best', value: best },
        { label: 'Words found', value: totalFound },
        { label: 'Longest', value: longest || '—' }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function clearPuzzle() {
    lastBonus = 200 + Math.floor(time) * 5;
    score += lastBonus;
    time = Math.min(ROUND_TIME, time + ADVANCE_TIME);
    celebrateT = 1.7;
    state = 'clear';
    for (var i = 0; i < 40; i++) {
      burst(W / 2 + (Math.random() - 0.5) * 240, 200 + Math.random() * 120,
            COLORS[i % COLORS.length], 1);
    }
    updateHud();
  }

  /* ---------------- selection ---------------- */

  function cellFromEvent(ev) {
    var rect = canvas.getBoundingClientRect();
    if (!rect || !rect.width || !rect.height) return null;
    var x = (ev.clientX - rect.left) * (W / rect.width);
    var y = (ev.clientY - rect.top) * (H / rect.height);
    var c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
    if (r < 0 || r >= ROWS || c < 0 || c >= COLS) return null;
    return { r: r, c: c };
  }

  function isStraight(r1, c1, r2, c2) {
    var dR = r2 - r1, dC = c2 - c1;
    if (dR === 0 && dC === 0) return false;
    return dR === 0 || dC === 0 || Math.abs(dR) === Math.abs(dC);
  }

  function flashWrong(cells) {
    flashCells = cells;
    flashT = 0.4;
  }

  function evaluate(r1, c1, r2, c2) {
    if (!isStraight(r1, c1, r2, c2)) {
      flashWrong([[r1, c1], [r2, c2]]);
      return;
    }
    var dR = r2 > r1 ? 1 : (r2 < r1 ? -1 : 0);
    var dC = c2 > c1 ? 1 : (c2 < c1 ? -1 : 0);
    var steps = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1));
    var s = '', cells = [];
    for (var i = 0; i <= steps; i++) {
      var r = r1 + dR * i, c = c1 + dC * i;
      s += grid[r][c];
      cells.push([r, c]);
    }
    if (Object.prototype.hasOwnProperty.call(foundSet, s) || hidden.indexOf(s) < 0) {
      flashWrong(cells);
      return;
    }
    register(s, cells);
  }

  function register(word, cells) {
    var len = word.length;
    var pts = len * 10 + Math.max(0, len - 4) * 10;
    score += pts;
    time = Math.min(ROUND_TIME, time + 3);
    totalFound++;
    if (word.length > longest.length || (word.length === longest.length && word < longest)) {
      if (word.length >= longest.length) longest = word;
    }
    foundSet[word] = true;
    var color = COLORS[found.length % COLORS.length];
    for (var i = 0; i < cells.length; i++) {
      foundCell[cells[i][0] + ',' + cells[i][1]] = color;
    }
    found.push({ word: word, cells: cells, color: color, pop: 0.35 });
    burst(cx(cells[cells.length - 1][1]), cy(cells[cells.length - 1][0]), color, 12);
    updateHud();
    if (found.length >= PUZZLE_WORDS) clearPuzzle();
  }

  /* ---------------- update ---------------- */

  function update(dt) {
    var i;
    if (flashT > 0) flashT = Math.max(0, flashT - dt);

    for (i = found.length - 1; i >= 0; i--) {
      if (found[i].pop > 0) found[i].pop -= dt;
    }

    for (i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.965;
      p.vy *= 0.965;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }

    if (state === 'running') {
      time -= dt;
      if (time <= 0) {
        time = 0;
        updateHud();
        gameOver();
        return;
      }
      updateHud();
    } else if (state === 'clear') {
      celebrateT -= dt;
      if (celebrateT <= 0) {
        puzzleNo++;
        buildPuzzle();
        state = 'running';
        lastHud = '';
        updateHud();
      }
    }
  }

  /* ---------------- draw ---------------- */

  function draw(t) {
    var i, j, r, c;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05070e';
    ctx.fillRect(0, 0, W, H);

    var g = ctx.createRadialGradient(W * 0.5, 30, 10, W * 0.5, 30, W * 0.9);
    g.addColorStop(0, 'rgba(124,92,255,.18)');
    g.addColorStop(0.5, 'rgba(34,211,238,.05)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    /* ---- top strip ---- */
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 17px ' + FONT;
    ctx.fillStyle = '#e8eefc';
    ctx.fillText('PUZZLE ' + puzzleNo, 40, 22);
    ctx.font = '14px ' + FONT;
    ctx.fillStyle = '#93a3c2';
    ctx.fillText(found.length + ' / ' + PUZZLE_WORDS + ' found', 140, 22);

    /* timer bar */
    ctx.fillStyle = '#121a2c';
    rr(40, 38, 520, 8, 4);
    ctx.fill();
    var frac = clamp(time / ROUND_TIME, 0, 1);
    var low = time < 15;
    if (low && Math.floor(t / 250) % 2 === 0) ctx.fillStyle = '#ff5c7a';
    else ctx.fillStyle = low ? '#ff8ba1' : '#22d3ee';
    if (frac > 0) { rr(40, 38, Math.max(8, 520 * frac), 8, 4); ctx.fill(); }

    /* ---- grid cells ---- */
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var x = cellX(c), y = cellY(r);
        var tint = foundCell[r + ',' + c];
        rr(x + 2, y + 2, CELL - 4, CELL - 4, 8);
        ctx.fillStyle = tint ? 'rgba(255,255,255,.05)' : '#0d1424';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = tint || '#1c2a45';
        ctx.globalAlpha = tint ? 0.55 : 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }

    /* ---- locked-in word paths ---- */
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (i = 0; i < found.length; i++) {
      var f = found[i];
      if (f.cells.length < 2) continue;
      ctx.globalAlpha = 0.5;
      ctx.strokeStyle = f.color;
      ctx.lineWidth = CELL - 10;
      ctx.beginPath();
      ctx.moveTo(cx(f.cells[0][1]), cy(f.cells[0][0]));
      for (j = 1; j < f.cells.length; j++) {
        ctx.lineTo(cx(f.cells[j][1]), cy(f.cells[j][0]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* ---- current selection ---- */
    if (sel && dragging) {
      ctx.strokeStyle = 'rgba(124,92,255,.55)';
      ctx.lineWidth = CELL - 12;
      ctx.beginPath();
      ctx.moveTo(cx(sel.sc), cy(sel.sr));
      ctx.lineTo(cx(sel.ec), cy(sel.er));
      ctx.stroke();
    }
    if (flashT > 0 && flashCells) {
      ctx.globalAlpha = 0.45 * (flashT / 0.4);
      ctx.strokeStyle = '#ff5c7a';
      ctx.lineWidth = CELL - 12;
      ctx.beginPath();
      ctx.moveTo(cx(flashCells[0][1]), cy(flashCells[0][0]));
      for (j = 1; j < flashCells.length; j++) {
        ctx.lineTo(cx(flashCells[j][1]), cy(flashCells[j][0]));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* ---- letters ---- */
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold 22px ' + FONT;
    for (r = 0; r < ROWS; r++) {
      for (c = 0; c < COLS; c++) {
        var tint2 = foundCell[r + ',' + c];
        var inSel = sel && dragging &&
          (r - sel.sr) * (sel.ec - sel.sc) === (c - sel.sc) * (sel.er - sel.sr) &&
          (sel.er === sel.sr || sel.ec === sel.sc ||
           Math.abs(r - sel.sr) === Math.abs(c - sel.sc)) &&
          ((r - sel.sr) * (sel.er - sel.sr) >= 0) &&
          ((c - sel.sc) * (sel.ec - sel.sc) >= 0) &&
          Math.abs(r - sel.sr) <= Math.abs(sel.er - sel.sr) &&
          Math.abs(c - sel.sc) <= Math.abs(sel.ec - sel.sc);
        ctx.fillStyle = tint2 || inSel ? '#ffffff' : '#c9d6f2';
        ctx.fillText(grid[r][c], cx(c), cy(r) + 1);
      }
    }

    /* ---- found-word pills ---- */
    var px = 40, py = 514;
    if (!found.length) {
      ctx.font = '13px ' + FONT;
      ctx.fillStyle = '#93a3c2';
      ctx.textAlign = 'center';
      ctx.fillText('Drag across letters — or tap start and end cells — to find ten words',
                   W / 2, py + 10);
    } else {
      ctx.font = 'bold 13px ' + FONT;
      for (i = 0; i < found.length; i++) {
        var fw = found[i];
        var pw = Math.max(52, ctx.measureText(fw.word).width + 20);
        if (px + pw > 560) { px = 40; py += 32; }
        var scale = fw.pop > 0 ? 1 + fw.pop * 0.7 : 1;
        ctx.save();
        ctx.translate(px + pw / 2, py + 12);
        ctx.scale(scale, scale);
        rr(-pw / 2, -12, pw, 24, 12);
        ctx.globalAlpha = 0.16;
        ctx.fillStyle = fw.color;
        ctx.fill();
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = fw.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = '#e8eefc';
        ctx.textAlign = 'center';
        ctx.fillText(fw.word, 0, 1);
        ctx.restore();
        px += pw + 8;
      }
    }

    /* ---- particles ---- */
    for (i = 0; i < particles.length; i++) {
      var pt = particles[i];
      ctx.globalAlpha = clamp(pt.life / pt.life0, 0, 1);
      ctx.fillStyle = pt.col;
      ctx.fillRect(pt.x - pt.size / 2, pt.y - pt.size / 2, pt.size, pt.size);
    }
    ctx.globalAlpha = 1;

    /* ---- celebration ---- */
    if (state === 'clear') {
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(232,238,252,.95)';
      ctx.font = 'bold 36px ' + FONT;
      ctx.fillText('PUZZLE CLEAR!', W / 2, H * 0.42);
      ctx.font = 'bold 18px ' + FONT;
      ctx.fillStyle = '#2ee6a6';
      ctx.fillText('+' + lastBonus + ' bonus · next grid incoming…', W / 2, H * 0.42 + 34);
    }

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
    if (state === 'running' || state === 'clear') update(dt);
    else if (flashT > 0 || particles.length) update(dt);
    draw(t);
  }

  function ensureLoop() {
    if (!rafId) rafId = requestAnimationFrame(tick);
  }

  /* ---------------- input ---------------- */

  canvas.addEventListener('pointerdown', function (ev) {
    if (state !== 'running') return;
    var cell = cellFromEvent(ev);
    if (!cell) return;
    if (ev.preventDefault) ev.preventDefault();
    if (tapCell) {
      var from = tapCell;
      tapCell = null;
      if (from.r === cell.r && from.c === cell.c) {
        sel = { sr: cell.r, sc: cell.c, er: cell.r, ec: cell.c };
        dragging = true;
        return;
      }
      evaluate(from.r, from.c, cell.r, cell.c);
      return;
    }
    sel = { sr: cell.r, sc: cell.c, er: cell.r, ec: cell.c };
    dragging = true;
  });

  canvas.addEventListener('pointermove', function (ev) {
    if (!dragging || !sel) return;
    var cell = cellFromEvent(ev);
    if (!cell) return;
    if (cell.r === sel.er && cell.c === sel.ec) return;
    if (!isStraight(sel.sr, sel.sc, cell.r, cell.c)) return;
    sel.er = cell.r;
    sel.ec = cell.c;
  });

  window.addEventListener('pointerup', function () {
    if (!dragging || !sel) { dragging = false; return; }
    dragging = false;
    if (sel.er === sel.sr && sel.ec === sel.sc) {
      tapCell = { r: sel.sr, c: sel.sc };
      sel = null;
      return;
    }
    var s = sel;
    sel = null;
    evaluate(s.sr, s.sc, s.er, s.ec);
  });

  window.addEventListener('pointercancel', function () {
    dragging = false;
    sel = null;
  });

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    var k = e.key;

    if (k === ' ' || k === 'Enter' || k === 'Escape') {
      if (e.preventDefault) e.preventDefault();
    }

    if (k === ' ') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'paused') resume();
    } else if (k === 'Enter') {
      /* Enter never pauses — it only starts a fresh hunt. */
      if (state === 'ready' || state === 'over') start();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
    /* Letters a-z do nothing here — Word Hunt is traced, not typed. */
  });

  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  reset();
  updateHud();
  ensureLoop();
  GameShell.overlay.show({
    title: 'Word Hunt',
    msg: 'Ten words hide in the neon grid — forwards, backwards and diagonally. Drag across letters to grab them all before the 120-second clock runs out.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });

  /* Read-only debug/verification hook (frozen). */
  window.__wordHunt = Object.freeze({
    get state() { return state; },
    get score() { return score; },
    get time() { return time; },
    get puzzleNo() { return puzzleNo; },
    get foundCount() { return found.length; },
    get totalFound() { return totalFound; },
    get longest() { return longest; },
    get hidden() { return hidden.slice(); },
    get paths() {
      return paths.map(function (p) {
        return { word: p.word, cells: p.cells.map(function (c) { return [c[0], c[1]]; }) };
      });
    },
    get grid() { return grid.map(function (row) { return row.join(''); }); },
    geometry: Object.freeze({ gx: GX, gy: GY, cell: CELL, cols: COLS, rows: ROWS, w: W, h: H })
  });

  /* shared HUD reset button */
  if (typeof GameShell.onReset === 'function') GameShell.onReset(start);
})();
