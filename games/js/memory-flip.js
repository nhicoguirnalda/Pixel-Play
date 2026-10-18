/* ============================================================
   Memory Flip — original game for PixelPlay
   DOM matching-pairs game: 16 cards, 8 emoji pairs, 4x4 grid.
   Tap or click to flip; match all pairs in as few moves as you can.
   ============================================================ */

(function () {
  'use strict';

  var gameDom = document.getElementById('gameDom');
  if (!gameDom) return;

  var BEST_KEY = 'memory-flip';
  var PAIRS = 8;
  var EMOJI = ['🍒', '🎃', '👻', '🌙', '⭐', '🎁', '🔥', '🍀'];
  var FLIP_BACK_MS = 700;      /* how long a mismatch stays visible */
  var TICK_MS = 500;           /* HUD timer granularity (<= 1s) */

  var best = GameShell.best.get(BEST_KEY, 0);
  var state = 'ready';         /* ready | running | paused | over */
  var moves = 0;
  var matched = 0;
  var lock = false;            /* true while a mismatch is flipping back */
  var firstEl = null;          /* first card of the current attempt */
  var elapsedMs = 0;           /* time banked by previous running stretches */
  var runStart = 0;
  var newBest = false;
  var timerId = 0;
  var flipId = 0;

  /* ---------------- helpers ---------------- */

  function now() {
    return (typeof performance !== 'undefined' ? performance.now() : Date.now());
  }

  function seconds() {
    var ms = elapsedMs + (state === 'running' ? (now() - runStart) : 0);
    return Math.floor(ms / 1000);
  }

  function fmt(s) {
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }

  function shuffledDeck() {
    var deck = EMOJI.concat(EMOJI);
    for (var i = deck.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    return deck;
  }

  function cardFrom(target) {
    while (target && target !== gameDom) {
      if (target.className && (' ' + target.className + ' ').indexOf(' mem-card ') > -1) return target;
      target = target.parentNode;
    }
    return null;
  }

  function updateHud() {
    GameShell.hud({
      Moves: moves,
      Matches: matched + '/' + PAIRS,
      Time: fmt(seconds())
    }, state === 'paused' ? '⏸ Paused' : 'Score = 1200 − moves×25 − secs×4');
  }

  /* ---------------- board ---------------- */

  function render() {
    var deck = shuffledDeck();
    var html = '';
    for (var i = 0; i < deck.length; i++) {
      html +=
        '<button class="mem-card" type="button" data-emoji="' + deck[i] + '" ' +
                'aria-label="Hidden card ' + (i + 1) + '">' +
          '<span class="mem-inner">' +
            '<span class="mem-face mem-back" aria-hidden="true">✦</span>' +
            '<span class="mem-face mem-front" aria-hidden="true">' + deck[i] + '</span>' +
          '</span>' +
        '</button>';
    }
    gameDom.innerHTML = html;
  }

  function flipUp(el) {
    el.classList.add('flipped');
    el.setAttribute('aria-label', 'Card ' + el.getAttribute('data-emoji'));
  }

  function flipDown(el) {
    el.classList.remove('flipped');
    el.setAttribute('aria-label', 'Hidden card');
  }

  /* ---------------- game flow ---------------- */

  function start() {
    clearTimeout(flipId);
    flipId = 0;
    moves = 0;
    matched = 0;
    lock = false;
    firstEl = null;
    newBest = false;
    elapsedMs = 0;
    render();
    state = 'running';
    runStart = now();
    GameShell.overlay.hide();
    updateHud();
  }

  function pause() {
    if (state !== 'running') return;
    elapsedMs += now() - runStart;
    state = 'paused';
    updateHud();
    GameShell.overlay.show({
      title: 'Paused',
      msg: 'The board is hidden for now. Resume whenever you are ready.',
      stats: [
        { label: 'Moves', value: moves },
        { label: 'Matches', value: matched + '/' + PAIRS }
      ],
      btn: '▶ Resume',
      action: resume
    });
  }

  function resume() {
    if (state !== 'paused') return;
    state = 'running';
    runStart = now();
    GameShell.overlay.hide();
    updateHud();
  }

  function win() {
    elapsedMs += now() - runStart;
    state = 'over';
    clearTimeout(flipId);
    flipId = 0;
    lock = false;

    var secs = seconds();
    var score = Math.max(0, 1200 - moves * 25 - secs * 4);
    if (score > best) {
      best = score;
      newBest = true;
      GameShell.best.set(BEST_KEY, best);
    }
    updateHud();
    GameShell.overlay.show({
      title: newBest ? 'New best score!' : 'You win!',
      msg: 'You cleared all ' + PAIRS + ' pairs in ' + moves + ' move' + (moves === 1 ? '' : 's') +
           ' and ' + fmt(secs) + '. Can you beat it on the next round?',
      stats: [
        { label: 'Moves', value: moves },
        { label: 'Time', value: fmt(secs) },
        { label: 'Score', value: score },
        { label: 'Best', value: best }
      ],
      btn: '▶ Play again',
      action: start
    });
  }

  function onCard(el) {
    if (state !== 'running' || lock) return;
    if (el.classList.contains('flipped') || el.classList.contains('matched')) return;

    flipUp(el);

    if (!firstEl) {
      firstEl = el;
      return;
    }

    var a = firstEl;
    var b = el;
    firstEl = null;
    moves++;

    if (a.getAttribute('data-emoji') === b.getAttribute('data-emoji')) {
      a.classList.add('matched');
      b.classList.add('matched');
      matched++;
      updateHud();
      if (matched === PAIRS) win();
      return;
    }

    /* mismatch — reveal both briefly, block input while they flip back */
    lock = true;
    updateHud();
    flipId = setTimeout(function () {
      flipId = 0;
      flipDown(a);
      flipDown(b);
      lock = false;
    }, FLIP_BACK_MS);
  }

  /* ---------------- input ---------------- */

  gameDom.addEventListener('click', function (e) {
    var el = cardFrom(e.target);
    if (el) onCard(el);
  });

  var actionBtns = document.querySelectorAll('[data-action]');
  for (var b = 0; b < actionBtns.length; b++) {
    (function (btn) {
      btn.addEventListener('click', function () {
        var action = btn.getAttribute('data-action');
        if (action === 'new') start();
        else if (action === 'pause') {
          if (state === 'running') pause();
          else if (state === 'paused') resume();
        }
      });
    })(actionBtns[b]);
  }

  document.addEventListener('keydown', function (e) {
    var tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    var k = e.key;

    /* A focused button (card, pause, play) handles its own Space/Enter activation. */
    if (tag === 'BUTTON' && (k === ' ' || k === 'Enter')) return;

    if (k === ' ') e.preventDefault();

    if (k === ' ' || k === 'Enter') {
      if (state === 'ready' || state === 'over') start();
      else if (state === 'running') pause();
      else if (state === 'paused') resume();
    } else if (k === 'r' || k === 'R') {
      start();
    } else if (k === 'p' || k === 'P' || k === 'Escape') {
      if (state === 'running') pause();
      else if (state === 'paused') resume();
    }
  });

  /* Bank the elapsed time when the tab is hidden so the clock never jumps. */
  document.addEventListener('visibilitychange', function () {
    if (document.hidden && state === 'running') pause();
  });

  /* ---------------- boot ---------------- */

  render();
  updateHud();
  timerId = setInterval(function () {
    if (state === 'running') updateHud();
  }, TICK_MS);

  GameShell.overlay.show({
    title: 'Memory Flip',
    msg: 'Flip two cards to find a matching pair. Clear all eight pairs in as few moves and as little time as you can — every move and second trims your score.',
    stats: [{ label: 'Best', value: best }],
    btn: '▶ Play',
    action: start
  });
})();
