/* ============================================================
   PixelPlay — shared game-page shell
   Provides: overlay + HUD helpers (GameShell), related games,
   popular sidebar, recently-played tracking.
   Every game page loads this before its own game script.
   ============================================================ */

(function () {
  'use strict';

  var root = siteRoot();
  var currentId = document.body.getAttribute('data-game') || '';
  var current = getGame(currentId);

  /* ---------------- GameShell API ---------------- */

  var resetHandler = null;
  var lastHud = null, lastRight = '';
  var party = { on: false, player: 1, p1: null, p2: null, active: false };
  var duoHandlers = null, duoOn = false;

  /* Scores for the two-player party mode. Every game exposes its score in
     the HUD or the game-over stats, so one shared comparison covers them all. */
  var SCORE_KEYS = ['Score', 'Final score', 'Final', 'Points', 'Height', 'Distance', 'Lines', 'Words', 'Wins', 'Kills'];

  function firstNumber(value) {
    if (typeof value === 'number') return isFinite(value) ? value : 0;
    var m = String(value).replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return m ? parseFloat(m[0]) : 0;
  }

  function scoreFrom(map) {
    if (!map) return 0;
    for (var i = 0; i < SCORE_KEYS.length; i++) {
      for (var k in map) {
        if (Object.prototype.hasOwnProperty.call(map, k) &&
            k.toLowerCase() === SCORE_KEYS[i].toLowerCase()) {
          return firstNumber(map[k]);
        }
      }
    }
    return 0;
  }

  function scoreOf(opts) {
    var stats = opts.stats || [];
    var map = {};
    for (var i = 0; i < stats.length; i++) map[stats[i].label] = stats[i].value;
    var score = scoreFrom(map);
    return score || scoreFrom(lastHud);
  }

  function isPauseOrContinue(opts) {
    var title = String(opts.title || '');
    var btn = String(opts.btn || '');
    return /pause/i.test(title) || /continue|keep playing|next/i.test(btn);
  }

  function refreshHud() {
    if (lastHud) shell.hud(lastHud, lastRight);
  }

  function startPartyRound() {
    party.active = true;
    resetGame();
  }

  function partyEnd(opts) {
    var score = scoreOf(opts);
    party.active = false;
    if (party.player === 1) {
      party.p1 = score;
      party.player = 2;
      refreshHud();
      rawShow({
        title: 'Player 1: ' + score,
        msg: 'Pass the device to Player 2. Their round starts with the button below, then the higher score wins.',
        stats: [{ label: 'Player 1', value: score }],
        btn: '▶ Player 2 starts',
        action: startPartyRound
      });
    } else {
      party.p2 = score;
      party.player = 1;
      refreshHud();
      var title = party.p1 > score ? 'Player 1 wins!' :
                  score > party.p1 ? 'Player 2 wins!' : "It's a draw!";
      rawShow({
        title: title,
        msg: 'Player 1 scored ' + party.p1 + ' and Player 2 scored ' + score +
             '. Play another match, or press the Party button to leave.',
        stats: [
          { label: 'Player 1', value: party.p1 },
          { label: 'Player 2', value: score }
        ],
        btn: '▶ New match',
        action: function () {
          party.p1 = null; party.p2 = null; party.player = 1;
          startPartyRound();
        }
      });
    }
  }

  function toggleParty() {
    if (duoOn) {
      duoOn = false;
      if (duoHandlers) duoHandlers.stop();
    }
    party.on = !party.on;
    party.player = 1;
    party.p1 = null;
    party.p2 = null;
    party.active = false;
    startPartyRound();
  }

  /* Duo is simultaneous same-screen play: the game registers a start and a
     stop function and owns both characters, scores and the winner screen. */
  function toggleDuo() {
    if (!duoHandlers) return;
    duoOn = !duoOn;
    party.on = false;
    party.active = false;
    if (duoOn) duoHandlers.start();
    else duoHandlers.stop();
  }

  function rawShow(opts) {
    var ov = document.getElementById('gameOverlay');
    if (!ov) return;
    opts = opts || {};
    var t = document.getElementById('overlayTitle');
    var m = document.getElementById('overlayMsg');
    var s = document.getElementById('overlayStats');
    var b = document.getElementById('overlayBtn');
    var b2 = document.getElementById('overlayBtn2');
    if (t) t.textContent = opts.title || '';
    if (m) m.textContent = opts.msg || '';
    if (s) {
      var html = '';
      var stats = opts.stats || [];
      for (var i = 0; i < stats.length; i++) {
        html += '<span>' + stats[i].label + '<b>' + stats[i].value + '</b></span>';
      }
      s.innerHTML = html;
      s.style.display = html ? '' : 'none';
    }
    if (b) {
      b.textContent = opts.btn || '▶ Play';
      b.onclick = opts.action || null;
      b.style.display = opts.action === false ? 'none' : '';
    }
    if (b2) {
      b2.style.display = 'none';
      b2.onclick = null;
    }
    ov.classList.remove('hidden');
  }

  function rawHide() {
    var ov = document.getElementById('gameOverlay');
    if (ov) ov.classList.add('hidden');
  }

  var shell = {
    el: function (id) { return document.getElementById(id); },

    /* Games register their own fresh-start function here. The HUD reset
       button calls it; pages without a handler reload as a safe fallback. */
    onReset: function (fn) {
      resetHandler = typeof fn === 'function' ? fn : null;
    },

    /* Games with a simultaneous two-player mode register it here. The HUD
       button calls start(); clicking it again calls stop() for a solo restart. */
    onDuo: function (start, stop) {
      duoHandlers = (typeof start === 'function' && typeof stop === 'function')
        ? { start: start, stop: stop } : null;
    },

    /* GameShell.hud({ Score: 0, Best: 0 }, optionalRightText) */
    hud: function (map, rightText) {
      var hud = document.getElementById('gameHud');
      if (!hud) return;
      lastHud = {};
      for (var key in map) {
        if (Object.prototype.hasOwnProperty.call(map, key)) lastHud[key] = map[key];
      }
      lastRight = rightText || '';
      var html = '';
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        html += '<span class="hud-item">' + k + '<b>' + map[k] + '</b></span>';
      }
      html += '<span class="hud-item hud-spacer">' + (rightText || '') + '</span>';
      html += '<button class="hud-btn" type="button" data-reset title="Restart this game" aria-label="Restart this game">↺ Reset</button>';
      if (duoHandlers) {
        html += '<button class="hud-btn" type="button" data-duo aria-pressed="' + (duoOn ? 'true' : 'false') +
                '" title="' + (duoOn ? 'Duo mode: two players at once — click to play solo' : 'Two players at the same time on this device') +
                '">' + (duoOn ? '🤝 Duo on' : '🤝 Duo') + '</button>';
      }
      if (!duoOn) {
        html += '<button class="hud-btn" type="button" data-party aria-pressed="' + (party.on ? 'true' : 'false') +
                '" title="' + (party.on ? 'Party mode: Player ' + party.player + ' — click to leave' : 'Take turns and compare scores') +
                '">' + (party.on ? '👥 P' + party.player : '👥 Party') + '</button>';
      }
      if (party.on && party.active) {
        html += '<button class="hud-btn" type="button" data-endturn title="Finish this turn and compare scores">🏁 End turn</button>';
      }
      html += '<button class="hud-btn" type="button" data-fullscreen>⛶ Fullscreen</button>';
      hud.innerHTML = html;

      var resetBtn = hud.querySelector('[data-reset]');
      if (resetBtn) resetBtn.addEventListener('click', resetGame);

      var duoBtn = hud.querySelector('[data-duo]');
      if (duoBtn) duoBtn.addEventListener('click', toggleDuo);

      var partyBtn = hud.querySelector('[data-party]');
      if (partyBtn) partyBtn.addEventListener('click', toggleParty);

      var endBtn = hud.querySelector('[data-endturn]');
      if (endBtn) endBtn.addEventListener('click', function () { partyEnd({}); });

      var fsBtn = hud.querySelector('[data-fullscreen]');
      if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    },

    overlay: {
      /* GameShell.overlay.show({ title, msg, stats:[{label,value}], btn, action }) */
      show: function (opts) {
        opts = opts || {};
        /* A handoff or match result is waiting: keep it on screen. */
        if (party.on && !party.active) return;
        if (party.on && !isPauseOrContinue(opts)) {
          partyEnd(opts);
          return;
        }
        rawShow(opts);
      },
      hide: function () {
        if (party.on) party.active = true;
        rawHide();
      },
      isOpen: function () {
        var ov = document.getElementById('gameOverlay');
        return !!ov && !ov.classList.contains('hidden');
      }
    },

    best: {
      get: function (key, fallback) {
        try {
          var v = localStorage.getItem('pixelplay.best.' + key);
          return v === null ? (fallback || 0) : parseInt(v, 10) || 0;
        } catch (e) { return fallback || 0; }
      },
      set: function (key, value) {
        try { localStorage.setItem('pixelplay.best.' + key, String(value)); } catch (e) {}
      }
    }
  };

  function resetGame() {
    if (resetHandler) {
      try { resetHandler(); return; } catch (e) { /* fall back to a reload */ }
    }
    try { window.location.reload(); } catch (e) { /* ignore */ }
  }

  function toggleFullscreen() {
    var stage = document.querySelector('.game-stage');
    if (!stage) return;
    try {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else if (stage.requestFullscreen) {
        stage.requestFullscreen();
      }
    } catch (e) { /* fullscreen unavailable */ }
  }

  window.GameShell = shell;

  /* ---------------- Breadcrumbs ---------------- */

  var crumbs = document.getElementById('breadcrumbs');
  if (crumbs && current) {
    crumbs.innerHTML =
      '<a href="' + root + 'index.html">Home</a><span>/</span>' +
      '<a href="' + root + 'index.html?cat=' + current.cat + '">' + categoryLabel(current.cat) + '</a>' +
      '<span>/</span>' + current.title;
  }

  /* ---------------- Sidebar: most popular ---------------- */

  var pop = document.getElementById('popularList');
  if (pop) {
    var top = GAMES.slice().sort(function (a, b) { return b.playsN - a.playsN; })
                   .filter(function (g) { return g.id !== currentId; })
                   .slice(0, 5);
    var html = '';
    for (var i = 0; i < top.length; i++) {
      var g = top[i];
      html +=
        '<a href="' + gameUrl(g, root) + '">' +
          '<span class="side-icon" style="--g1:' + g.c1 + ';--g2:' + g.c2 + '">' + g.icon + '</span>' +
          '<span><span class="side-title">' + g.title + '</span><br>' +
          '<span class="side-sub">▶ ' + g.plays + ' · ★ ' + g.rating + '</span></span>' +
        '</a>';
    }
    pop.innerHTML = html;
  }

  /* ---------------- Sidebar: category links ---------------- */

  var catList = document.getElementById('catList');
  if (catList) {
    var counts = {};
    for (var c = 0; c < GAMES.length; c++) {
      counts[GAMES[c].cat] = (counts[GAMES[c].cat] || 0) + 1;
    }
    var catHtml = '';
    for (var d = 0; d < CATEGORIES.length; d++) {
      var cat = CATEGORIES[d];
      if (cat.id === 'all') continue;
      var n = counts[cat.id] || 0;
      catHtml +=
        '<a href="' + root + 'index.html?cat=' + cat.id + '">' +
          '<span class="side-icon" style="--g1:#25334f;--g2:#182338">' + cat.icon + '</span>' +
          '<span><span class="side-title">' + cat.label + '</span><br>' +
          '<span class="side-sub">' + n + (n === 1 ? ' game' : ' games') + '</span></span>' +
        '</a>';
    }
    catList.innerHTML = catHtml;
  }

  /* ---------------- Related games ---------------- */

  var rel = document.getElementById('relatedGames');
  if (rel && current) {
    var same = [], other = [];
    for (var j = 0; j < GAMES.length; j++) {
      if (GAMES[j].id === currentId) continue;
      (GAMES[j].cat === current.cat ? same : other).push(GAMES[j]);
    }
    var pick = same.concat(other).slice(0, 4);
    var relHtml = '';
    for (var k = 0; k < pick.length; k++) relHtml += gameCardHTML(pick[k], root);
    rel.innerHTML = relHtml;
  }

  /* ---------------- Remember the visit ---------------- */

  if (currentId) RecentStore.add(currentId);
})();
