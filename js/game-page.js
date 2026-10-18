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

  var shell = {
    el: function (id) { return document.getElementById(id); },

    /* GameShell.hud({ Score: 0, Best: 0 }, optionalRightText) */
    hud: function (map, rightText) {
      var hud = document.getElementById('gameHud');
      if (!hud) return;
      var html = '';
      for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        html += '<span class="hud-item">' + k + '<b>' + map[k] + '</b></span>';
      }
      html += '<span class="hud-item hud-spacer">' + (rightText || '') + '</span>';
      html += '<button class="hud-btn" type="button" data-fullscreen>⛶ Fullscreen</button>';
      hud.innerHTML = html;

      var fsBtn = hud.querySelector('[data-fullscreen]');
      if (fsBtn) fsBtn.addEventListener('click', toggleFullscreen);
    },

    overlay: {
      /* GameShell.overlay.show({ title, msg, stats:[{label,value}], btn, action }) */
      show: function (opts) {
        var ov = document.getElementById('gameOverlay');
        if (!ov) return;
        opts = opts || {};
        var t = document.getElementById('overlayTitle');
        var m = document.getElementById('overlayMsg');
        var s = document.getElementById('overlayStats');
        var b = document.getElementById('overlayBtn');
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
        ov.classList.remove('hidden');
      },
      hide: function () {
        var ov = document.getElementById('gameOverlay');
        if (ov) ov.classList.add('hidden');
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
