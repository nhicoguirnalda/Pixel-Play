/* ============================================================
   PixelPlay — Daily Word
   A five-letter guessing puzzle: six guesses, colour-coded
   tiles (green = correct spot, yellow = wrong spot, grey =
   absent), a canvas QWERTY keyboard with hit-testing, proper
   two-pass duplicate-letter scoring, flip animation, streaks.
   ============================================================ */

(function () {
  'use strict';

  /* ---------------- word list ---------------- */
  /* Every entry is exactly five letters, a-z only. The answer is drawn
     from this list; guesses must also appear in it. */

  var WORDS = (
    'about above abuse actor acute admit adopt adult after again agent agree ahead ' +
    'alarm album alert alike alive allow alone along alter among anger angle angry ' +
    'apart apple apply arena argue arise armor arrow aside asset audio avoid award ' +
    'aware badly baker basic basis beach began begin begun being below bench bible ' +
    'birth black blade blame blank blast blaze blend blind block blood bloom board ' +
    'boost booth bound brain brand brass brave bread break breed brick bride brief ' +
    'bring broad broke brown brush build built bunch burnt burst buyer cabin cable ' +
    'candy canoe cargo carry catch cause chain chair chalk charm chart chase cheap ' +
    'check cheek chess chest chief child chill china choir chose chunk cider cigar ' +
    'claim class clean clear clerk click cliff climb cling clock close cloth cloud ' +
    'clown coach coast cobra cocoa colon color comet comic couch cough could count ' +
    'court cover crack craft crane crash crazy cream creek crest crisp cross crowd ' +
    'crown crude cruel crush crust cubic curve cycle daily dance dealt death debut ' +
    'delay delta dense depth diary dirty ditch diver dizzy dodge doubt dozen draft ' +
    'drain drama drank drawn dream dress dried drift drill drink drive drone drove ' +
    'drown drunk dwell eager eagle early earth eaten ebony eight elbow elder elect ' +
    'elite empty enemy enjoy enter entry equal error essay event every exact exist ' +
    'extra fable faith false fancy fatal fault favor feast fence ferry fever fiber ' +
    'field fiery fifth fifty fight final first flame flash fleet flesh float flock ' +
    'flood floor flour fluid flush focus force forge forth forty forum found frame ' +
    'fraud fresh fried front fruit fully funny giant given glass globe gloom glory ' +
    'glove going grace grade grain grand grant grape graph grasp grass grave graze ' +
    'great green greet grief grind groan groom group grove growl guard guess guest ' +
    'guide guild guilt habit handy happy hardy harsh haven heart heavy hedge hello ' +
    'hence hobby honey honor horse hotel house human humor hurry ideal image imply ' +
    'index inner input irony issue ivory jelly jewel joint joker judge juice kneel ' +
    'knife knock known label labor lance large laser later laugh layer learn lease ' +
    'least leave legal lemon level light limit linen liver lobby local lodge logic ' +
    'loose lower loyal lucky lunar lunch lying magic major maker mango march match ' +
    'maybe mayor meant medal media melon mercy merge merit metal meter might mimic ' +
    'minor minus mixed model moist money month moral motor mount mourn mouse mouth ' +
    'movie music naive naked named nasty nerve never newly night noble noise north ' +
    'noted novel nurse ocean offer often olive onion opera orbit order organ other ' +
    'ought outer owner oxide paint panel panic paper parka party pasta patch pause ' +
    'peace peach pearl pedal penny perch phase phone photo piano piece pilot pinch ' +
    'pitch pixel place plain plane plant plate plaza plead pluck plumb plump plush ' +
    'point polar power press price pride prime print prior prize probe prone ' +
    'proof proud prove prowl prune pulse punch pupil purse queen query quest queue ' +
    'quick quiet quilt quota radio raise rally ranch range rapid ratio reach react ' +
    'ready realm rebel refer reign relax reply rerun rhino ridge rifle rigid rinse ' +
    'risen rival river roast robin robot rocky rogue roman rough round route royal ' +
    'ruler rumor rural sadly saint salad salon sauce scale scene scent scoop scope ' +
    'score scout scrap screw scrub sedan sense serve seven shall shape share shark ' +
    'sharp shave sheep sheet shelf shell shift shine shiny shore short shown shrub ' +
    'sight silky silly since skiff skill skirt skull slate sleek sleep sheen slope ' +
    'small smart smoke snack snake sneak sober solar solid solve sonic sorry sound ' +
    'south space spade spare spark speak spear speed spell spend spice spike spine ' +
    'sprig spite squib split spoil spoke spoon sport spray spree squad stack staff ' +
    'stage stain stake stale stall stamp stand stare stark start state steak steal ' +
    'steam steel steep steer stern stick stiff still sting stock stole stone stood ' +
    'store storm story stout stove strap straw stray strip stuck study stuff stunt ' +
    'style sugar suite sunny super surge sushi swamp swear sweat sweep sweet swept ' +
    'swift swing sword syrup table taken talon tango taste tempo tenor tense tenth ' +
    'thank theft their theme there these thick thief thigh thing think third thorn ' +
    'those three threw throw thumb tiger tight timer tired title toast today token ' +
    'tonic tooth topaz topic torch total touch tough towel tower toxic trace track ' +
    'trade trail train trait tramp trash treat trend trial tribe trick tried tries ' +
    'troop trout truly trump trunk trust truth tulip tumor twice twist tying ultra ' +
    'uncle under union unity until upper upset urban usage usual vague valid value ' +
    'valve vapor venue video vigil villa vinyl viola viper viral virus visit vital ' +
    'vocal vodka vogue voice vowel wagon wants waste watch water weary weave wedge ' +
    'weigh weird whale wheat wheel where which while white whole whose widen widow ' +
    'width windy witch woman world worry worse worst worth would wound woven wrath ' +
    'wreck wrist write wrong wrote yacht yeast yield young yours youth zebra'
  ).split(' ');

  var WORD_SET = {};
  (function () {
    for (var wi = 0; wi < WORDS.length; wi++) WORD_SET[WORDS[wi]] = true;
  })();

  /* ---------------- constants ---------------- */

  var ROWS = 6, COLS = 5;
  var SCORE_BASE = 700, SCORE_PENALTY = 100;
  var STREAK_KEY = 'pp-daily-word-streak';
  var LAST_KEY = 'pp-daily-word-last';
  var BEST_KEY = 'daily-word';
  var HINT = 'Enter = submit · Backspace = erase';

  /* keyboard rows: [label, type] — type: 'letter' | 'back' | 'enter' */
  var KB = [
    [['Q'], ['W'], ['E'], ['R'], ['T'], ['Y'], ['U'], ['I'], ['O'], ['P']],
    [['A'], ['S'], ['D'], ['F'], ['G'], ['H'], ['J'], ['K'], ['L']],
    [['⌫', 'back'], ['Z'], ['X'], ['C'], ['V'], ['B'], ['N'], ['M'], ['↵', 'enter']]
  ];

  /* ---------------- state ---------------- */

  var canvas = document.getElementById('gameCanvas');
  var ctx = canvas.getContext('2d');
  var mode = 'ready';            /* ready | playing | paused | won | lost */
  var answer = '';
  var grid = [];                 /* rows: [{ letters:[], states:[] }] */
  var current = [];              /* letters typed in the open row */
  var keyStates = {};            /* letter -> absent | present | correct */
  var roundScore = 0;
  var totalScore = 0;
  var best = 0;
  var streak = 0;
  var toast = '', toastT = 0;
  var anim = null;               /* { row, t } flip animation clock */
  var pending = null;            /* { letters, states } waiting on animation */
  var t = 0;                     /* elapsed seconds, animation clock */
  var W = 600, H = 600;          /* logical size, scaled to canvas */
  var kbRects = [];              /* hit-test rects for the canvas keyboard */

  best = GameShell.best.get(BEST_KEY, 0);
  streak = (function () {
    try { return parseInt(localStorage.getItem(STREAK_KEY), 10) || 0; }
    catch (e) { return 0; }
  })();

  /* ---------------- helpers ---------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function showToast(msg) {
    toast = msg;
    toastT = 1.6;
  }

  function pickAnswer() {
    /* fresh word every round; never repeat the previous answer back to back */
    var lastIdx = -1;
    try { lastIdx = parseInt(localStorage.getItem(LAST_KEY), 10); } catch (e) { lastIdx = -1; }
    if (isNaN(lastIdx) || lastIdx < 0 || lastIdx >= WORDS.length) lastIdx = -1;
    var idx = Math.floor(Math.random() * (WORDS.length - 1));
    if (idx >= lastIdx) idx++;          /* skip over the last index */
    try { localStorage.setItem(LAST_KEY, String(idx)); } catch (e) { /* ignore */ }
    return WORDS[idx];
  }

  /* two-pass scoring: first mark exact matches and count remaining
     occurrences of each letter, then award 'present' for the rest so a
     repeated letter can never be over-revealed */
  function scoreGuess(guess) {
    var states = ['absent', 'absent', 'absent', 'absent', 'absent'];
    var need = {};
    var i, ch;
    for (i = 0; i < COLS; i++) {
      ch = answer.charAt(i);
      if (guess.charAt(i) === ch) {
        states[i] = 'correct';
      } else {
        need[ch] = (need[ch] || 0) + 1;
      }
    }
    for (i = 0; i < COLS; i++) {
      if (states[i] === 'correct') continue;
      ch = guess.charAt(i);
      if (need[ch] > 0) {
        states[i] = 'present';
        need[ch]--;
      }
    }
    return states;
  }

  function rank(st) { return st === 'correct' ? 3 : (st === 'present' ? 2 : (st === 'absent' ? 1 : 0)); }

  function mergeKeyState(letter, st) {
    var cur = keyStates[letter];
    if (!cur || rank(st) > rank(cur)) keyStates[letter] = st;
  }

  function newRound() {
    answer = pickAnswer();
    grid = [];
    current = [];
    keyStates = {};
    roundScore = 0;
    anim = null;
    pending = null;
    toast = '';
    toastT = 0;
    mode = 'playing';
    GameShell.overlay.hide();
    updateHud();
  }

  function updateHud() {
    var left = ROWS - grid.length - (anim ? 1 : 0);
    GameShell.hud({
      Score: totalScore,
      Best: Math.max(best, totalScore),
      Streak: streak,
      'Guesses left': Math.max(0, left)
    }, HINT);
  }

  function saveStreak() {
    try { localStorage.setItem(STREAK_KEY, String(streak)); } catch (e) { /* ignore */ }
  }

  /* ---------------- round end ---------------- */

  function endRound(won) {
    mode = won ? 'won' : 'lost';
    var word = answer.toUpperCase();
    if (won) {
      roundScore = Math.max(0, SCORE_BASE - SCORE_PENALTY * (grid.length - 1));
      totalScore += roundScore;
      streak++;
      saveStreak();
      if (totalScore > best) {
        best = totalScore;
        GameShell.best.set(BEST_KEY, best);
      }
      GameShell.overlay.show({
        title: 'Solved! 🎉',
        msg: 'Solved in ' + grid.length + ' guess' + (grid.length === 1 ? '' : 'es') +
             ' — the word was ' + word + '. Streak: ' + streak + ' in a row.',
        stats: [
          { label: 'Score', value: '+' + roundScore },
          { label: 'Total', value: totalScore },
          { label: 'Best', value: best },
          { label: 'Streak', value: streak }
        ],
        btn: '▶ Next word',
        action: newRound
      });
    } else {
      streak = 0;
      saveStreak();
      if (totalScore > best) {
        best = totalScore;
        GameShell.best.set(BEST_KEY, best);
      }
      GameShell.overlay.show({
        title: 'Out of guesses',
        msg: 'The word was ' + word + '. Streak reset — try the next one!',
        stats: [
          { label: 'Score', value: totalScore },
          { label: 'Best', value: best },
          { label: 'Streak', value: streak }
        ],
        btn: '▶ Next word',
        action: newRound
      });
    }
    updateHud();
  }

  /* ---------------- input ---------------- */

  function submitGuess() {
    if (current.length < COLS) {
      showToast('Not enough letters');
      return;
    }
    var guess = current.join('');
    if (!WORD_SET[guess]) {
      showToast('Not in the word list');
      return;
    }
    var states = scoreGuess(guess);
    pending = { letters: guess, states: states };
    anim = { row: grid.length, t: 0 };
    current = [];
    updateHud();
  }

  function typeLetter(ch) {
    if (mode !== 'playing' || anim) return;
    if (current.length >= COLS) {
      showToast('Row is full — press Enter');
      return;
    }
    current.push(ch);
  }

  function backspace() {
    if (mode !== 'playing' || anim) return;
    current.pop();
  }

  function togglePause() {
    /* pause is bound to P and Esc ONLY — Enter never pauses */
    if (mode === 'playing') {
      mode = 'paused';
      GameShell.overlay.show({
        title: 'Paused',
        msg: 'Take your time — the letters will wait.',
        stats: [],
        btn: '▶ Resume',
        action: function () {
          mode = 'playing';
          GameShell.overlay.hide();
          updateHud();
        }
      });
    } else if (mode === 'paused') {
      mode = 'playing';
      GameShell.overlay.hide();
      updateHud();
    }
  }

  function startFromBoot() {
    if (mode !== 'ready') return;
    newRound();
  }

  /* ---------------- events ---------------- */

  document.addEventListener('keydown', function (e) {
    try {
      var k = e.key;
      if (k === ' ' || k === 'Spacebar') {
        if (mode === 'ready') { startFromBoot(); if (e.preventDefault) e.preventDefault(); }
        return;
      }
      if (k === 'Enter') {
        /* ONLY submits a guess — never pauses, even mid-typing */
        if (mode === 'playing' && !anim) submitGuess();
        return;
      }
      if (k === 'Backspace') { backspace(); return; }
      if (k === 'Escape' || k === 'P') { togglePause(); return; }
      /* lowercase p is just a letter — pausing uses Shift+P or Esc so that
         every letter of the alphabet stays typeable */
      if (typeof k === 'string' && k.length === 1) {
        var ch = k.toLowerCase();
        if (ch >= 'a' && ch <= 'z') typeLetter(ch);
      }
    } catch (err) { /* never throw from an input handler */ }
  });

  /* canvas keyboard hit-testing (mouse + touch via click) */
  function canvasPoint(ev) {
    var r = canvas.getBoundingClientRect();
    var cx = (ev && ev.clientX !== undefined) ? ev.clientX : -1;
    var cy = (ev && ev.clientY !== undefined) ? ev.clientY : -1;
    if (cx < 0) return null;
    return { x: (cx - r.left) * (W / (r.width || W)), y: (cy - r.top) * (H / (r.height || H)) };
  }

  function hitKey(p) {
    if (!p) return null;
    for (var i = 0; i < kbRects.length; i++) {
      var r = kbRects[i];
      if (p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h) return r;
    }
    return null;
  }

  function onCanvasPointer(ev) {
    try {
      if (mode !== 'playing') return;
      var hit = hitKey(canvasPoint(ev));
      if (!hit) return;
      if (hit.type === 'letter') typeLetter(hit.label.toLowerCase());
      else if (hit.type === 'back') backspace();
      else if (hit.type === 'enter') submitGuess();
      if (ev && ev.preventDefault) ev.preventDefault();
    } catch (err) { /* never throw from a pointer handler */ }
  }

  if (canvas.addEventListener) {
    canvas.addEventListener('mousedown', onCanvasPointer);
    canvas.addEventListener('touchstart', onCanvasPointer);
  }

  document.addEventListener('visibilitychange', function () {
    try {
      if (document.hidden && mode === 'playing') {
        mode = 'paused';
        GameShell.overlay.show({
          title: 'Paused',
          msg: 'The puzzle is waiting for you.',
          stats: [],
          btn: '▶ Resume',
          action: function () {
            mode = 'playing';
            GameShell.overlay.hide();
            updateHud();
          }
        });
      }
    } catch (err) { /* ignore */ }
  });

  /* ---------------- layout & drawing ---------------- */

  function fitCanvas() {
    try {
      var dpr = window.devicePixelRatio || 1;
      var cw = canvas.clientWidth || canvas.width || 600;
      var chh = canvas.clientHeight || canvas.height || 600;
      if (cw > 0 && chh > 0) {
        canvas.width = Math.round(cw * dpr);
        canvas.height = Math.round(chh * dpr);
      }
      W = (canvas.width || 600) / (dpr || 1);
      H = (canvas.height || 600) / (dpr || 1);
      if (ctx.setTransform) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    } catch (e) { W = 600; H = 600; }
  }

  function tileLayout() {
    var pad = W * 0.06;
    var gap = W * 0.015;
    var ts = Math.min((W - pad * 2 - gap * (COLS - 1)) / COLS, H * 0.09);
    var gridW = ts * COLS + gap * (COLS - 1);
    var x0 = (W - gridW) / 2;
    var y0 = H * 0.045;
    return { pad: pad, gap: gap, ts: ts, x0: x0, y0: y0 };
  }

  function buildKbRects(L) {
    var rows = KB.length;
    var keyGap = L.gap;
    var kh = Math.min(L.ts, H * 0.075);
    var kwRow1 = (W - L.pad * 2 - keyGap * 9) / 10;
    var y = H * 0.045 + L.ts * ROWS + H * 0.035;
    kbRects = [];
    for (var r = 0; r < rows; r++) {
      var defs = KB[r];
      var n = defs.length;
      var wideCount = 0, i;
      for (i = 0; i < n; i++) if (defs[i].length > 1) wideCount++;
      var totalW = kwRow1 * n + wideCount * kwRow1 * 0.5 + keyGap * (n - 1);
      var x = (W - totalW) / 2;
      for (i = 0; i < n; i++) {
        var isWide = defs[i].length > 1;
        var w = kwRow1 * (isWide ? 1.5 : 1);
        kbRects.push({ x: x, y: y, w: w, h: kh, label: defs[i][0], type: isWide ? defs[i][1] : 'letter', row: r });
        x += w + keyGap;
      }
      y += kh + keyGap;
    }
  }

  function roundRect(x, y, w, h, rad) {
    var r = Math.min(rad, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  var TILE_FILL = '#141d33', TILE_EDGE = '#24334f';
  var COLOR = {
    correct: '#2ee66b',
    present: '#f5c518',
    absent: '#3a4666',
    letter: '#e8eefc',
    neon: '#7dd3fc'
  };

  function tileColor(st) {
    return COLOR[st] || TILE_FILL;
  }

  function drawGrid(L) {
    var ts = L.ts, gap = L.gap;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var fs = Math.round(ts * 0.55);
    ctx.font = '700 ' + fs + 'px "Segoe UI", system-ui, sans-serif';

    for (var r = 0; r < ROWS; r++) {
      var letters = null, states = null;
      if (r < grid.length) {
        letters = grid[r].letters;
        states = grid[r].states;
      } else if (r === grid.length && anim) {
        letters = pending.letters.split('');
        states = null;
      } else if (r === grid.length) {
        letters = current.slice();
      }
      if (!letters) {
        /* empty row outline */
        for (var c0 = 0; c0 < COLS; c0++) {
          var ex = L.x0 + c0 * (ts + gap), ey = L.y0 + r * (ts + gap);
          ctx.strokeStyle = TILE_EDGE;
          ctx.lineWidth = Math.max(1, ts * 0.03);
          roundRect(ex, ey, ts, ts, ts * 0.08);
          ctx.stroke();
        }
        continue;
      }
      for (var c = 0; c < COLS; c++) {
        var x = L.x0 + c * (ts + gap), y = L.y0 + r * (ts + gap);
        var st = states ? states[c] : null;
        var reveal = false, scaleY = 1;

        if (anim && r === anim.row) {
          /* flip: tile rotates through 90°, colour swaps at the midpoint */
          var per = 0.26, stag = 0.09;
          var local = anim.t - c * stag;
          if (local < 0) local = 0;
          if (local > per) local = per;
          var ph = local / per;
          scaleY = Math.abs(Math.cos(ph * Math.PI));
          reveal = ph >= 0.5;
          if (reveal) st = pending.states[c];
        } else if (states) {
          reveal = true;
        }

        ctx.fillStyle = reveal ? tileColor(st) : TILE_FILL;
        if (reveal && (st === 'correct' || st === 'present')) {
          ctx.shadowColor = tileColor(st);
          ctx.shadowBlur = ts * 0.18;
        }
        var yy = y + (ts - ts * scaleY) / 2;
        roundRect(x, yy, ts, ts * scaleY, ts * 0.08);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (scaleY > 0.35) {
          var ch = letters[c];
          if (ch) {
            ctx.fillStyle = (reveal && st !== 'letter') ? '#0b1020' : COLOR.letter;
            ctx.fillText(ch, x + ts / 2, y + ts / 2 + ts * 0.02);
          } else if (!reveal) {
            ctx.strokeStyle = TILE_EDGE;
            ctx.lineWidth = Math.max(1, ts * 0.03);
            roundRect(x + 1, y + 1, ts - 2, ts - 2, ts * 0.08);
            ctx.stroke();
          }
        }
      }
    }
  }

  function drawKeyboard() {
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (var i = 0; i < kbRects.length; i++) {
      var r = kbRects[i];
      var st = r.type === 'letter' ? keyStates[r.label.toLowerCase()] : null;
      var fs = Math.round(Math.min(r.h * 0.42, r.w * 0.42));
      ctx.font = '700 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = st ? tileColor(st) : '#1c2947';
      if (st === 'correct' || st === 'present') {
        ctx.shadowColor = tileColor(st);
        ctx.shadowBlur = r.h * 0.2;
      }
      roundRect(r.x, r.y, r.w, r.h, r.h * 0.18);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = st ? '#0b1020' : '#c9d6f2';
      ctx.fillText(r.label, r.x + r.w / 2, r.y + r.h / 2 + r.h * 0.03);
    }
  }

  function drawToast() {
    if (toastT <= 0 || !toast) return;
    var a = clamp(toastT / 0.4, 0, 1);
    var fs = Math.round(H * 0.028);
    ctx.font = '700 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var tw = ctx.measureText(toast).width + fs * 2;
    var x = (W - tw) / 2;
    var y = H * 0.012;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#0e1730';
    roundRect(x, y, tw, fs * 1.9, fs * 0.6);
    ctx.fill();
    ctx.strokeStyle = COLOR.neon;
    ctx.lineWidth = 1;
    roundRect(x, y, tw, fs * 1.9, fs * 0.6);
    ctx.stroke();
    ctx.fillStyle = '#e8eefc';
    ctx.fillText(toast, W / 2, y + fs * 0.98);
    ctx.globalAlpha = 1;
  }

  function draw() {
    var L = tileLayout();
    buildKbRects(L);

    ctx.fillStyle = '#0b1020';
    ctx.fillRect(0, 0, W, H);

    /* soft neon header line */
    var g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(125,211,252,0)');
    g.addColorStop(0.5, 'rgba(125,211,252,0.55)');
    g.addColorStop(1, 'rgba(125,211,252,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, H * 0.028, W, Math.max(1, H * 0.002));

    drawGrid(L);
    drawKeyboard();
    drawToast();

    if (mode === 'ready') {
      ctx.fillStyle = 'rgba(11,16,32,0.55)';
      ctx.fillRect(0, 0, W, H);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      var fs = Math.round(H * 0.05);
      ctx.font = '800 ' + fs + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = COLOR.neon;
      ctx.fillText('DAILY WORD', W / 2, H * 0.42);
      ctx.font = '600 ' + Math.round(H * 0.028) + 'px "Segoe UI", system-ui, sans-serif';
      ctx.fillStyle = '#9fb2d8';
      ctx.fillText('Five letters. Six guesses. Press Play or Space.', W / 2, H * 0.5);
    }
  }

  /* ---------------- main loop ---------------- */

  var rafId = 0;
  function loop() {
    rafId = requestAnimationFrame(loop);
    try {
      var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      loop.last = loop.last === undefined ? now : loop.last;
      var dt = (now - loop.last) / 1000;
      loop.last = now;
      if (!(dt >= 0)) dt = 0;
      dt = clamp(dt, 0, 0.05);      /* clamp so tab-switch never teleports state */
      t += dt;

      if (toastT > 0) toastT = Math.max(0, toastT - dt);

      if (anim) {
        anim.t += dt;
        var total = 0.26 + 0.09 * (COLS - 1) + 0.12;
        if (anim.t >= total) {
          var letters = pending.letters, states = pending.states;
          grid.push({ letters: letters.split(''), states: states });
          for (var i = 0; i < COLS; i++) mergeKeyState(letters.charAt(i).toUpperCase(), states[i]);
          var won = true;
          for (var j = 0; j < COLS; j++) if (states[j] !== 'correct') { won = false; break; }
          anim = null;
          pending = null;
          updateHud();
          if (won) endRound(true);
          else if (grid.length >= ROWS) endRound(false);
        }
      }
      draw();
    } catch (e) { /* never let a frame kill the loop */ }
  }

  /* ---------------- boot ---------------- */

  fitCanvas();
  if (window.addEventListener) window.addEventListener('resize', fitCanvas);

  GameShell.hud({
    Score: totalScore,
    Best: best,
    Streak: streak,
    'Guesses left': ROWS
  }, HINT);

  GameShell.overlay.show({
    title: 'Daily Word',
    msg: 'Guess the hidden five-letter word in six tries. Green means right spot, yellow means wrong spot.',
    stats: [
      { label: 'Words', value: WORDS.length },
      { label: 'Best', value: best },
      { label: 'Streak', value: streak }
    ],
    btn: '▶ Play',
    action: startFromBoot
  });

  /* answer is drawn up-front so a fresh round always exists to inspect */
  answer = pickAnswer();

  requestAnimationFrame(loop);

  /* ---------------- test snapshot (read-only) ---------------- */

  try {
    Object.defineProperty(window, '__dailyWord', {
      value: Object.freeze({
        snapshot: function () {
          return {
            state: mode,
            answer: answer,
            rows: grid.map(function (g2) {
              return { word: g2.letters.join(''), states: g2.states.slice() };
            }),
            current: current.join(''),
            keyStates: (function () {
              var out = {};
              for (var k2 in keyStates) {
                if (Object.prototype.hasOwnProperty.call(keyStates, k2)) out[k2] = keyStates[k2];
              }
              return out;
            })(),
            guessesLeft: Math.max(0, ROWS - grid.length - (anim ? 1 : 0)),
            animating: !!anim,
            score: totalScore,
            best: Math.max(best, totalScore),
            streak: streak,
            words: WORDS.length,
            wordList: Object.freeze(WORDS.slice())
          };
        }
      }),
      writable: false,
      configurable: false
    });
  } catch (e) { /* snapshot hook unavailable — ignore */ }

  /* shared HUD reset button */
  function resetGame() {
    totalScore = 0;
    newRound();
  }
  if (typeof GameShell.onReset === 'function') GameShell.onReset(resetGame);
})();
